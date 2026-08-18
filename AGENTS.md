# AGENTS.md — macp-cli 项目导航

## 项目一句话

多 agent 多项目管理 CLI：tmux 式项目会话 + DeepSeek Harness 式万物皆插件。macp 系统（手机/服务端/算力端）的开源主机端，x86_64 / arm64 macOS/Windows/Linux。

## 唯一契约

**插件上下文 `src/core/context.js` 的 ctx 是插件与宿主的唯一接口。** 新增能力优先写成插件（`src/plugins/` 或用户目录），禁往 `bin/macp.js` 堆命令逻辑。插件 API 细节见 `docs/plugin-api.md`。

## 目录与职责（并行开发严禁越界）

| 目录 | 职责 | 注意 |
|---|---|---|
| `bin/macp.js` | CLI 入口：加载插件 → 分发命令 | 不放业务逻辑 |
| `src/core/context.js` | ctx 契约（registerCommand/Agent/Tool/events） | 变更需同步 `docs/plugin-api.md` |
| `src/core/loader.js` | 插件加载（内置 + 用户目录 + 项目内） | 失败插件只警告不中断 |
| `src/core/config.js` | 配置/凭据/项目注册表（跨平台路径） | Win 用 %APPDATA% |
| `src/plugins/` | 内置插件（core/tunnel/agent-kimi/pi/dsh） | 与内置能力一一对应 |
| `src/lib/` | 移植自 macp 主仓库的库（pair/daemon/tunnel/files/report/install） | 上游修复需回同步 |
| `plugins.example/` | 插件示例 | 文档与示例保持一致 |
| `docs/` | plugin-api.md / architecture.md | 契约变更先改文档 |

## 构建与测试

```bash
npm install          # 根
npm test             # node:test
node bin/macp.js     # 帮助
MACP_DEBUG=1 node bin/macp.js status
```

本机联调环境：macp 服务端 `http://120.48.37.218:11000`（EMQX `:11200`），算力端 vLLM `127.0.0.1:8000`。

## 约定

- JS ESM（不用 TS）；中文注释适度；命令输出中文
- 提示词即 API：任何给模型的提示词放独立文件注册表（version/build/validate），禁内联
- 平台差异（路径/服务注册）集中在 `src/core/config.js` 与 `src/lib/install.js`
- 测试 node:test；外部服务不可用必须 skip 而非 fail
- 不发明新缩写；agent 清单只认 kimi-code-cli / pi / dsh（新 agent 走插件注册，不改核心清单）
- git：不主动 commit/push，除非用户明确要求

## 移植/嵌入上游（DeepSeek Harness / tmux）原则

- **dsh 借鉴**：一切皆插件、无特权内核、ctx 单一契约——本项目已实现；接入 dsh 运行时只通过 `agent-dsh` 插件的 spawn，不 fork dsh 源码
- **tmux 借鉴**：会话即项目（new/ls/attach/send），会话状态本地 JSON 注册表，不引入 tmux 本身的 C 实现
- 移植第三方代码必须保留 LICENSE 头与出处注释
