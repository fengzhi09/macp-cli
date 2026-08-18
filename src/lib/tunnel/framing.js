// 帧格式（SPEC §2）：[16B 头: chId(8B ascii) + seq(4B uint32 BE) + flags(4B)][载荷 ≤64KB]
// flags: 0x01=open 0x02=data 0x04=close 0x08=bulk 0x10=ack
export const FLAGS = Object.freeze({
  OPEN: 0x01,
  DATA: 0x02,
  CLOSE: 0x04,
  BULK: 0x08,
  ACK: 0x10,
});

export const HEADER_LEN = 16;
export const MAX_PAYLOAD = 64 * 1024; // 64KB
export const MAX_FRAME = HEADER_LEN + MAX_PAYLOAD;

// chId 定长 8 字节 ascii，短则以空格右填充（解码时裁掉尾部空白与 NUL）
export function encode({ chId, seq = 0, flags = 0, payload = null }) {
  if (typeof chId !== 'string' || chId.length === 0 || chId.length > 8) {
    throw new Error(`chId must be 1-8 ascii chars, got: ${JSON.stringify(chId)}`);
  }
  const head = Buffer.alloc(HEADER_LEN);
  head.write(chId.padEnd(8, ' '), 0, 8, 'ascii');
  head.writeUInt32BE(seq >>> 0, 8);
  head.writeUInt32BE(flags >>> 0, 12);
  const body = payload == null ? Buffer.alloc(0) : Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length > MAX_PAYLOAD) throw new Error(`payload ${body.length}B exceeds 64KB`);
  return Buffer.concat([head, body]);
}

export function decode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < HEADER_LEN) throw new Error(`frame too short: ${buf.length}B`);
  const chId = buf.toString('ascii', 0, 8).replace(/[\s\0]+$/, '');
  const seq = buf.readUInt32BE(8);
  const flags = buf.readUInt32BE(12);
  const payload = buf.subarray(HEADER_LEN);
  return { chId, seq, flags, payload };
}
