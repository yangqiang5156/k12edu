import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it, expect } from 'vitest';
import { parseEnv } from 'node:util';
import { loadConfiguration } from './environment.mjs';
import { updateConfiguration } from '../deploy/env-config.mjs';
const roots = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'lexue-env-')); roots.push(root); return root; };
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe('统一.env配置', () => {
  it('只读取.env，不读取任何旧文件；运行时注入值优先', () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), "KEY='current'\nVALUE='a$#b'\nPORT=8082\n");
    for (const name of ['.env.local','.env.runtime','.env.tts','.env.production']) writeFileSync(join(root, name), 'KEY=legacy\nOTHER=ignored');
    expect(loadConfiguration(root, { PORT: '80' })).toEqual({ KEY: 'current', VALUE: 'a$#b', PORT: '80' });
  });
  it('旧文件按原优先级合并，保留每项配置、先备份再移除；备份与目标仅本人可读', async () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), 'IMAGE=old\nKEY=base\n');
    writeFileSync(join(root, '.env.runtime'), 'KEY=runtime\nDATABASE_URL=connection\n');
    writeFileSync(join(root, '.env.tts'), 'KEY=tts\nVOICE=test\n');
    writeFileSync(join(root, '.env.local'), 'KEY=local\n');
    const result = await updateConfiguration(root, { migrate: true });
    expect(loadConfiguration(root, {})).toEqual({ IMAGE:'old', KEY:'local', DATABASE_URL:'connection', VOICE:'test' });
    expect(result.overriddenKeys).toEqual(['KEY']);
    expect(existsSync(join(root, '.env.local'))).toBe(false);
    const backup = join(root, '.env.backups', result.backup);
    expect(readFileSync(join(backup, '.env.tts'), 'utf8')).toContain('KEY=tts');
    expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
    expect(statSync(backup).mode & 0o777).toBe(0o700);
  });
  it('发布、回滚只更新镜像和端口，密码特殊字符与多行值无损保留', async () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), "LEXUE_IMAGE=old\nLEXUE_PORT=8081\nSECRET='hash$literal#note'\nMULTI='first\nsecond'\nEMPTY=\n");
    for (const image of ['new', 'old']) {
      await updateConfiguration(root, { updates: { LEXUE_IMAGE: image, LEXUE_PORT: '8081' } });
      const parsed = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
      expect(parsed).toEqual({ LEXUE_IMAGE:image, LEXUE_PORT:'8081', SECRET:'hash$literal#note', MULTI:'first\nsecond', EMPTY:'' });
    }
    expect(readdirSync(join(root, '.env.backups'))).toHaveLength(2);
  });
  it('缺少配置拒绝发布，不生成空配置覆盖生产', async () => {
    const root = fixture(); await expect(updateConfiguration(root)).rejects.toThrow('缺少');
    expect(existsSync(join(root, '.env'))).toBe(false);
  });
});

describe('迁移失败保护', () => {
  it('不能兼容的引号组合在备份/删除前拒绝，原文件保持完整', async () => {
    const root = fixture(), original = "SECRET=`a'b\"#c`\n";
    writeFileSync(join(root, '.env'), original);
    writeFileSync(join(root, '.env.tts'), 'VOICE=test\n');
    await expect(updateConfiguration(root, { migrate: true })).rejects.toThrow('兼容');
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(original);
    expect(existsSync(join(root, '.env.tts'))).toBe(true);
  });
});

describe('实际Node启动读取', () => {
  it('容器启动参数及统一加载模块都读取.env且不受旧文件影响', () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), "QWEN_API_KEY='fake$value#suffix'\nPORT=8082\n");
    writeFileSync(join(root, '.env.local'), 'QWEN_API_KEY=wrong-local');
    writeFileSync(join(root, '.env.tts'), 'QWEN_API_KEY=wrong-tts');
    const bootstrap = new URL('./load-env.mjs', import.meta.url).href;
    for (const flags of [[], ['--env-file=.env']]) {
      const result = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', `import ${JSON.stringify(bootstrap)}; console.log(JSON.stringify({key:process.env.QWEN_API_KEY,port:process.env.PORT}));`], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, PORT:'80' } });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ key:'fake$value#suffix', port:'80' });
    }
  });
});

describe('自动发布端口保留', () => {
  it('自动发布不传端口时，保留.env中现有宿主端口和私有设置', () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), 'LEXUE_IMAGE=old\nLEXUE_PORT=8088\nSECRET=private\n');
    const script = new URL('../deploy/env-config.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [script, 'deploy', root, 'new:version'], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(loadConfiguration(root, {})).toEqual({ LEXUE_IMAGE:'new:version', LEXUE_PORT:'8088', SECRET:'private' });
  });
});
