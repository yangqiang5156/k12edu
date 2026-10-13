import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const binary = process.env.GITLEAKS_BINARY || 'gitleaks';
const available = spawnSync(binary, ['version']).status === 0;
const script = new URL('./security-scan.mjs', import.meta.url).pathname;
const roots = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'lexue-scan-test-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Security Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'empty'], { cwd: root });
  return root;
}
const fakeKey = () => 'AKIA' + [...randomBytes(16)].map(value => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[value % 32]).join('');
const scan = root => spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, GITLEAKS_BINARY: binary }, encoding: 'utf8' });
(available ? describe : describe.skip)('真实凭据扫描器发布门禁', () => {
  it('被忽略私有环境文件不进入公开文件扫描', () => {
    const root = repository(); writeFileSync(join(root, '.gitignore'), '.env\n');
    writeFileSync(join(root, '.env'), `AWS_ACCESS_KEY_ID=${fakeKey()}\n`);
    expect(scan(root).status).toBe(0);
  });
  it('待公开文件出现密钥则失败并脱敏输出', () => {
    const root = repository(), key = fakeKey(); writeFileSync(join(root, 'config.txt'), `AWS_ACCESS_KEY_ID=${key}\n`);
    const result = scan(root); expect(result.status).not.toBe(0); expect(result.stdout + result.stderr).not.toContain(key);
  });
  it('当前文件删除密钥也不能通过包含密钥的历史', () => {
    const root = repository(), key = fakeKey(); writeFileSync(join(root, 'config.txt'), `AWS_ACCESS_KEY_ID=${key}\n`);
    execFileSync('git', ['add', 'config.txt'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Security Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fake secret test'], { cwd: root });
    writeFileSync(join(root, 'config.txt'), '已删除测试凭据\n');
    const result = scan(root); expect(result.status).not.toBe(0); expect(result.stdout + result.stderr).not.toContain(key);
  });
});
