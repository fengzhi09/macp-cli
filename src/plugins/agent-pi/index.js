// 内置插件：pi coding agent 适配器
export default {
  name: 'agent-pi',
  version: '1.0.0',
  setup(ctx) {
    ctx.registerAgent({
      name: 'pi',
      bin: 'pi',
      desc: 'pi coding agent（轻量 TS 运行时）',
      detect: async () => {
        try {
          const { execFile } = await import('node:child_process');
          await new Promise((res, rej) => execFile('pi', ['--version'], (e) => e ? rej(e) : res()));
          return true;
        } catch { return false; }
      },
      spawn: async (args, opts = {}) => {
        const { spawn } = await import('node:child_process');
        return spawn('pi', args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
      },
      install: async () => {
        const { ensureAgents } = await import('../../lib/install.js');
        const r = await ensureAgents({ names: ['pi'], log: ctx.log });
        return r.pi?.status === 'installed' || r.pi?.status === 'present';
      },
    });
  },
};
