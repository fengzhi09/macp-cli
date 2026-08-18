// 出码配对：生成 uuid16 → POST /devices/register-code → 终端二维码 → 轮询 authorized → 存凭据
import qrcode from 'qrcode-terminal';
import { hostname } from 'node:os';
import { uuid16, saveCreds, loadCreds, env } from './util.js';

export async function pair({ serverUrl = env.serverUrl, did = uuid16(), pollMs = 3000 } = {}) {
  const res = await fetch(`${serverUrl}/api/v1/devices/register-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid16: did, hostname: hostname() }),
  });
  if (!res.ok) throw new Error(`register-code failed ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const { code, qrPayload, expiresIn } = body.data || body;
  console.log(`配对码: ${code}（${expiresIn}s 内有效）`);
  console.log('请用手机 App 扫码授权：\n');
  qrcode.generate(qrPayload || code, { small: true });

  // 轮询直到 authorized
  const deadline = Date.now() + (expiresIn || 300) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const r = await fetch(`${serverUrl}/api/v1/devices/register-code/${code}`);
    if (!r.ok) continue;
    const raw = await r.json();
    const body = raw?.data || raw;
    process.stdout.write('.');
    if (body.status === 'authorized' && body.deviceToken) {
      const creds = { did, deviceToken: body.deviceToken, mqttUrl: env.mqttUrl, hostname: hostname() };
      saveCreds(creds);
      console.log(`\n授权成功，凭据已写入 credentials.json（0600）`);
      return creds;
    }
  }
  throw new Error('配对超时，请重新执行 macp pair');
}

// CLI 直跑
if (process.argv[1] && process.argv[1].endsWith('pair.js')) {
  if (loadCreds()) {
    console.log('已有凭据。如需重新配对请先删除 credentials.json。');
    process.exit(0);
  }
  pair().catch((e) => { console.error(e.message); process.exit(1); });
}
