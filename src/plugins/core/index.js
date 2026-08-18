// 内置插件：核心命令（pair/daemon/ls/new/send/agents/plugins/status）
import { loadCreds, saveProjects, loadProjects } from '../../core/config.js';

export default {
  name: 'core',
  version: '1.0.0',
  setup(ctx) {
    const { log } = ctx;

    ctx.registerCommand('pair', async () => {
      const { pair } = await import('../../lib/pair.js');
      await pair({ serverUrl: ctx.config.serverUrl });
    }, { desc: '出二维码，手机 App 扫码绑定主机' });

    ctx.registerCommand('daemon', async () => {
      const { startDaemon } = await import('../../lib/daemon.js');
      const creds = loadCreds();
      if (!creds) throw new Error('未绑定：先执行 macp pair');
      await startDaemon({ creds, mqttUrl: ctx.config.mqttUrl, serverUrl: ctx.config.serverUrl, log });
    }, { desc: '启动守护进程（隧道 + agent 桥接 + 感知上报）' });

    ctx.registerCommand('ls', async () => {
      const projects = loadProjects();
      if (!projects.length) return log.info('没有项目。macp new <name> 创建一个。');
      for (const p of projects) {
        log.info(`${p.name.padEnd(20)} agent=${p.agent.padEnd(14)} dir=${p.dir} ${p.alive ? '●' : '○'}`);
      }
    }, { desc: '列出项目会话（tmux 式）' });

    ctx.registerCommand('new', async (args) => {
      const name = args[0];
      if (!name) throw new Error('用法: macp new <项目名> [--agent kimi] [--dir <路径>]');
      const agent = (args[args.indexOf('--agent') + 1]) || 'dsh';
      const dir = args[args.indexOf('--dir') + 1] || process.cwd();
      const projects = loadProjects();
      if (projects.find((p) => p.name === name)) throw new Error(`项目已存在: ${name}`);
      projects.push({ name, agent, dir, createdAt: new Date().toISOString(), alive: true });
      saveProjects(projects);
      log.info(`✓ 项目 ${name} 已创建（agent=${agent}, dir=${dir}）。macp attach ${name} 接入会话`);
    }, { desc: '新建项目会话 [--agent kimi|pi|dsh] [--dir 路径]' });

    ctx.registerCommand('send', async (args) => {
      const [name, ...msgParts] = args;
      const text = msgParts.join(' ');
      if (!name || !text) throw new Error('用法: macp send <项目名> <消息>');
      const creds = loadCreds();
      if (!creds) throw new Error('未绑定：先执行 macp pair');
      // 经服务端 API 走归因通道（设备 Token）
      const res = await fetch(`${ctx.config.serverUrl}/api/v1/devices/${creds.did}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.did}:${creds.deviceToken}` },
        body: JSON.stringify({ text, project: name, ts: Date.now() }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
      if (!res.ok) throw new Error(`发送失败 ${res.status}: ${await res.text()}`);
      log.info(`✓ 已发送（归因引擎将路由到项目 ${name} 的 agent）`);
    }, { desc: '给项目发消息（归因引擎路由）' });

    ctx.registerCommand('agents', async () => {
      const list = ctx.listAgents();
      if (!list.length) return log.info('没有注册的 agent（插件未加载？）');
      for (const a of list) {
        const detected = a.detect ? await a.detect().catch(() => false) : null;
        log.info(`${a.name.padEnd(16)} ${a.desc || ''} ${detected === true ? '●已安装' : detected === false ? '○未安装(可自动装)' : ''}`);
      }
    }, { desc: '列出可用 agent（kimi/pi/dsh + 插件注册的）' });

    ctx.registerCommand('plugins', async (args) => {
      const sub = args[0] || 'ls';
      if (sub === 'ls') {
        for (const p of ctx.plugins) log.info(`${p.name.padEnd(20)} v${p.version}  ${p.dir}`);
        log.info(`\n共 ${ctx.plugins.length} 个插件。目录: ~/.macp/plugins 或项目内 macp-plugins/`);
      } else {
        log.info('用法: macp plugins ls');
      }
    }, { desc: '插件管理（ls）' });

    ctx.registerCommand('status', async () => {
      const creds = loadCreds();
      const os = `${process.platform} ${process.arch}`;
      if (!creds) return log.info(`[macp] ${os} · 未绑定（macp pair 扫码绑定）`);
      log.info(`[macp] ${os} · 设备 ${creds.did} (${creds.hostname})`);
      log.info(`  服务端: ${ctx.config.serverUrl} · MQTT: ${ctx.config.mqttUrl}`);
      log.info(`  项目: ${loadProjects().length} 个 · 插件: ${ctx.plugins.length} 个 · agent: ${ctx.listAgents().length} 个`);
    }, { desc: '查看绑定/项目/插件状态' });
  },
};
