// ams 内容提供：GET(range)/PUT(冲突检测)/list/stat/direct 协商 + 本地直连 HTTP :17777（HMAC 令牌）
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, statSync, readdirSync, realpathSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep, basename } from 'node:path';

export const DIRECT_PORT = Number(process.env.ACP_DIRECT_PORT || 17777);

/** 白名单根目录解析（~ 展开由调用方处理） */
export function rootOf(shareRoot) {
  return realpathSync(resolve(shareRoot));
}

/** 路径校验：解析后必须落在白名单根内（拒绝符号链接逃逸） */
export function safePath(shareRoot, relPath) {
  const root = rootOf(shareRoot);
  const abs = resolve(root, relPath.replace(/^\/+/, ''));
  // 先查已存在路径的 realpath；不存在则校验父目录 realpath
  let real;
  if (existsSync(abs)) {
    real = realpathSync(abs);
  } else {
    const parent = realpathSync(dirname(abs)); // 父目录必须存在
    real = join(parent, basename(abs));
  }
  if (real !== root && !real.startsWith(root + sep)) {
    throw new Error(`path escapes share root: ${relPath}`);
  }
  return real;
}

// ---------- 直连令牌：HMAC-SHA256(key, path+exp)，5 分钟有效 ----------
export function issueTransferToken(secretKey, path, exp) {
  return createHmac('sha256', secretKey).update(`${path}:${exp}`).digest('hex');
}

export function verifyTransferToken(secretKey, path, exp, token) {
  if (!token || Date.now() > exp) return false;
  const expect = issueTransferToken(secretKey, path, exp);
  const a = Buffer.from(expect), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- ams 文件 RPC 请求处理（daemon 收到 proto="file" 的 open 后按帧收 JSON 请求） ----------
/**
 * 处理一条 JSON 请求；read/write 的 data 为 base64。
 * 返回值：{ kind: 'json', body } 或 { kind: 'stream', ... }
 */
export function handleFileRequest(shareRoot, req) {
  switch (req.op) {
    case 'stat': {
      const abs = safePath(shareRoot, req.path);
      if (!existsSync(abs)) return { kind: 'json', body: JSON.stringify(null) };
      const st = statSync(abs);
      return { kind: 'json', body: JSON.stringify({ size: st.size, mtime: Math.round(st.mtimeMs) }) };
    }
    case 'list': {
      const abs = safePath(shareRoot, req.path);
      const entries = readdirSync(abs, { withFileTypes: true }).map((e) => {
        const st = statSync(join(abs, e.name));
        return { name: e.name, dir: e.isDirectory(), size: st.size, mtime: Math.round(st.mtimeMs), href: e.name };
      });
      return { kind: 'json', body: JSON.stringify(entries) };
    }
    case 'read': {
      const abs = safePath(shareRoot, req.path);
      const st = statSync(abs);
      const range = req.range || {};
      const start = range.start ?? 0;
      const end = Math.min(range.end ?? Infinity, st.size - 1);
      return { kind: 'json', body: JSON.stringify({
        b64: null, start, end, size: st.size, // 实际字节由 daemon 流式走 bulk 主题
        stream: { abs, start, end },
      }) };
    }
    case 'write': {
      const abs = safePath(shareRoot, req.path);
      const current = existsSync(abs) ? Math.round(statSync(abs).mtimeMs) : 0;
      // baseVersion 冲突检测：>0 时必须与当前 mtime 一致
      if (req.baseVersion && req.baseVersion !== current) {
        return { kind: 'json', body: JSON.stringify({ conflict: true, baseVersion: req.baseVersion, current }) };
      }
      mkdirSync(dirname(abs), { recursive: true });
      const buf = Buffer.from(req.data || '', 'base64');
      writeFileSync(abs, buf);
      return { kind: 'json', body: JSON.stringify({ ok: true, mtime: Math.round(statSync(abs).mtimeMs) }) };
    }
    default:
      return { kind: 'json', body: JSON.stringify({ error: `unknown op: ${req.op}` }) };
  }
}

// ---------- 直连协商：返回 {direct:true,url}；同网段判断失败则 direct:false（对端中继回落） ----------
export function negotiateDirect({ shareRoot, path, secretKey, listenHost, port = DIRECT_PORT, localNet }) {
  // 同网段比对：服务器 IP 与本机 IP 前缀一致才同意（简化：/24 前缀比对）
  const peerNet = (localNet?.peer || '').split('.').slice(0, 3).join('.');
  const myNet = (localNet?.self || '').split('.').slice(0, 3).join('.');
  if (!peerNet || peerNet !== myNet) return { direct: false, reason: 'different subnet' };
  const exp = Date.now() + 5 * 60 * 1000;
  const token = issueTransferToken(secretKey, path, exp);
  return {
    direct: true,
    url: `http://${listenHost}:${port}/xfer?path=${encodeURIComponent(path)}&exp=${exp}&token=${token}`,
  };
}

// ---------- 本地直连 HTTP 服务（仅令牌校验通过才服务） ----------
export function startDirectServer({ shareRoot, secretKey, port = DIRECT_PORT, host = '0.0.0.0' }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/xfer' || req.method !== 'GET') {
      res.writeHead(404); return res.end();
    }
    const path = url.searchParams.get('path') || '';
    const exp = Number(url.searchParams.get('exp') || 0);
    const token = url.searchParams.get('token') || '';
    // 令牌即身份：X-Transfer-Token 头或 query token，HMAC 校验 + 时效
    const presented = req.headers['x-transfer-token'] || token;
    if (!verifyTransferToken(secretKey, path, exp, presented)) {
      res.writeHead(403); return res.end('bad transfer token');
    }
    let abs;
    try { abs = safePath(shareRoot, path); } catch { res.writeHead(403); return res.end('path escape'); }
    const st = statSync(abs);
    // Range 支持
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1, code = 200;
    if (m) {
      start = m[1] === '' ? 0 : Number(m[1]);
      end = m[2] === '' ? st.size - 1 : Number(m[2]);
      code = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
    }
    res.writeHead(code, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(abs, { start, end }).pipe(res);
  });
  return new Promise((r) => server.listen(port, host, () => r(server)));
}
