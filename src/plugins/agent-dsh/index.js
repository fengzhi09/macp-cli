// 内置插件：DeepSeek Harness (dsh) agent 适配器
export default {
  name: 'agent-dsh',
  version: '1.0.0',
  setup(ctx) {
    ctx.registerAgent({
      name: 'dsh',
      bin: 'dsh',
      desc: 'DeepSeek Harness（万物皆插件的 agent 运行时）',
      detect: async () => {
        try {
          const { execFile } = await import('node:child_process');
          await new Promise((res, rej) => execFile('dsh', ['--version'], (e) => e ? rej(e) : res()));
          return true;
        } catch { return false; }
      },
      spawn: async (args, opts = {}) => {
        const { spawn } = await import('node:child_process');
        return spawn('dsh', args.length ? args : ['chat'], { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
      },
      install: async () => {
        const { ensureAgents } = await import('../../lib/install.js');
        const r = await ensureAgents({ names: ['dsh'], log: ctx.log });
        return r.dsh?.status === 'installed' || r.dsh?.status === 'present';
      },
    });
  },
};
