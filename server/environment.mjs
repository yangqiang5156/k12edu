import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// 仅读取当前工作目录的 .env；宿主注入值（如容器内部端口、CI测试参数）优先。
export function loadConfiguration(directory = process.cwd(), inherited = process.env) {
  let text = '';
  try { text = readFileSync(resolve(directory, '.env'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...parseEnv(text), ...inherited };
}
