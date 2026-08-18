// 公共工具：uuid16 生成、凭据读写（0600）
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// 凭据目录：Windows 用 %APPDATA%\macp-host，mac/Linux 用 ~/.acp-host
export const ACP_DIR = process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'macp-host')
  : join(homedir(), '.acp-host');
export const CRED_FILE = join(ACP_DIR, 'credentials.json');
export const AGENTS_FILE = join(ACP_DIR, 'agents.json');

/** 16 位设备标识（hex，与 EMQX 授权钩子的 [0-9a-zA-Z]{16} 匹配） */
export function uuid16() {
  return randomBytes(8).toString('hex'); // 16 hex chars
}

export function loadCreds() {
  if (!existsSync(CRED_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveCreds(creds) {
  mkdirSync(ACP_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  chmodSync(CRED_FILE, 0o600); // 防 umask
}

/** 在 PATH 中查找可执行文件；返回绝对路径或 null */
export function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return r.status === 0 && out ? out : null;
}

export const env = {
  serverUrl: process.env.SERVER_URL || 'http://120.48.37.218:11000',
  mqttUrl: process.env.ACP_MQTT_URL || 'mqtt://120.48.37.218:11200',
  shareRoot: (process.env.ACP_SHARE_ROOT || (process.platform === 'win32' ? join(homedir(), 'Documents', 'macp-share') : join(homedir(), 'acp-share')))
    .replace(/^~(?=\/|$)/, homedir()), // 展开 ~
};
