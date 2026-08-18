// 插件开发示例：hello-world
// 把这个目录复制到 ~/.macp/plugins/hello-world/ 即被自动加载（macp plugins ls 可见）
export default {
  name: 'hello-world',
  version: '0.1.0',

  setup(ctx) {
    // 1. 注册命令：macp hello [名字]
    ctx.registerCommand('hello', async (args) => {
      ctx.log.info(`你好, ${args[0] || '世界'}！来自 hello-world 插件`);
    }, { desc: '插件示例：打个招呼' });

    // 2. 注册 agent（可选）：让 macp agents 看到它
    ctx.registerAgent({
      name: 'hello-agent',
      desc: '示例 agent（不真做事）',
      detect: async () => true,
      spawn: async () => { throw new Error('示例 agent 不可执行'); },
    });

    // 3. 订阅事件：其他插件注册 agent 时收到通知
    ctx.events.on('agent:registered', (spec) => {
      ctx.log.debug?.(`hello-world 观察到 agent 注册: ${spec.name}`);
    });
  },
};
