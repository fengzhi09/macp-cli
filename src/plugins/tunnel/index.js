// 内置插件：隧道命令（attach：接入项目 agent 会话，SSH 管道交互）
import { loadCreds } from '../../core/config.js';

export default {
  name: 'tunnel',
  version: '1.0.0',
  setup(ctx) {
    ctx.registerCommand('attach', async (args) => {
      const name = args[0];
      if (!name) throw new Error('用法: macp attach <项目名>');
      const { loadProjects } = await import('../../core/config.js');
      const proj = loadProjects().find((p) => p.name === name);
      if (!proj) throw new Error(`项目不存在: ${name}（macp new ${name} 创建）`);
      const creds = loadCreds();
      if (!creds) throw new Error('未绑定：先执行 macp pair');

      // 经 MQTT 隧道向 daemon 发起 agent 会话（本机 daemon 或远端主机）
      const mqtt = (await import('mqtt')).default;
      const client = mqtt.connect(ctx.config.mqttUrl, {
        username: creds.did, password: creds.deviceToken, clientId: `macp-attach-${Date.now()}`,
      });
      ctx.log.info(`接入 ${name}（agent=${proj.agent}）… Ctrl+C 退出`);

      const ch = `att-${Date.now().toString(36)}`;
      const openMsg = JSON.stringify({ chId: ch, proto: 'ssh', target: { agent: proj.agent, dir: proj.dir } });
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });
      client.subscribe(`d/${creds.did}/tunnel/${ch}/#`, { qos: 1 });
      client.publish(`d/${creds.did}/tunnel/${ch}/open`, openMsg, { qos: 1 });

      // stdio 桥接：stdin → 隧道帧；隧道帧 → stdout
      const { encode, decode, FLAGS } = await import('../../lib/tunnel/framing.js');
      let seq = 0;
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', (d) => {
        client.publish(`d/${creds.did}/tunnel/${ch}/data`, encode({ chId: ch, seq: seq++, flags: FLAGS.DATA, payload: d }), { qos: 1 });
      });
      client.on('message', (topic, payload) => {
        if (!topic.endsWith('/data')) return;
        try { process.stdout.write(decode(payload).payload); } catch { /* ignore */ }
      });
      process.on('SIGINT', () => {
        client.publish(`d/${creds.did}/tunnel/${ch}/close`, JSON.stringify({ reason: 'detach' }), { qos: 1 });
        client.end(true);
        process.stdin.setRawMode?.(false);
        process.exit(0);
      });
      // 保持进程
      await new Promise(() => {});
    }, { desc: '接入项目的 agent 会话（SSH 管道交互）' });
  },
};
