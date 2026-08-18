// 主机守护进程：MQTT 连接（username=uuid16, password=deviceToken）
// 订阅 d/{did}/tunnel/#；open 处理：
//   proto="ssh"     → 按 target.agent 找 PATH 可执行（dsh/kimi/pi），默认 sh -i 兜底 → stdio 桥接
//   proto="file"    → ams 文件请求（files.js）
//   proto="terminal"→ 交互终端（shell -i，pty 简化为 stdio）
//   proto="reserved"→ 拒绝
import mqtt from 'mqtt';
import { spawn } from 'node:child_process';
import { TunnelClient, FLAGS, attachReconnectBackoff } from './tunnel/client.js';
import { loadCreds, which, env } from './util.js';
import { handleFileRequest, negotiateDirect, startDirectServer, DIRECT_PORT } from './files.js';
import { scanAgents, report } from './report.js';
import { ensureAgents, scaffoldAgentsConfig } from './install.js';
import { networkInterfaces } from 'node:os';

// 按 agent 名找可执行文件；找不到回退 sh -i
export function resolveAgentCommand(agent) {
  const candidates = { dsh: ['dsh'], kimi: ['kimi', 'kimi-code', 'kimi-code-cli'], pi: ['pi'] };
  for (const bin of candidates[agent] || [agent]) {
    const p = which(bin);
    if (p) return { cmd: p, args: [] };
  }
  return { cmd: 'sh', args: ['-i'] }; // 兜底
}

export async function startDaemon({ creds = loadCreds(), mqttUrl = creds?.mqttUrl || env.mqttUrl, shareRoot = env.shareRoot, serverUrl = env.serverUrl, log = console } = {}) {
  if (!creds) throw new Error('未配对：先执行 npm run pair');
  const { did, deviceToken } = creds;

  const client = mqtt.connect(mqttUrl, {
    username: did,               // EMQX 授权钩子按 uuid16 判定
    password: deviceToken,
    clientId: `host-${did}`,
    reconnectPeriod: 1000,
    clean: false,                // QoS1 会话保留，断线消息不丢
  });
  attachReconnectBackoff(client);
  // mqtt 瞬断/连接错误不能让 daemon 崩溃
  client.on('error', (e) => log.warn?.(`mqtt error: ${e.message}`));

  const channels = new Map(); // ch -> { proc, fileReqBuf }

  const tunnel = new TunnelClient({
    mqtt: client, did,
    onFrame: (frame, meta) => dispatch(frame, meta),
    log: (...a) => log.debug?.(a.join(' ')),
  });

  async function dispatch(frame, meta) {
    const ch = meta.ch;
    if (meta.kind === 'open') {
      const req = JSON.parse(frame.payload.toString() || '{}');
      return onOpen(ch, req);
    }
    if (meta.kind === 'close') return onClose(ch);
    const st = channels.get(ch);
    if (!st) return;
    if (meta.kind === 'ack') return; // 窗口推进由 TunnelClient 内部处理
    if (frame.flags & (FLAGS.DATA | FLAGS.BULK)) {
      if (st.proc) {
        st.proc.stdin.write(frame.payload);
      } else if (st.fileReqBuf != null) {
        // file RPC：聚合请求 JSON 直至 close
        st.fileReqBuf.push(frame.payload);
      }
      tunnel.sendAck(ch, frame.seq); // 累计确认（背压由 TunnelClient 内部节流）
    }
  }

  async function onOpen(ch, req) {
    log.info?.(`channel open: ${ch} proto=${req.proto} target=${JSON.stringify(req.target ?? req)}`);
    if (req.proto === 'ssh' || req.proto === 'ssh-agent') {
      // SPEC §7：open {proto:"ssh-agent", agent, model} → 起 dsh 宿主子进程，stdio 桥接
      const { cmd, args } = resolveAgentCommand(req.agent || req.target?.agent);
      const proc = spawn(cmd, req.model ? ['--model', req.model] : args, { stdio: ['pipe', 'pipe', 'pipe'] });
      channels.set(ch, { proc });
      proc.stdout.on('data', (d) => tunnel.sendData(ch, d));
      proc.stderr.on('data', (d) => tunnel.sendData(ch, d));
      proc.on('exit', (code) => { tunnel.closeChannel(ch, `agent exit ${code}`); channels.delete(ch); });
    } else if (req.proto === 'file') {
      channels.set(ch, { fileReqBuf: [] });
      // 文件 RPC：请求体即 open 的 target，直接处理
      void serveFileRpc(ch, req.target || req);
    } else if (req.proto === 'terminal') {
      const proc = spawn('sh', ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
      channels.set(ch, { proc });
      proc.stdout.on('data', (d) => tunnel.sendData(ch, d));
      proc.stderr.on('data', (d) => tunnel.sendData(ch, d));
      proc.on('exit', (code) => { tunnel.closeChannel(ch, `exit ${code}`); channels.delete(ch); });
    } else {
      tunnel.closeChannel(ch, `unsupported proto: ${req.proto}`);
    }
  }

  function onClose(ch) {
    const st = channels.get(ch);
    channels.delete(ch);
    if (st?.proc) st.proc.kill();
    if (st?.fileReqBuf) {
      // 请求收完（close 即 RPC 结束符）→ 处理并回发
      const req = JSON.parse(Buffer.concat(st.fileReqBuf).toString() || '{}');
      void serveFileRpc(ch, req);
    }
  }

  async function serveFileRpc(ch, req) {
    // direct 协商：签一次性令牌，本地 :17777 服务
    if (req.op === 'direct') {
      // 本机出口 IP（用于同网段比对）
      const self = Object.values(networkInterfaces())
        .flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address || '';
      const nego = negotiateDirect({
        shareRoot, path: req.path, secretKey: deviceToken,
        listenHost: '0.0.0.0', port: DIRECT_PORT,
        localNet: { peer: req.peer || '', self },
      });
      return tunnel.sendData(ch, Buffer.from(JSON.stringify(nego)));
    }
    const r = handleFileRequest(shareRoot, req);
    if (req.op === 'read' && r.body && JSON.parse(r.body).stream) {
      // 流式读：先发 JSON 元数据，再按 bulk 分片发内容，close 收尾
      const { stream, start, end } = JSON.parse(r.body);
      await tunnel.sendData(ch, Buffer.from(JSON.stringify({ start, end })));
      const { createReadStream } = await import('node:fs');
      const fs = createReadStream(stream.abs, { start, end });
      for await (const chunk of fs) {
        for (let off = 0; off < chunk.length; off += 64 * 1024) {
          await tunnel.sendData(ch, chunk.subarray(off, off + 64 * 1024), { bulk: true });
        }
      }
      return tunnel.closeChannel(ch, 'eof');
    }
    await tunnel.sendData(ch, Buffer.from(r.body));
    tunnel.closeChannel(ch, 'done');
  }

  client.on('connect', async () => {
    log.info?.(`daemon connected as ${did} (${mqttUrl})`);
    // 全局订阅隧道主题（SPEC：主机端订阅 d/{did}/tunnel/#）
    client.subscribe(`d/${did}/tunnel/#`, { qos: 1 });
    // 直连文件服务（令牌校验见 files.js）
    await startDirectServer({ shareRoot, secretKey: deviceToken }).catch((e) => log.warn?.(`direct server: ${e.message}`));
    // 感知上报（指纹化）——先确保 agent 可用（缺失自动安装），再扫描上报
    const installResult = await ensureAgents({ log }).catch(() => ({}));
    const agents = scanAgents();
    await report({ serverUrl, did, deviceToken, agents: [...agents, ...Object.entries(installResult).map(([name, r]) => ({ name, type: 'install', status: r.status }))] })
      .catch((e) => log.warn?.(`report: ${e.message}`));
    scaffoldAgentsConfig();
    log.info?.(`[agents] 感知上报完成：${agents.map((a) => a.name).join(', ') || '(无)'}；自动安装：${Object.entries(installResult).map(([n, r]) => `${n}=${r.status}`).join(', ') || '无操作'}`);
  });

  return { client, tunnel, channels, creds };
}

// CLI 直跑
if (process.argv[1] && process.argv[1].endsWith('daemon.js')) {
  startDaemon().catch((e) => { console.error(e.message); process.exit(1); });
}
