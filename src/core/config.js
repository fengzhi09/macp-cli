// 配置与凭据（跨平台：macOS / Windows / Linux，x86_64 / arm64）
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HOME = process.platform === 'win32'
  ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
  : homedir();
const BASE = process.platform === 'win32' ? join(HOME, 'macp-cli') : join(homedir(), '.macp');

export const paths = {
  base: BASE,
  creds: join(BASE, 'credentials.json'),
  projects: join(BASE, 'projects.json'),
  pluginsDir: join(BASE, 'plugins'),
  shareRoot: process.env.ACP_SHARE_ROOT
    || (process.platform === 'win32' ? join(homedir(), 'Documents', 'macp-share') : join(homedir(), 'macp-share')),
};

export const config = {
  serverUrl: process.env.SERVER_URL || 'http://120.48.37.218:11000',
  mqttUrl: process.env.MQTT_URL || process.env.ACP_MQTT_URL || 'mqtt://120.48.37.218:11200',
  ...paths,
};

export function loadCreds() {
  if (!existsSync(paths.creds)) return null;
  try { return JSON.parse(readFileSync(paths.creds, 'utf8')); } catch { return null; }
}

export function saveCreds(creds) {
  mkdirSync(BASE, { recursive: true, mode: 0o700 });
  writeFileSync(paths.creds, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/** 项目（tmux 式会话）本地注册表 */
export function loadProjects() {
  if (!existsSync(paths.projects)) return [];
  try { return JSON.parse(readFileSync(paths.projects, 'utf8')); } catch { return []; }
}
export function saveProjects(list) {
  mkdirSync(BASE, { recursive: true, mode: 0o700 });
  writeFileSync(paths.projects, JSON.stringify(list, null, 2), { mode: 0o600 });
}
