import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const binary = process.env.GITLEAKS_BINARY || 'gitleaks';
const root = resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
const temporary = mkdtempSync(join(tmpdir(), 'lexue-secret-scan-'));
try {
  execFileSync(binary, ['git', '--no-banner', '--redact=100', '--ignore-gitleaks-allow', '--log-opts=--all', root], { stdio: 'inherit' });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  for (const name of new Set(files)) {
    const source = join(root, name), target = join(temporary, name);
    try {
      if (!lstatSync(source).isFile()) continue;
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  execFileSync(binary, ['dir', '--no-banner', '--redact=100', '--ignore-gitleaks-allow', temporary], { stdio: 'inherit' });
  console.log('可达Git历史与当前待公开文件的凭据扫描通过（不包含被忽略的私有配置）。');
} finally { rmSync(temporary, { recursive: true, force: true }); }
