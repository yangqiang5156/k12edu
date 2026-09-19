import { chmod, copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const [, , sourcePath, targetPath] = process.argv;
if (!sourcePath || !targetPath) throw new Error('用法：node merge-env.mjs <补充来源.env> <生产.env>');

const parse = (text) => {
  const values = new Map();
  const indexes = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) { values.set(match[1], match[2]); indexes.set(match[1], index); }
  });
  return { values, indexes };
};

const [sourceText, targetText] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(targetPath, 'utf8')]);
const source = parse(sourceText);
const target = parse(targetText);
const lines = targetText.replace(/\s*$/, '').split(/\r?\n/);
const filled = [];
const added = [];
const preserved = [];

for (const [key, value] of source.values) {
  if (!value.trim()) continue;
  const current = target.values.get(key);
  if (current?.trim()) { preserved.push(key); continue; }
  const line = `${key}=${value}`;
  if (target.indexes.has(key)) { lines[target.indexes.get(key)] = line; filled.push(key); }
  else { lines.push(line); added.push(key); }
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${targetPath}.backup-before-env-merge-${timestamp}`;
const temporaryPath = join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.tmp`);
await copyFile(targetPath, backupPath);
await chmod(backupPath, 0o600);
await writeFile(temporaryPath, `${lines.join('\n')}\n`, { mode: 0o600 });
await rename(temporaryPath, targetPath);
await chmod(targetPath, 0o600);

console.log(JSON.stringify({ filled, added, preservedCount: preserved.length, backup: basename(backupPath) }, null, 2));
