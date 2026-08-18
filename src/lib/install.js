// agent 自动安装：绑定主机时若本机缺少已知 agent（kimi code cli / pi / dsh），尽力自动安装。
// 每个 agent 声明：检测方式 + 安装命令（可配 agents-install.json 覆盖）。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { which } from './util.js';

const INSTALL_DEFS = {
  dsh: {
    bin: 'dsh',
    // deepseek harness：npm 全局安装
    install: ['npm', ['install', '-g', '@deepseek-ai/dsh']],
    verify: ['dsh', ['--version']],
  },
  kimi: {
    bin: 'kimi',
    // kimi code cli 官方安装脚本（官方推荐方式）
    installScript: 'bash -c "$(curl -fsSL https://code.kimi.com/install.sh)"',
    verify: ['kimi', ['--version']],
  },
  pi: {
    bin: 'pi',
    // pi coding agent：npm 全局安装
    install: ['npm', ['install', '-g', '@mariozechner/pi-coding-agent']],
    verify: ['pi', ['--version']],
  },
};

const CFG_FILE = join(homedir(), '.acp-host', 'agents-install.json');

function loadDefs() {
  try {
    if (existsSync(CFG_FILE)) {
      const custom = JSON.parse(readFileSync(CFG_FILE, 'utf8'));
      return { ...INSTALL_DEFS, ...custom };
    }
  } catch { /* 配置损坏用默认 */ }
  return INSTALL_DEFS;
}

function run(cmd, args, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function runShell(script, timeoutMs = 240_000) {
  return new Promise((resolve) => {
    execFile('bash', ['-c', script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * 确保 agent 可用：已存在则跳过；缺失则按定义安装并验证。
 * @returns {Promise<Record<string, {status: 'present'|'installed'|'failed'|'skipped', detail?: string}>>}
 */
export async function ensureAgents({ names = Object.keys(loadDefs()), log = console } = {}) {
  const defs = loadDefs();
  const result = {};
  for (const name of names) {
    const def = defs[name];
    if (!def) { result[name] = { status: 'skipped', detail: '未知 agent，无安装定义' }; continue; }
    if (which(def.bin)) { result[name] = { status: 'present' }; continue; }

    log.info?.(`[agents] ${name} 未检测到，尝试自动安装…`);
    let r = def.install ? await run(def.install[0], def.install[1]) : await runShell(def.installScript);
    if (!r.ok) {
      result[name] = { status: 'failed', detail: (r.stderr || r.stdout).slice(0, 300) };
      log.warn?.(`[agents] ${name} 安装失败: ${r.stderr.slice(0, 120)}`);
      continue;
    }
    // 验证（npm 全局 bin 可能需重扫 PATH）
    const v = def.verify ? await run(def.verify[0], def.verify[1], 15_000) : { ok: which(def.bin) != null };
    if (v.ok || which(def.bin)) {
      result[name] = { status: 'installed' };
      log.info?.(`[agents] ${name} 安装成功`);
    } else {
      result[name] = { status: 'failed', detail: '安装完成但可执行文件不可用（检查 PATH）' };
    }
  }
  return result;
}

/** 生成/更新 agents.json 的用户自定义配置骨架（不存在时） */
export function scaffoldAgentsConfig() {
  const file = join(homedir(), '.acp-host', 'agents.json');
  if (existsSync(file)) return file;
  mkdirSync(join(homedir(), '.acp-host'), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({
    agents: [
      // 示例：自有 provider（key 支持文件路径或环境变量引用，上报只发指纹）
      // { "name": "deepseek", "type": "model", "provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "key": "~/.config/deepseek/key" }
    ],
  }, null, 2), { mode: 0o600 });
  return file;
}
