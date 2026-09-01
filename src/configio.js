'use strict';
// 配置读写加固: 启动带兜底(损坏不炸) + 原子写入(不截断)
const fs = require('fs');

function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
// 解析时剔除 __proto__/constructor 键(防原型污染注入)
function safeParse(s) { return JSON.parse(s, function (k, v) { return (k === '__proto__' || k === 'constructor') ? undefined : v; }); }

// 加载链: config.json -> config.json.bak -> config.default.json; 全程不抛异常(除三份全坏)
function loadConfig(configPath, defaultsPath, logger) {
  const warn = function (m) { if (logger && logger.warn) logger.warn(m); };
  for (const p of [configPath, configPath + '.bak', defaultsPath]) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const cfg = safeParse(stripBom(raw));
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('非对象配置');
      if (p === configPath) {
        // 主配置完好: 顺手存一份 .bak 作为下次的救命档
        try { fs.writeFileSync(configPath + '.bak', raw, 'utf8'); } catch (e) {}
      } else {
        warn('[配置] 主配置损坏, 已用 ' + p + ' 恢复(请检查设置); 原损坏文件已存为 config.json.corrupt');
        try { fs.writeFileSync(configPath + '.corrupt', fs.readFileSync(configPath)); } catch (e) {}
        try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) {}
      }
      return cfg;
    } catch (e) { /* 继续下一份 */ }
  }
  throw new Error('config.json / .bak / config.default.json 全部无法解析');
}

// 原子写: 先写 .tmp 再 rename(Windows 下 rename 覆盖旧文件), 断电/崩溃不会截断主文件
function writeConfigAtomic(configPath, obj) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, configPath);
  return true;
}

module.exports = { loadConfig: loadConfig, writeConfigAtomic: writeConfigAtomic, safeParse: safeParse };
