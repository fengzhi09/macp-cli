# macp-cli

**多 agent 多项目管理命令行工具**——tmux 式的项目会话管理 + DeepSeek Harness 式的万物皆插件生态。macp（mobile acp & multi acp）系统的主机端：手机说一句话，本机的 agent 把活干完。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-blue)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20(x86__64%20%2F%20arm64)-lightgrey)]()

## 是什么

```
手机 App ──扫码──► 本机 macp daemon ──MQTT 隧道──► macp 服务端（归因引擎）
                        │
                        ├─ macp new myproj --agent kimi   # 建项目
                        ├─ macp attach myproj             # 接入 agent 会话
                        └─ plugins/ ──► 万物皆插件（agent/命令/工具全可扩展）
```

- **多项目**：tmux 式项目会话（`new`/`ls`/`attach`/`send`），每个项目绑定 agent 与工作目录
- **多 agent**：kimi code cli / pi / DeepSeek Harness 开箱即用，缺失自动安装
- **插件生态**：参照 DeepSeek Harness「一切皆插件」——命令、agent、工具、事件全是插件，用户插件放 `~/.macp/plugins/` 即可
- **隧道直连**：SSH 管道经 MQTT 到本机/远端主机 daemon，大文件同网段直连零带宽
- **手机联动**：扫码绑定后，手机端消息经服务端归因引擎路由到对应项目与 agent

## 安装

**macOS / Ubuntu / Linux（x86_64 / arm64）**

```bash
curl -fsSL http://120.48.37.218:11000/host/install.sh | bash
```

**Windows（PowerShell, x86_64 / arm64）**

```powershell
irm http://120.48.37.218:11000/host/install.ps1 | iex
```

或从源码：

```bash
git clone https://github.com/fengzhi09/macp-cli.git
cd macp-cli && npm install && npm link
```

## 快速开始

```bash
macp pair              # 1. 出二维码，手机 App 扫码绑定本机
macp daemon            # 2. 启动守护进程（隧道 + agent 桥接 + 感知上报）

macp new web --agent kimi-code-cli --dir ~/work/web   # 3. 建项目
macp ls                # 列出项目
macp attach web        # 4. 接入该项目的 agent 会话（交互式）
macp send web "把登录页的校验加上"  # 5. 或直接发消息让归因引擎调度
```

## 命令

| 命令 | 说明 |
|---|---|
| `macp pair` | 出二维码，手机扫码绑定主机 |
| `macp daemon` | 守护进程（隧道/agent 桥接/感知上报） |
| `macp new <name> [--agent X] [--dir 路径]` | 新建项目会话 |
| `macp ls` | 列出项目（tmux 式） |
| `macp attach <name>` | 接入项目 agent 会话（SSH 管道交互） |
| `macp send <name> <消息>` | 给项目发消息（归因路由） |
| `macp agents` | 列出可用 agent（含插件注册的） |
| `macp plugins ls` | 插件列表 |
| `macp status` | 绑定/项目/插件状态 |

## 插件机制（万物皆插件）

参照 DeepSeek Harness：命令、agent、工具、事件**全部是插件**。宿主只做插件加载与命令分发，没有特权内核。

**放插件**：目录放 `~/.macp/plugins/<name>/index.js`（Windows: `%APPDATA%\macp-cli\plugins\`）或项目内 `macp-plugins/<name>/index.js`，即被自动加载。

**最小插件**：

```js
// ~/.macp/plugins/hello/index.js
export default {
  name: 'hello',
  version: '0.1.0',
  setup(ctx) {
    // 注册命令: macp hello
    ctx.registerCommand('hello', async () => ctx.log.info('你好'), { desc: '打招呼' });
    // 注册 agent
    ctx.registerAgent({ name: 'my-agent', bin: 'mycli', detect: async () => true });
    // 订阅事件
    ctx.events.on('agent:registered', (s) => console.log('agent 注册:', s.name));
  },
};
```

**ctx 契约**（插件与宿主唯一接口）：

| API | 说明 |
|---|---|
| `ctx.registerCommand(name, fn, {desc, usage})` | 注册 CLI 命令 |
| `ctx.registerAgent({name, bin?, detect?, spawn?, install?})` | 注册 agent 适配器 |
| `ctx.registerTool(name, spec)` | 注册工具（插件互调） |
| `ctx.events` | EventEmitter：`agent:registered` 等 |
| `ctx.config` | serverUrl/mqttUrl/路径 |
| `ctx.log` | info/warn/error/debug |

内置插件即范例：`src/plugins/`（core / tunnel / agent-kimi / agent-pi / agent-dsh）。完整契约见 [docs/plugin-api.md](docs/plugin-api.md)。

## 架构

```
bin/macp.js            CLI 入口：加载插件 → 分发命令（无特权内核）
src/core/
  context.js           插件上下文 ctx（register*/events/config/log）
  loader.js            插件加载器（内置 + ~/.macp/plugins + 项目内 macp-plugins/）
  config.js            配置与凭据（跨平台路径）
src/plugins/           内置插件（core/tunnel/agent-*）
src/lib/               移植自 macp 主仓库的能力库（pair/daemon/tunnel/files/report/install）
plugins.example/       插件开发示例
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SERVER_URL` | `http://120.48.37.218:11000` | macp 服务端 |
| `MQTT_URL` | `mqtt://120.48.37.218:11200` | MQTT broker |
| `ACP_SHARE_ROOT` | `~/macp-share`（Win: `Documents\macp-share`） | ams 文件共享白名单根目录 |
| `MACP_PLUGIN_DIRS` | — | 额外插件目录（`:` 分隔） |
| `MACP_DEBUG` | — | 调试日志 |

## 与 macp 系统的关系

macp-cli 是 [macp](https://github.com/fengzhi09/macp)（多智能体控制台：手机 App + 云服务端 + 算力端）的**开源主机端**。它把"绑定主机、跑 agent、管项目"这件事独立成通用 CLI——你可以只用它管理本地多 agent 项目，也可以接入完整 macp 系统获得手机控制、任务归因与经验反哺。

## License

MIT © [fengzhi09](https://github.com/fengzhi09)
