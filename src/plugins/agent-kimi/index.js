// 内置插件：kimi code cli agent 适配器
export default {
  name: 'agent-kimi',
  version: '1.0.0',
  setup(ctx) {
    ctx.registerAgent({
      name: 'kimi-code-cli',
      bin: 'kimi',
      desc: 'Kimi Code CLI（moonshot/kimi-latest）',
      detect: async () => {
        try {
          const { execFile } = await import('node:child_process');
          await new Promise((res, rej) => execFile('kimi', ['--version'], (e) => e ? rej(e) : res()));
          return true;
        } catch { return false; }
      },
      spawn: async (args, opts = {}) => {
        const { spawn } = await import('node:child_process');
        return spawn('kimi', args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
      },
      install: async () => {
        const { ensureAgents } = await import('../../lib/install.js');
        const r = await ensureAgents({ names: ['kimi'], log: ctx.log });
        return r.kimi?.status === 'installed' || r.kimi?.status === 'present';
      },
    });
  },
};
