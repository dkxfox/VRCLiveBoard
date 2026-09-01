'use strict';
// 网易云客户端 CDP 读取器: 用 Chrome DevTools 协议直读客户端内部播放进度与歌名(Node 22+ 自带 WebSocket/fetch)。
// 客户端需带 --remote-debugging-port=9234 启动(见同目录 启动网易云-CDP.bat)。
const POLL_MS = 1000;

// 在客户端页面里执行的取数脚本(每 1 秒跑一次, 纯读 DOM, 不改任何东西)
// 实测(2026-08, 客户端 3.1.35): 播放条时间是一个含 "03:46 / 06:02" 文本的叶子节点(当前/总长);
// 播放列表里的单时长(如 04:12)只有一段, 不会误判; 页面用 CSS Modules 类名(带哈希后缀), 按文本匹配最稳。
// v1.1.1: 顺带提取播放条歌名 —— 点播放列表手动换歌时客户端不更新 SMTC 标题(上一首/下一首正常),
// 所以用 CDP 直读的客户端歌名作为换歌识别第一信号。
const EXTRACT = [
  "(function(){",
  "  try{",
  "    function txt(el){return (el.textContent||'').trim();}",
  "    function parseT(s){var m=/^(\\d{1,3}):(\\d{2})$/.exec(s);if(!m)return null;return (+m[1])*60000+(+m[2])*1000;}",
  "    function clean(s){s=(s||'').trim();var B='(?:VIP|SQ|HQ|Hi-Res|Lossless|无损|独占|独家|MV)';var m=new RegExp('^(.*?)'+B+'(.*)$','i').exec(s);if(m){var t=m[1].replace(/[·\\s]+$/,'').trim();var r=m[2].trim();var re=new RegExp('^'+B+'\\s*','i');while(re.test(r)){r=r.replace(re,'').trim();}return r?(t+' '+r):t;}return s.replace(new RegExp('\\s*(?:·\\s*)?'+B+'\\s*$','i'),'').trim();}",
  "    var pair=null,timeEl=null;",
  "    var all=document.querySelectorAll('*');",
  "    for(var i=0;i<all.length && i<6000;i++){",
  "      var el=all[i];",
  "      if(el.children.length!==0) continue;",
  "      var m=/^(\\d{1,3}):(\\d{2})\\s*[/]\\s*(\\d{1,3}):(\\d{2})$/.exec(txt(el));",
  "      if(m){ pair={posMs:parseT(m[1]+':'+m[2]),durMs:parseT(m[3]+':'+m[4])}; timeEl=el; }",
  "    }",
  "    var title='';",
  "    if(timeEl){",
  "      // 从时间元素向上(≤7 层)找播放条里的歌名: title/name/track 类元素, 2~60 字, 排除时间格式",
  "      var p=timeEl,depth=0;",
  "      while(p && depth<7 && !title){",
  "        if(p.querySelectorAll){",
  "          var kids=p.querySelectorAll('[class*=title],[class*=Title],[class*=name],[class*=Name],[class*=track],[class*=Track]');",
  "          for(var j=0;j<kids.length;j++){",
  "            var t=clean(txt(kids[j]));",
  "            if(t.length>=2 && t.length<=60 && !/^\\d{1,3}:\\d{2}$/.test(t)){ title=t; break; }",
  "          }",
  "        }",
  "        p=p.parentElement; depth++;",
  "      }",
  "    }",
  "    if(pair) return {posMs:pair.posMs,durMs:pair.durMs,title:title};",
  "    var thumb=document.querySelector('[class*=curtime],[class*=CurTime],[class*=Bar] [style*=translateX],[class*=bar] [style*=width]');",
  "    if(thumb){",
  "      var st=thumb.getAttribute('style')||'';",
  "      var mm=/translateX\\((\\d+(?:\\.\\d+)?)%\\)/.exec(st)||/width:\\s*(\\d+(?:\\.\\d+)?)%/.exec(st);",
  "      if(mm) return {pct:parseFloat(mm[1])};",
  "    }",
  "    return null;",
  "  }catch(e){return null;}",
  "})()"
].join('\n');

class CdpClient {
  constructor(port, logger) {
    this.port = port || 9234;
    this.logger = logger;
    this.ws = null;
    this.pos = { ok: false, posMs: 0, durMs: 0, title: '', updatedAt: 0 };
    this._id = 0;
    this._pending = new Map();
    this._timer = null;
    this._retryTimer = null;
  }
  get fresh() { return this.pos.ok && (Date.now() - this.pos.updatedAt) < 5000; }
  async start() {
    const ok = await this._connect();
    if (ok) this.log('[网易云CDP] 已连接 127.0.0.1:' + this.port + ' (精确进度+歌名同步)');
    else this.log('[网易云CDP] 未连接(客户端未带调试端口启动? 用同目录 启动网易云-CDP.bat 启动, 15 秒后自动重试)');
    this._retryTimer = setInterval(() => { if (!this.fresh && !this.ws) this._connect().catch(() => {}); }, 15000);
    return ok;
  }
  async _connect() {
    try {
      const list = await (await fetch('http://127.0.0.1:' + this.port + '/json', { signal: AbortSignal.timeout(3000) })).json();
      const pages = (Array.isArray(list) ? list : []).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!pages.length) throw new Error('no page target');
      let target = pages.find(p => /webapp|app|player|index/i.test(p.url || '')) || pages[0];
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      this.ws = ws;
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.id && this._pending.has(m.id)) { const p = this._pending.get(m.id); this._pending.delete(m.id); m.error ? p.reject(new Error(m.error.message || 'cdp error')) : p.resolve(m); }
        } catch (e) {}
      };
      ws.onclose = () => { this.ws = null; if (this._timer) { clearInterval(this._timer); this._timer = null; } this.pos.ok = false; };
      await this._send('Runtime.enable', {});
      await this._poll();
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this._poll().catch(() => {}), POLL_MS);
      return this.pos.ok;
    } catch (e) { this.ws = null; return false; }
  }
  _send(method, params) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); } catch (e) { this._pending.delete(id); reject(e); }
    });
  }
  async _poll() {
    if (!this.ws) return;
    const r = await this._send('Runtime.evaluate', { expression: EXTRACT, returnByValue: true });
    const v = r && r.result && r.result.result ? r.result.result.value : null;
    if (v && typeof v.posMs === 'number' && v.posMs > 0) {
      this.pos = { ok: true, posMs: v.posMs, durMs: v.durMs || 0, title: v.title || this.pos.title || '', updatedAt: Date.now() };
      if (v.durMs) this._lastDur = v.durMs;
    } else if (v && typeof v.pct === 'number' && this._lastDur) {
      // 兜底: 只有百分比时, 用记忆的总长换算
      this.pos = { ok: true, posMs: Math.round(this._lastDur * v.pct / 100), durMs: this._lastDur, title: v.title || this.pos.title || '', updatedAt: Date.now() };
    }
  }
  dispose() {
    if (this._timer) clearInterval(this._timer);
    if (this._retryTimer) clearInterval(this._retryTimer);
    this._timer = this._retryTimer = null;
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
  }
  log(m) { if (this.logger && this.logger.info) this.logger.info(m); }
}

module.exports = { CdpClient: CdpClient, EXTRACT: EXTRACT };
