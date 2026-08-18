// macp-cli 冒烟测试：插件加载 + 命令注册 + ctx 契约
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../src/core/context.js';
import { loadPlugins } from '../src/core/loader.js';
import { config } from '../src/core/config.js';

const log = { info() {}, warn() {}, error() {}, debug() {} };

async function makeCtx() {
  const ctx = createContext({ config, log });
  await loadPlugins(ctx);
  return ctx;
}

test('插件加载：5 个内置插件全部加载', async () => {
  const ctx = await makeCtx();
  const names = ctx.plugins.map((p) => p.name);
  for (const n of ['core', 'tunnel', 'agent-kimi', 'agent-pi', 'agent-dsh']) {
    assert.ok(names.includes(n), `缺插件 ${n}`);
  }
});

test('命令注册：核心命令全部可用', async () => {
  const ctx = await makeCtx();
  for (const c of ['pair', 'daemon', 'ls', 'new', 'send', 'attach', 'agents', 'plugins', 'status']) {
    assert.ok(ctx.getCommand(c), `缺命令 ${c}`);
  }
});

test('agent 注册：kimi/pi/dsh 三适配器存在且有 detect/spawn', async () => {
  const ctx = await makeCtx();
  for (const name of ['kimi-code-cli', 'pi', 'dsh']) {
    const a = ctx.getAgent(name);
    assert.ok(a, `缺 agent ${name}`);
    assert.equal(typeof a.detect, 'function');
    assert.ok(a.spawn || a.install, `${name} 缺 spawn/install`);
  }
});

test('ctx 契约：registerCommand 覆盖告警 + events 可用', async () => {
  const ctx = await makeCtx();
  let warned = false;
  ctx.log.warn = () => { warned = true; };
  ctx.registerCommand('ls', async () => {}, { desc: 'override' });
  assert.equal(warned, true);
  let got = null;
  ctx.events.on('agent:registered', (s) => { got = s.name; });
  ctx.registerAgent({ name: 'test-agent-x' });
  assert.equal(got, 'test-agent-x');
});

test('new/ls：项目注册表读写', async () => {
  const { loadProjects, saveProjects } = await import('../src/core/config.js');
  const before = loadProjects();
  saveProjects([...before, { name: 'test-proj-x', agent: 'dsh', dir: '/tmp', createdAt: new Date().toISOString(), alive: true }]);
  assert.ok(loadProjects().find((p) => p.name === 'test-proj-x'));
  saveProjects(before); // 还原
});
