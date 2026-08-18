// 插件加载器：内置插件 + 用户插件（~/.macp/plugins 或 %APPDATA%/macp-cli/plugins）+ 项目内 macp-plugins/
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(__dirname, '..', 'plugins');

async function loadOne(dir, ctx) {
  const entry = join(dir, 'index.js');
  if (!existsSync(entry)) return null;
  const mod = await import(pathToFileURL(entry).href);
  const plugin = mod.default ?? mod;
  if (typeof plugin?.setup !== 'function') {
    ctx.log.warn?.(`插件 ${dir} 缺少 setup(ctx)，跳过`);
    return null;
  }
  ctx.__currentPlugin = plugin.name ?? dir.split(/[\\/]/).pop();
  plugin.setup(ctx);
  ctx.__currentPlugin = null;
  return { name: plugin.name ?? dir.split(/[\\/]/).pop(), version: plugin.version ?? '0.0.0', dir };
}

export async function loadPlugins(ctx, { extraDirs = [] } = {}) {
  const dirs = [BUILTIN_DIR, ctx.config.pluginsDir, ...extraDirs];
  const loaded = [];
  for (const root of dirs) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      try {
        const meta = await loadOne(dir, ctx);
        if (meta) loaded.push(meta);
      } catch (e) {
        ctx.log.warn?.(`插件 ${name} 加载失败: ${e.message}`);
      }
    }
  }
  ctx.plugins = loaded;
  return loaded;
}
