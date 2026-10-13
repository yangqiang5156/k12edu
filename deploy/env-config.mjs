import { existsSync, realpathSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const legacy = ['.env.runtime', '.env.tts', '.env.postgres', '.env.local'];
const optionalRead = async path => {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
};
export function serializeEnv(values) {
  const lines = ['# 统一配置文件；请勿提交。旧配置的原文见 .env.backups/。'];
  for (const [key, raw] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('环境变量名称无效');
    const value = String(raw);
    const quote = ["'", '"'].find(candidate => !value.includes(candidate));
    // Compose只保证单/双引号兼容；双引号中的$会被Compose插值。
    if ((quote === '"' && value.includes('$')) || (!quote && /[#\r\n$`]|^["']/.test(value))) throw new Error(`配置 ${key} 无法同时兼容Node与Compose，请先调整此值的引号或特殊字符`);
    const assignment = quote ? `${key}=${quote}${value}${quote}` : `${key}=${value}`;
    if (parseEnv(assignment)[key] !== value) throw new Error(`无法无损迁移配置 ${key}，请检查其引号和换行格式`);
    lines.push(assignment);
  }
  const text = lines.join('\n') + '\n';
  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(values)) if (parsed[key] !== String(value)) throw new Error(`配置 ${key} 无损校验失败`);
  return text;
}
export async function updateConfiguration(directory, { migrate = false, updates = {} } = {}) {
  directory = resolve(directory);
  const target = join(directory, '.env');
  const original = await optionalRead(target);
  const sources = original === undefined ? [] : [{ name: '.env', text: original }];
  if (migrate) for (const name of legacy) {
    const text = await optionalRead(join(directory, name));
    if (text !== undefined) sources.push({ name, text });
  }
  if (!sources.length) throw new Error('缺少 .env 或可迁移配置，请先按 .env.example 配置服务');
  const values = {}, overridden = new Set();
  for (const source of sources) for (const [key, value] of Object.entries(parseEnv(source.text))) {
    if (values[key] !== undefined && values[key] !== value) overridden.add(key);
    values[key] = value;
  }
  Object.assign(values, updates);
  const text = serializeEnv(values); // 任何无法表示的内容都在写入/移除前拒绝。
  const backup = join(directory, '.env.backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await chmod(dirname(backup), 0o700);
  for (const source of sources) {
    const path = join(backup, source.name);
    await copyFile(join(directory, source.name), path); await chmod(path, 0o600);
  }
  const temporary = join(directory, `.env.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target); await chmod(target, 0o600);
  } finally { await rm(temporary, { force: true }); }
  if (migrate) for (const source of sources) if (source.name !== '.env') await rm(join(directory, source.name));
  return { backup: basename(backup), migrated: sources.map(source => source.name).filter(name => name !== '.env'), overriddenKeys: [...overridden], updatedKeys: Object.keys(updates) };
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory = '.', image, port] = process.argv.slice(2);
  if (!['migrate', 'deploy'].includes(command)) throw new Error('用法：node env-config.mjs migrate <目录> 或 deploy <目录> <镜像> <宿主端口>');
  if (command === 'deploy' && (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image || '') || (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)))) throw new Error('镜像或端口无效');
  console.log(JSON.stringify(await updateConfiguration(directory, { migrate: true, updates: command === 'deploy' ? { LEXUE_IMAGE: image, ...(port ? { LEXUE_PORT: port } : {}) } : {} })));
}
