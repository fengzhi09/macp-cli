// 插件上下文（万物皆插件，参照 DeepSeek Harness / Cordis 理念）
// ctx 是插件与宿主的唯一契约：命令、agent、工具、事件、配置、日志。
import { EventEmitter } from 'node:events';

export function createContext({ config, log }) {
  const commands = new Map();     // name -> { fn, desc, usage }
  const agents = new Map();       // name -> { bin?, detect?, spawn?, desc }
  const tools = new Map();        // name -> { desc, call }
  const events = new EventEmitter();
  events.setMaxListeners(100);

  const ctx = {
    config,
    log,
    events,
    plugins: [], // 已加载插件元信息（loader 填充）

    /** 注册 CLI 命令：macp <name> [args] */
    registerCommand(name, fn, { desc = '', usage = '' } = {}) {
      if (commands.has(name)) log.warn?.(`command ${name} 被覆盖（后注册者胜）`);
      commands.set(name, { fn, desc, usage, plugin: ctx.__currentPlugin });
    },

    /** 注册 agent 适配器：detect() 探测、spawn(args, opts) 拉起、install() 自动安装 */
    registerAgent(spec) {
      if (!spec?.name) throw new Error('registerAgent: name required');
      agents.set(spec.name, { ...spec, plugin: ctx.__currentPlugin });
      events.emit('agent:registered', spec);
    },

    /** 注册工具（可被 agent 命令/插件互相调用） */
    registerTool(name, spec) {
      tools.set(name, { ...spec, plugin: ctx.__currentPlugin });
    },

    /** 查询 */
    listCommands: () => [...commands.entries()].map(([name, c]) => ({ name, ...c })),
    listAgents: () => [...agents.entries()].map(([name, a]) => ({ name, ...a })),
    listTools: () => [...tools.entries()].map(([name, t]) => ({ name, ...t })),
    getCommand: (name) => commands.get(name),
    getAgent: (name) => agents.get(name),
    getTool: (name) => tools.get(name),
  };
  return ctx;
}
