// 感知上报：PATH 扫描 + agents.json 用户配置 → POST /devices/report
// key 只上报指纹（sha256 前 16 位），不发明文。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { which, AGENTS_FILE } from './util.js';

const KNOWN_AGENTS = ['dsh', 'kimi', 'pi'];

/** key 指纹：sha256 前 16 位；key 参数为文件路径或明文（只取指纹） */
export function fingerprint(key) {
  if (!key) return null;
  let material = key;
  try {
    if (existsSync(key)) material = readFileSync(realpathSync(key), 'utf8'); // key 文件路径
  } catch { /* 当明文处理 */ }
  return createHash('sha256').update(String(material)).digest('hex').slice(0, 16);
}

/** 扫描本机 agent：PATH 可执行文件 + 用户 agents.json 配置 */
export function scanAgents({ known = KNOWN_AGENTS, agentsFile = AGENTS_FILE } = {}) {
  const out = [];
  for (const name of known) {
    const bin = which(name);
    if (bin) out.push({ name, type: 'cli', provider: null, modelFingerprint: null, bin });
  }
  if (existsSync(agentsFile)) {
    try {
      const cfg = JSON.parse(readFileSync(agentsFile, 'utf8'));
      for (const a of Array.isArray(cfg) ? cfg : cfg.agents || []) {
        out.push({
          name: a.name,
          type: a.type || 'model',
          provider: a.provider || null,
          baseUrl: a.baseUrl || null,
          modelFingerprint: fingerprint(a.key), // key 只读指纹
        });
      }
    } catch { /* 配置损坏则跳过 */ }
  }
  return out;
}

/** 上报到服务器（带设备 token） */
export async function report({ serverUrl, did, deviceToken, agents }) {
  const res = await fetch(`${serverUrl}/api/v1/devices/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${did}:${deviceToken}` },
    body: JSON.stringify({ did, agents }),
  });
  if (!res.ok) throw new Error(`report failed ${res.status}: ${await res.text()}`);
  return res.json();
}
