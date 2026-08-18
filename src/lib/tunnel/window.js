// 乱序重组 + 滑动窗口 + 背压（纯逻辑，可独立测试）
//
// Reassembler：QoS1 可能重复/乱序，按 seq 去重并按序输出。
// SendWindow：8 帧滑动窗口，累计确认（ack seq 之前全部确认）。
// ReceiveBuffer：接收侧缓冲计数，>1MB 延迟 ack 形成背压（对端窗口停摆）。

export class Reassembler {
  constructor() {
    this.nextSeq = 0;      // 期望的下一个 seq
    this.pending = new Map(); // seq -> payload（乱序暂存）
    this.buffered = 0;     // 暂存字节数
  }

  /** 送入一帧；返回按序释放出的 {seq, payload} 数组（通常 0 或 1 个） */
  push(seq, payload) {
    if (seq < this.nextSeq || this.pending.has(seq)) return []; // 重复帧
    if (seq === this.nextSeq) {
      const out = [{ seq, payload }];
      this.nextSeq++;
      while (this.pending.has(this.nextSeq)) {
        const p = this.pending.get(this.nextSeq);
        out.push({ seq: this.nextSeq, payload: p });
        this.buffered -= p.length;
        this.pending.delete(this.nextSeq);
        this.nextSeq++;
      }
      return out;
    }
    this.pending.set(seq, payload);
    this.buffered += payload.length;
    return [];
  }
}

export class SendWindow {
  constructor(size = 8) {
    this.size = size;
    this.inflight = []; // 已发未确认的 [{seq, payload}]
    this.ackedSeq = -1; // 累计确认水位
  }

  /** 窗口是否有空位 */
  canSend() {
    return this.inflight.length < this.size;
  }

  /** 等待窗口空位（背压处挂起） */
  async waitSlot() {
    while (!this.canSend()) {
      if (!this._notify) {
        this._notify = new Promise((r) => (this._resolve = r));
      }
      await this._notify;
    }
  }

  /** 登记一帧已发出 */
  track(seq, payload) {
    this.inflight.push({ seq, payload });
  }

  /** 收到累计确认 ackSeq：seq<=ackSeq 全部确认；返回被确认的帧 */
  onAck(ackSeq) {
    if (ackSeq <= this.ackedSeq) return [];
    this.ackedSeq = ackSeq;
    const confirmed = this.inflight.filter((f) => f.seq <= ackSeq);
    this.inflight = this.inflight.filter((f) => f.seq > ackSeq);
    if (this._resolve) {
      const r = this._resolve;
      this._notify = null; this._resolve = null; r();
    }
    return confirmed;
  }

  /** 断线重连后按已确认水位收缩窗口（未确认帧交由上层重发） */
  resetToAcked() {
    const unacked = this.inflight.slice();
    this.inflight = [];
    return unacked;
  }
}

export class ReceiveBuffer {
  constructor(maxBytes = 1024 * 1024) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
  }

  add(n) { this.bytes += n; }

  /** 释放 n 字节 */
  release(n) {
    this.bytes = Math.max(0, this.bytes - n);
  }

  /** 是否应暂停 pull（>1MB 触发背压：延迟 ack / 暂停主题读取） */
  shouldPause() {
    return this.bytes > this.maxBytes;
  }
}
