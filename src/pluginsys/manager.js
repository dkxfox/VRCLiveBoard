'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const perms = require('./permissions');
const aigateway = require('./aigateway');
const RESERVED_IDS = new Set(['security']); // plugins.security 是策略配置块, 禁止插件占用该 id

// 危险内置模块直接 require 的审计钩子(2026-09-03, F-20260903-01):
// 默认只审计(记录到 plugin-audit.log); processPolicy=deny 时拦 child_process, networkPolicy=off 时拦 http/https/tls/net/dgram。
// 注意: 钩子只在"调用栈父模块位于 plugins/<id>/" 时生效, 主体代码的 require 不受任何影响。
const Module = require('module');
const DANGEROUS_REQUIRES = new Set(['child_process', 'net', 'dgram', 'http', 'https', 'tls']);
let activeManager = null;
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const result = _origLoad.apply(this, arguments);
  if (DANGEROUS_REQUIRES.has(request) && activeManager) {
    const pf = parent && parent.filename ? String(parent.filename) : '';
    const m = pf.match(/[\\/]plugins[\\/]([a-z0-9-]{1,64})[\\/]/i);
    if (m && activeManager.hasPlugin(m[1])) {
      const sec = activeManager.getSecurity() || perms.SEC_DEFAULTS;
      const blocked = (request === 'child_process' && sec.processPolicy === 'deny') ||
        ((request === 'http' || request === 'https' || request === 'tls' || request === 'net' || request === 'dgram') && sec.networkPolicy === 'off');
      perms.requireAudit(m[1], request, !blocked);
      if (blocked) {
        const err = new Error('插件安全策略拒绝: 当前策略禁止插件直接 require("' + request + '")(' + (request === 'child_process' ? 'processPolicy=deny' : 'networkPolicy=off') + ')');
        err.code = 'VRCB_PLUGIN_POLICY';
        throw err;
      }
    }
  }
  return result;
};
const conflictMod = require('./conflicts');
const vrclog = require('./vrclog');

// 插件管理器: 扫描 plugins/<id>/(manifest.json + index.js), 生命周期与能力注入
const API_MAJOR = '2';
class PluginManager {
  constructor(opts) {
    this.root = opts.root;
    this.composer = opts.composer;
    this.logger = opts.logger;
    this.approvals = opts.approvals || {};
    this.getSecurity = opts.security || function () { return null; };
    this.getAiConfig = opts.aiConfig || function () { return null; };
    this.entries = [];
    activeManager = this;
    this.timers = [];
    this.scan();
  }
  scan() {
    const ids = new Set();
    try {
      for (const name of fs.readdirSync(this.root)) {
        const dir = path.join(this.root, name);
        const manifestPath = path.join(dir, 'manifest.json');
        if (!fs.statSync(dir).isDirectory()) continue;
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
          if (manifest.id !== name) { this.logger.warn('[插件] 目录名 ' + name + ' 与 manifest.id ' + manifest.id + ' 不一致,跳过'); continue; }
          if (RESERVED_IDS.has(manifest.id)) { this.logger.warn('[插件] ' + name + ' 使用了保留 id(plugins.security 配置块), 跳过'); continue; }
          const entry = {
            id: manifest.id, dir: dir, manifest: manifest,
            approved: !!(this.approvals[manifest.id] && this.approvals[manifest.id].hash === this.hash({ manifest: manifest, dir: dir })),
            _lastAiAt: 0,
            enabled: false, plugin: null, error: null, runtimeSources: [], runtimeErrors: [],
            settings: {}
          };
          ids.add(manifest.id);
          const existing = this.entries.find(function (e) { return e.id === manifest.id; });
          if (existing) {
            // 保留运行时状态, 更新 manifest
            existing.manifest = manifest;
            existing.approved = entry.approved;
            existing.dir = dir;
          } else {
            this.entries.push(entry);
          }
        } catch (e) { this.logger.warn('[插件] ' + name + ' 加载 manifest 失败: ' + e.message); }
      }
    } catch (e) {}
    // 清理已删除的插件
    this.entries = this.entries.filter(function (e) { return ids.has(e.id); });
    vrclog.start();
    return this.entries.length;
  }
  // 审批哈希 = id@version|api|sha256(index.js 前 16 位): 代码内容变化但版本不升也会使审批失效, 必须重新红窗
  hash(entry) {
    const m = entry.manifest || entry;
    let bodyHash = '';
    try {
      if (entry.dir && fs.existsSync(path.join(entry.dir, 'index.js'))) {
        bodyHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(entry.dir, 'index.js'))).digest('hex').slice(0, 16);
      }
    } catch (e) {}
    return String(m.id + '@' + m.version + '|' + (m.api || '') + '|' + bodyHash);
  }
  hasPlugin(id) { return this.entries.some(function (e) { return e.id === id; }); }
  buildCtx(entry) {
    const self = this;
    const sec = function () { const s = self.getSecurity && self.getSecurity(); return s || perms.SEC_DEFAULTS; };
    const dataDir = path.join(entry.dir, 'data');
    const ctx = {
      id: entry.id,
      manifest: entry.manifest,
      logger: self.logger,
      config: entry.settings,
      events: {
        on: function (ev, fn) {
          // 插件回调异常隔离: 单个插件炸不拖垮整个程序
          const safe = function () { try { fn.apply(null, arguments); } catch (e) { self.logger.warn('[插件事件回调异常 ' + entry.id + '] ' + ((e && e.message) || e)); } };
          try { fn.__vrcbSafe = safe; } catch (e) {}
          vrclog.on(ev, safe);
        },
        off: function (ev, fn) { vrclog.off(ev, fn && fn.__vrcbSafe ? fn.__vrcbSafe : fn); },
        every: function (ms, fn) {
          const safe = function () { try { fn(); } catch (e) { self.logger.warn('[插件定时回调异常 ' + entry.id + '] ' + ((e && e.message) || e)); } };
          const t = setInterval(safe, ms);
          self.timers.push(t);
          return function () { clearInterval(t); };
        }
      },
      media: {
        state: function () {
          const src = self.composer.sources.find(function (x) { return x.id === 'media'; });
          if (!src) return null;
          let data = null;
          try { data = src.lastRaw ? JSON.parse(src.lastRaw) : null; } catch (e) { data = null; }
          return { enabled: src.enabled, data: data };
        }
      },
      chatbox: {
        send: function (text, opts) {
          opts = opts || {};
          const p = (entry.settings && entry.settings.priority != null) ? entry.settings.priority : (opts.priority || 80);
          self.composer.pushTransient(text, p, opts.ttlMs || 8000, !!opts.force);
        },
        showSequence: async function (chunks, opts) {
          opts = opts || {};
          const each = Math.max(2000, opts.eachMs || 6000);
          const loops = Math.max(1, opts.loops || 1);
          const p = (entry.settings && entry.settings.priority != null) ? entry.settings.priority : (opts.priority || 90);
          const force = opts.force !== false;
          for (let l = 0; l < loops; l++) {
            for (let i = 0; i < chunks.length; i++) {
              self.composer.pushTransient(chunks[i], p, each + 2000, force);
              await new Promise(function (r) { setTimeout(r, each); });
            }
          }
        }
      },
      http: {
        request: async function (url, options) {
          const pol = sec();
          if (!perms.check(entry.manifest, 'network', url, { policy: pol, id: entry.id })) {
            entry.runtimeErrors.push('越权网络请求: ' + url);
            throw new Error('权限拒绝: 当前插件安全策略或 manifest 未允许对 ' + url + ' 的网络访问');
          }
          return fetch(url, options);
        }
      },
      fs: {
        read: function (p) {
          if (!perms.check(entry.manifest, 'fs.read', p, { policy: sec(), id: entry.id, dir: entry.dir, dataDir: dataDir })) throw new Error('权限拒绝: 当前插件安全策略或 manifest 未允许读取 ' + p);
          return fs.readFileSync(p, 'utf8');
        },
        write: function (p, content) {
          if (!perms.check(entry.manifest, 'fs.write', p, { policy: sec(), id: entry.id, dir: entry.dir, dataDir: dataDir })) throw new Error('权限拒绝: 当前插件安全策略或 manifest 未允许写入 ' + p);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, content, 'utf8');
        }
      },
      exec: {
        run: function (cmd, args) {
          if (!perms.check(entry.manifest, 'process', '', { policy: sec(), id: entry.id })) throw new Error('权限拒绝: 当前插件安全策略或 manifest 未声明进程执行权限');
          const { spawn } = require('child_process');
          return spawn(cmd, args || [], { windowsHide: true, stdio: 'ignore' });
        }
      },
      ai: {
        chat: async function (o) {
          o = o || {};
          const task = o.task === 'chat' ? 'chat' : 'translate';
          const declared = entry.manifest && entry.manifest.ai && Array.isArray(entry.manifest.ai.tasks);
          if (!declared || entry.manifest.ai.tasks.indexOf(task) < 0) {
            throw new Error('权限拒绝: 插件未声明 AI 能力(manifest.ai.tasks 需包含 ' + task + ')');
          }
          const now = Date.now();
          if (now - (entry._lastAiAt || 0) < aigateway.AI_MIN_INTERVAL_MS) {
            throw new Error('调用过于频繁: 插件 AI 每 ' + (aigateway.AI_MIN_INTERVAL_MS / 1000) + ' 秒最多一次');
          }
          entry._lastAiAt = now;
          const sec = self.getSecurity && self.getSecurity() || perms.SEC_DEFAULTS;
          const cfg = self.getAiConfig && self.getAiConfig() || {};
          try {
            const r = await aigateway.chat({ cfg: cfg, policy: sec, task: task, text: o.text, lang: o.lang, logger: self.logger });
            perms.auditEvent(entry.id, 'ai:' + task, true);
            return r;
          } catch (e) {
            perms.auditEvent(entry.id, 'ai:' + task, false);
            throw e;
          }
        }
      },
      registerSource: function (src) {
        src.id = entry.id + ':' + (src.id || 'src');
        entry.runtimeSources.push(src);
        self.composer.registerSource(src);
      },
      plugins: self
    };
    return ctx;
  }
  enable(id) {
    const entry = this.entries.find(function (e) { return e.id === id; });
    if (!entry) return { ok: false, error: '插件不存在' };
    if (!entry.approved) return { ok: false, error: '未获得用户授权' };
    if (entry.enabled) return { ok: true };
    try {
      const conflicts = conflictMod.analyze(this.entries.map(function (e) { return e; }));
      const issues = (conflicts[id] || []).filter(function (i) { return i.with !== '运行时' && i.reason.indexOf('依赖') >= 0 || i.reason.indexOf('互斥') >= 0 || i.reason.indexOf('重复') >= 0; });
      if (issues.length) return { ok: false, error: '冲突: ' + issues[0].reason };
      const mod = require(path.join(entry.dir, 'index.js'));
      const create = typeof mod === 'function' ? mod : mod.create;
      if (!create) return { ok: false, error: 'index.js 缺少导出' };
      entry.plugin = create(this.buildCtx(entry));
      if (entry.plugin && entry.plugin.apply) entry.plugin.apply();
      if (entry.plugin && entry.plugin.sources) {
        for (const s of entry.plugin.sources) { entry.runtimeSources.push(s); this.composer.registerSource(s); }
      }
      entry.enabled = true;
      entry.error = null;
      this.logger.info('[插件] 已启用 ' + entry.manifest.name);
      return { ok: true };
    } catch (e) {
      entry.error = String(e.message);
      this.logger.error('[插件] 启用失败 ' + id + ': ' + e.message);
      return { ok: false, error: String(e.message) };
    }
  }
  disable(id) {
    const entry = this.entries.find(function (e) { return e.id === id; });
    if (!entry || !entry.enabled) return { ok: true };
    try {
      if (entry.plugin && entry.plugin.dispose) entry.plugin.dispose();
      for (const s of entry.runtimeSources) { this.composer.unregisterSource(s.id); }
      entry.runtimeSources = [];
      entry.plugin = null;
      entry.enabled = false;
      this.logger.info('[插件] 已停用 ' + entry.manifest.name);
    } catch (e) { this.logger.error('[插件] 停用异常 ' + e.message); }
    return { ok: true };
  }
  status() {
    const conf = conflictMod.analyze(this.entries);
    return {
      api: API_MAJOR,
      plugins: this.entries.map(function (e) {
        return {
          id: e.id, name: e.manifest.name, version: e.manifest.version, author: e.manifest.author || '',
          description: e.manifest.description || '', api: e.manifest.api || '', approved: e.approved,
          enabled: e.enabled, error: e.error || null,
          permissions: e.manifest.permissions || {},
          conflicts: conf[e.id] || [],
          hasPanel: !!(e.plugin && e.plugin.panel),
          hasPage: !!(e.plugin && e.plugin.page),
          priority: (e.settings && e.settings.priority != null) ? e.settings.priority : null
        };
      }),
      audit: perms.audit()
    };
  }
  importZip(zipPath) {
    const { execFileSync } = require('child_process');
    const idDir = path.join(this.root, '.tmp-import');
    try {
      // zip 炸弹防线: 压缩包 ≤ 50MB, 解包总量 ≤ 200MB, 条目 ≤ 2000
      const zipStat = fs.statSync(zipPath);
      if (!zipStat.isFile() || zipStat.size > 50 * 1024 * 1024) return { ok: false, error: 'zip 文件过大或不存在(上限 50MB)' };
      fs.rmSync(idDir, { recursive: true, force: true });
      fs.mkdirSync(idDir, { recursive: true });
      execFileSync('tar', ['-xf', zipPath, '-C', idDir], { windowsHide: true });
      // 解包后防线: 任何条目名含 .. 或绝对路径 → 拒(防 zip-slip); 总量/条目数超限 → 拒(防 zip 炸弹)
      let totalBytes = 0; let entries = 0;
      const walk = function (d) {
        for (const n of fs.readdirSync(d)) {
          const p = path.join(d, n);
          if (n.indexOf('..') >= 0) throw new Error('zip 内含非法路径条目');
          const st = fs.statSync(p);
          entries++;
          if (entries > 2000) throw new Error('zip 条目过多(上限 2000)');
          if (st.isDirectory()) { walk(p); } else { totalBytes += st.size; if (totalBytes > 200 * 1024 * 1024) throw new Error('zip 解包总量过大(上限 200MB)'); }
        }
      };
      walk(idDir);
      const sub = fs.readdirSync(idDir).filter(function (n) { return fs.statSync(path.join(idDir, n)).isDirectory(); });
      let targetDir = idDir;
      if (sub.length === 1 && !fs.existsSync(path.join(idDir, 'manifest.json'))) targetDir = path.join(idDir, sub[0]);
      if (!fs.existsSync(path.join(targetDir, 'manifest.json'))) return { ok: false, error: 'zip 内未找到 manifest.json(应为一个插件文件夹)' };
      const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
      // 安全: id 白名单(防 ..\ 穿越写出 plugins 目录), 目标必须落在插件根内
      const id = String(manifest.id || '');
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return { ok: false, error: 'manifest.id 非法(仅小写字母/数字/连字符)' };
      if (RESERVED_IDS.has(id)) return { ok: false, error: 'manifest.id 使用了保留 id(security 为插件安全策略配置块)' };
      const rootAbs = path.resolve(this.root);
      const dest = path.resolve(path.join(this.root, id));
      if (dest !== path.join(rootAbs, id) || dest.indexOf(rootAbs + path.sep) !== 0) return { ok: false, error: '插件目录非法' };
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(targetDir, dest);
      this.scan();
      return { ok: true, id: manifest.id };
    } catch (e) {
      return { ok: false, error: '导入失败: ' + e.message };
    } finally {
      try { fs.rmSync(idDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  panelHtml(id) {
    const entry = this.entries.find(function (e) { return e.id === id; });
    if (!entry || !entry.plugin || !entry.plugin.panel) return null;
    return { title: entry.plugin.panel.title || entry.manifest.name, html: entry.plugin.panel.html(entry.settings) || '' };
  }
}
module.exports = { PluginManager, API_MAJOR };
