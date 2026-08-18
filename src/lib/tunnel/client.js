// TunnelClient：基于 mqtt client 的隧道端点（服务端网关与主机 daemon 共用）。
//
// 主题（SPEC §2）：
//   d/{did}/tunnel/{ch}/open   JSON {chId, proto, target}
//   d/{did}/tunnel/{ch}/data   16B 头 + 二进制帧
//   d/{did}/tunnel/{ch}/bulk   大文件独立传输主题（同样帧格式）
//   d/{did}/tunnel/{ch}/ack    JSON {seq}（累计确认）
//   d/{did}/tunnel/{ch}/close  JSON {reason}
//
// 断线重连：发送 seq 持久化（提供 redis 则落 Redis 1h TTL，否则内存），
// 重连后从记录的 seq 续传；mqtt 重连间隔按 1/2/4…60s 指数退避。
import { encode, decode, FLAGS, MAX_PAYLOAD } from './framing.js';
import { Reassembler, SendWindow, ReceiveBuffer } from './window.js';

const TOPIC_RE = /^d\/[^/]+\/tunnel\/([^/]+)\/(open|data|bulk|ack|close)$/;

export function parseTopic(topic) {
  const m = TOPIC_RE.exec(topic);
  if (!m) return null;
  return { ch: m[1], kind: m[2] };
}

/** mqtt.js 默认固定重连间隔；这里改为指数退避 1/2/4…60s，连上后复位 */
export function attachReconnectBackoff(mqttClient, { min = 1000, max = 60000 } = {}) {
  let attempt = 0;
  mqttClient.on('reconnect', () => {
    const period = Math.min(max, min * 2 ** attempt);
    attempt = Math.min(attempt + 1, Math.log2(max / min));
    // mqtt.js 每次 schedule 重连时读取 options.reconnectPeriod
    if (mqttClient.options) mqttClient.options.reconnectPeriod = period;
  });
  mqttClient.on('connect', () => {
    attempt = 0;
    if (mqttClient.options) mqttClient.options.reconnectPeriod = min;
  });
}

export class TunnelClient {
  /**
   * @param {object} opts
   * @param {object} opts.mqtt     mqtt client（需支持 subscribe/publish/on('message')）
   * @param {string} opts.did      本端设备 id（主题前缀 d/{did}）
   * @param {object} [opts.redis]  ioredis 实例；提供则断点 seq 落 Redis（1h TTL）
   * @param {number} [opts.windowSize] bulk 滑动窗口帧数，默认 8
   * @param {function} [opts.onFrame]  收到按序帧 (frame, meta) => void；meta={ch, kind}
   */
  constructor({ mqtt, did, redis = null, windowSize = 8, onFrame = () => {}, log = () => {} }) {
    this.mqtt = mqtt;
    this.did = did;
    this.redis = redis;
    this.log = log;
    this.onFrameCb = onFrame;
    this.channels = new Map(); // ch -> channel state
    this.windowSize = windowSize;
    // 内存版 seq 记录（无 redis 时兜底）
    this.memSeq = new Map();
    mqtt.on('message', (topic, payload) => this.handleMessage(topic, payload));
    mqtt.on('connect', () => { this._resendPendingAcks(); });
  }

  _ch(ch) {
    let st = this.channels.get(ch);
    if (!st) {
      st = {
        ch,
        txSeq: 0,                       // 下一个发送 seq
        window: new SendWindow(this.windowSize),
        rx: new Reassembler(),
        rxbuf: new ReceiveBuffer(),
        ackSeq: -1,                     // 已累计确认给对端的 seq
        ackHeld: false,                 // 背压：暂停 ack
        closed: false,
      };
      this.channels.set(ch, st);
    }
    return st;
  }

  _seqKey(ch) { return `tunnel:seq:${this.did}:${ch}:tx`; }

  async _persistSeq(st) {
    const val = String(st.txSeq);
    if (this.redis) {
      await this.redis.set(this._seqKey(st.ch), val, 'EX', 3600).catch((e) => this.log('seq persist failed:', e.message));
    } else {
      this.memSeq.set(this._seqKey(st.ch), val);
    }
  }

  async _loadSeq(ch) {
    const raw = this.redis
      ? await this.redis.get(this._seqKey(ch)).catch(() => null)
      : this.memSeq.get(this._seqKey(ch)) ?? null;
    return raw == null ? null : Number(raw);
  }

  topic(ch, kind) { return `d/${this.did}/tunnel/${ch}/${kind}`; }

  /** 打开通道：订阅 d/{did}/tunnel/{ch}/# 并发布 open */
  async openChannel({ chId, proto, target }) {
    const st = this._ch(chId);
    await new Promise((res, rej) =>
      this.mqtt.subscribe(`d/${this.did}/tunnel/${chId}/#`, { qos: 1 }, (e) => (e ? rej(e) : res())));
    // 重连续传：恢复上次发送 seq（未持久化则从 0 开始）
    const saved = await this._loadSeq(chId);
    if (saved != null) st.txSeq = saved;
    await new Promise((res, rej) =>
      this.mqtt.publish(this.topic(chId, 'open'), JSON.stringify({ chId, proto, target }), { qos: 1 }, (e) => (e ? rej(e) : res())));
    return st;
  }

  /** 发送数据帧（seq 自动递增）；bulk=true 走大文件独立主题 */
  async sendData(ch, payload, { bulk = false } = {}) {
    const st = this._ch(ch);
    const seq = st.txSeq++;
    await this._persistSeq(st);
    const frame = encode({ chId: ch, seq, flags: FLAGS.DATA | (bulk ? FLAGS.BULK : 0), payload });
    await new Promise((res, rej) =>
      this.mqtt.publish(this.topic(ch, bulk ? 'bulk' : 'data'), frame, { qos: 1 }, (e) => (e ? rej(e) : res())));
    return seq;
  }

  /** 大文件分块走 8 帧滑动窗口（对端累计 ack 推进）；返回总帧数 */
  async sendBulkStream(ch, emitChunk) {
    const st = this._ch(ch);
    for (;;) {
      const chunk = await emitChunk();
      if (chunk == null) break;
      let off = 0;
      while (off < chunk.length) {
        const piece = chunk.subarray(off, off + MAX_PAYLOAD);
        off += piece.length;
        await st.window.waitSlot();
        const seq = await this.sendData(ch, piece, { bulk: true });
        st.window.track(seq, piece);
      }
    }
    return st.txSeq;
  }

  sendAck(ch, seq) {
    const st = this._ch(ch);
    if (st.ackHeld || seq <= st.ackSeq) return; // 背压时延迟 ack
    st.ackSeq = seq;
    this.mqtt.publish(this.topic(ch, 'ack'), JSON.stringify({ seq }), { qos: 1 });
  }

  closeChannel(ch, reason = 'bye') {
    const st = this.channels.get(ch);
    if (st) st.closed = true;
    this.mqtt.publish(this.topic(ch, 'close'), JSON.stringify({ reason }), { qos: 1 });
    this.channels.delete(ch);
  }

  /** mqtt message 入口：按主题分发 */
  async handleMessage(topic, payload) {
    const parsed = parseTopic(typeof topic === 'string' ? topic : topic.toString());
    if (!parsed) return;
    const { ch, kind } = parsed;
    if (kind === 'ack') {
      const st = this.channels.get(ch);
      if (!st) return;
      const { seq } = JSON.parse(payload.toString());
      st.window.onAck(seq);
      this.onFrameCb({ chId: ch, seq, flags: FLAGS.ACK, payload }, { ch, kind });
      return;
    }
    if (kind === 'open' || kind === 'close') {
      this.onFrameCb({ chId: ch, seq: 0, flags: kind === 'open' ? FLAGS.OPEN : FLAGS.CLOSE, payload }, { ch, kind });
      return;
    }
    // data / bulk：二进制帧，乱序重组后按序上抛
    const st = this._ch(ch);
    const frame = decode(payload);
    st.rxbuf.add(frame.payload.length);
    const ordered = st.rx.push(frame.seq, frame.payload);
    // 累计确认：仅确认按序收到的最高 seq；缓冲 >1MB 时挂起 ack 形成背压
    const contig = st.rx.nextSeq - 1;
    if (st.rxbuf.shouldPause()) {
      st.ackHeld = true;
      st.heldAckSeq = Math.max(st.heldAckSeq ?? -1, contig);
    } else {
      st.ackHeld = false;
      this.sendAck(ch, contig);
    }
    for (const item of ordered) {
      this.onFrameCb({ chId: frame.chId, seq: item.seq, flags: frame.flags, payload: item.payload }, { ch, kind });
      st.rxbuf.release(item.payload.length); // 上层同步消费即释放；流式消费者自行再计
      if (!st.rxbuf.shouldPause() && st.ackHeld) {
        st.ackHeld = false;
        this.sendAck(ch, Math.max(st.heldAckSeq ?? -1, st.rx.nextSeq - 1));
      }
    }
  }

  _resendPendingAcks() { /* 重连后由 mqtt QoS1 重投递兜底，无需补发 */ }
}
