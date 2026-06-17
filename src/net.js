// net.js —— 基于 PeerJS(WebRTC) 的房主权威联机层
// PeerJS 以 UMD 形式由 index.html 引入，挂在 window.Peer 上。
// 房主(host)：多连接，是世界唯一权威。客户端(client)：单连接到房主。

// 消息类型
export const MSG = {
  HELLO: 'hello',   // client→host 自报家门
  WELCOME: 'welcome', // host→client 分配信息
  WORLD: 'world',   // host→client 完整世界状态(种子+方块改动+功能方块)
  STATE: 'state',   // host→client 玩家/怪物/动物/昼夜快照
  INPUT: 'input',   // client→host 移动与朝向
  BLOCK: 'block',   // 双向 方块破坏/放置
  DOOR: 'door',     // 双向 门开关
  CHEST: 'chest',   // 双向 箱子内容
  HIT:   'hit',     // client→host 攻击怪物/动物
  PICKUP: 'pickup', // client→host 拾取掉落物
  CHAT:  'chat',    // 双向 聊天
  BYE:   'bye',     // 离开
};

// 生成 6 位房间号（PeerJS 的 peer id 前缀，便于朋友输入）
function makeRoomId() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += s[Math.floor(Math.random() * s.length)];
  return r;
}
const PREFIX = 'minimc-'; // 命名空间，避免和公共信令上其他人撞号

export class Net {
  constructor() {
    this.role = 'solo';        // 'solo' | 'host' | 'client'
    this.peer = null;          // PeerJS Peer 实例
    this.conns = new Map();    // host: peerId→conn ; client: 仅一条
    this.handlers = {};        // type → fn(payload, fromId)
    this.roomId = null;        // 房间号(host 持有/ client 加入用)
    this.selfId = null;        // 本端 peer id
    this.displayName = 'Player';
    this.onPeerJoin = null;    // (peerId)=>{}
    this.onPeerLeave = null;   // (peerId)=>{}
    this.onStatus = null;      // (text)=>{} 状态文案回调
  }

  setDisplayName(name) {
    const clean = String(name || '').trim().slice(0, 16);
    this.displayName = clean || 'Player';
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, payload, fromId) {
    const h = this.handlers[type];
    if (h) h(payload, fromId);
  }
  _status(t) { if (this.onStatus) this.onStatus(t); }

  // 创建房间：本端成为 host
  host(onReady) {
    this.role = 'host';
    this.roomId = makeRoomId();
    const id = PREFIX + this.roomId;
    this.peer = new window.Peer(id, { debug: 1 });
    this.peer.on('open', (pid) => {
      this.selfId = pid;
      this._status('房间已开：' + this.roomId);
      if (onReady) onReady(this.roomId);
    });
    this.peer.on('connection', (conn) => this._acceptConn(conn));
    this.peer.on('error', (err) => this._status('错误：' + err.type));
  }

  // host 接受一个新客户端连接
  _acceptConn(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
        this._status('玩家加入（' + this.conns.size + ' 在线）');
        if (this.onPeerJoin) this.onPeerJoin(conn.peer);
    });
    conn.on('data', (msg) => this._emit(msg.t, msg.d, conn.peer));
    conn.on('close', () => this._dropConn(conn.peer));
    conn.on('error', () => this._dropConn(conn.peer));
  }
  _dropConn(peerId) {
    if (this.conns.has(peerId)) {
      this.conns.delete(peerId);
      if (this.onPeerLeave) this.onPeerLeave(peerId);
      this._status('玩家离开（' + this.conns.size + ' 在线）');
    }
  }

  // 加入房间：本端成为 client
  join(roomId, onReady) {
    this.role = 'client';
    this.roomId = roomId.trim().toUpperCase();
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('open', (pid) => {
      this.selfId = pid;
      const conn = this.peer.connect(PREFIX + this.roomId, { reliable: true });
      conn.on('open', () => {
        this.conns.set('host', conn);
        this._status('已连接房主');
        this.send(MSG.HELLO, { name: this.displayName });
        if (onReady) onReady();
      });
      conn.on('data', (msg) => this._emit(msg.t, msg.d, 'host'));
      conn.on('close', () => this._status('与房主断开'));
      conn.on('error', () => this._status('连接失败'));
    });
    this.peer.on('error', (err) => this._status('错误：' + err.type));
  }

  // client→host 单发；host 用 broadcast
  send(type, data) {
    for (const conn of this.conns.values()) {
      try { conn.send({ t: type, d: data }); } catch (e) {}
    }
  }
  // host→所有 client（可排除某个 id）
  broadcast(type, data, exceptId) {
    for (const [pid, conn] of this.conns) {
      if (pid === exceptId) continue;
      try { conn.send({ t: type, d: data }); } catch (e) {}
    }
  }
  // host→指定 client
  sendTo(peerId, type, data) {
    const conn = this.conns.get(peerId);
    if (conn) { try { conn.send({ t: type, d: data }); } catch (e) {} }
  }

  isHost() { return this.role === 'host'; }
  isClient() { return this.role === 'client'; }
  isMultiplayer() { return this.role !== 'solo'; }

  close() {
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.conns.clear();
    this.role = 'solo';
  }
}
