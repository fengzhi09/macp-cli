#!/usr/bin/env node
// macp — 多 agent 多项目管理 CLI（tmux 式会话 + dsh 式万物皆插件）
import { createContext } from '../src/core/context.js';
import { loadPlugins } from '../src/core/loader.js';
import { config } from '../src/core/config.js';

const log = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.error('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
  debug: (...a) => { if (process.env.MACP_DEBUG) console.error('[debug]', ...a); },
};

const ctx = createContext({ config, log });
await loadPlugins(ctx, {
  extraDirs: process.env.MACP_PLUGIN_DIRS ? process.env.MACP_PLUGIN_DIRS.split(':') : [],
});

const [cmd, ...args] = process.argv.slice(2);

function help() {
  const groups = new Map();
  for (const c of ctx.listCommands()) {
    const g = c.plugin || 'core';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  console.log(`macp — 多 agent 多项目管理 CLI（mobile acp & multi acp）

用法: macp <命令> [参数]

核心命令:`);
  for (const [plugin, cmds] of groups) {
    console.log(`\n[${plugin}]`);
    for (const c of cmds) console.log(`  ${c.name.padEnd(16)} ${c.desc}`);
  }
  console.log(`
环境变量: SERVER_URL MQTT_URL ACP_SHARE_ROOT MACP_PLUGIN_DIRS MACP_DEBUG
插件目录: ~/.macp/plugins（项目内 macp-plugins/ 也会自动加载）
文档: https://github.com/fengzhi09/macp-cli`);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help();
  process.exit(0);
}

const entry = ctx.getCommand(cmd);
if (!entry) {
  log.error(`未知命令: ${cmd}`);
  help();
  process.exit(1);
}

try {
  await entry.fn(args, ctx);
} catch (e) {
  log.error(e.message);
  process.exit(1);
}
