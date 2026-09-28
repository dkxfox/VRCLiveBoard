'use strict';
const { UDPPort } = require('osc');

class OscSender {
  constructor(opts) {
    opts = opts || {};
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || 9000;
    this.localPort = opts.localPort || 0;
    this.sock = null;
    this.ready = false;
  }
  open() {
    const self = this;
    return new Promise(function (resolve, reject) {
      const sock = new UDPPort({ localAddress: '127.0.0.1', localPort: self.localPort, remoteAddress: self.host, remotePort: self.port, metadata: false });
      sock.on('ready', function () { self.ready = true; self.sock = sock; resolve(); });
      sock.on('error', function (e) { if (!self.ready) reject(e); });
      sock.open();
    });
  }
  send(address, args) {
    if (!this.ready) return false;
    try { this.sock.send({ address: address, args: args }); return true; } catch (e) { return false; }
  }
  sendChatbox(text) {
    // 官方文档 /chatbox/input 参数: (s 文本, b 是否直接发送, n 是否播放提示音效)
    // b=TRUE 直接显示不弹输入框; n=FALSE 不触发通知音效(更无感)
    return this.send('/chatbox/input', [{ type: 's', value: text }, { type: 'T', value: true }, { type: 'F', value: false }]);
  }
  // 打字中指示(/chatbox/typing): 触发器"开始说话/取消"时给 VRChat 一个可见反馈(M-20260928-01)
  sendTyping(on) { return this.send('/chatbox/typing', [{ type: (on ? 'T' : 'F'), value: !!on }]); }
  close() { if (this.sock) { try { this.sock.close(); } catch (e) {} } }
  // 热切换远端地址/端口: 重开 UDP 套接字, 无需重启程序
  setRemote(host, port) {
    const self = this;
    if (host) self.host = host;
    if (port) self.port = port;
    return new Promise(function (resolve) {
      try { if (self.sock) self.sock.close(); } catch (e) {}
      self.sock = null;
      self.ready = false;
      self.open().then(function () { resolve({ ok: true }); }, function (e) { resolve({ ok: false, error: String((e && e.message) || e) }); });
    });
  }
}
module.exports = { OscSender };
