# 插件 API 契约（plugin-api.md）

> macp-cli 的插件与宿主唯一接口：`ctx`（src/core/context.js）。
> 插件 = `{ name, version, setup(ctx) }`，导出 default 对象或具名导出。

## 加载位置（按序加载，后者可覆盖同名命令）

1. 内置：`src/plugins/`
2. 用户：`~/.macp/plugins/`（Windows: `%APPDATA%\macp-cli\plugins\`）
3. 项目内：当前工作目录 `macp-plugins/`
4. 额外：`MACP_PLUGIN_DIRS`（`:` 分隔）

每个插件是含 `index.js` 的目录；加载失败只警告不中断其他插件。

## setup(ctx)

```js
export default {
  name: 'my-plugin',        // 必填，唯一标识
  version: '0.1.0',         // 必填
  setup(ctx) { /* 注册能力 */ },
};
```

### ctx.registerCommand(name, fn, { desc, usage })

注册 CLI 命令 `macp <name> [args]`：

```js
ctx.registerCommand('deploy', async (args, ctx) => {
  const [env] = args;
  // fn 是 async，抛错会以 exit 1 退出并打印消息
}, { desc: '部署到环境', usage: 'macp deploy <env>' });
```

- 同名命令后注册者覆盖前者（log.warn 提示）
- `args` 为命令后的全部参数数组

### ctx.registerAgent(spec)

```js
ctx.registerAgent({
  name: 'my-agent',                    // 必填，macp new --agent 与 macp agents 使用
  bin: 'mycli',                        // 可选，PATH 可执行名
  desc: '我的 agent',
  detect: async () => boolean,         // 可选，是否已安装
  spawn: async (args, opts) => ChildProcess,  // 拉起进程（stdio 桥接用）
  install: async () => boolean,        // 可选，自动安装
});
```

内置 agent 插件（agent-kimi/agent-pi/agent-dsh）即标准实现。

### ctx.registerTool(name, spec)

插件互调的工具注册：`ctx.getTool(name)` 取用。spec 任意对象（建议 `{ desc, call }`）。

### ctx.events（EventEmitter）

| 事件 | 载荷 | 时机 |
|---|---|---|
| `agent:registered` | agent spec | 任何插件注册 agent 后 |

自定义事件随意发（命名空间建议 `plugin名:事件名`）。

### ctx.config

`{ serverUrl, mqttUrl, base, creds, projects, pluginsDir, shareRoot }`

### ctx.log

`info / warn / error / debug`（debug 需 `MACP_DEBUG=1`）

## 纪律

- 插件只做**能力注册**，不在 setup 里跑长任务（长任务做成命令实现）
- 不直接 import 宿主内部 `src/lib/*` 以外的文件；lib 里的 pair/daemon/tunnel/report/install 可复用
- 凭据只走 `src/core/config.js` 的 loadCreds/saveCreds（0600 权限）
- 网络/密钥不进插件源码；用环境变量或凭据文件
