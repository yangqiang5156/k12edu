import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { packageRelease, runtimeKey } from './release-package.mjs';

const directories = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lexue-release-'));
  directories.push(root);
  for (const dir of ['server', 'dist', 'deploy', 'node_modules', 'data']) mkdirSync(join(root, dir));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.11.0', dependencies: { pg: '^8.0.0' } }));
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'allowBuilds: {}\n');
  writeFileSync(join(root, 'deploy/Dockerfile.environment'), 'FROM node:22-alpine\n');
  writeFileSync(join(root, 'deploy/Dockerfile.environment.dockerignore'), '**\n!package.json\n');
  writeFileSync(join(root, 'deploy/Dockerfile.app'), 'ARG LEXUE_RUNTIME_IMAGE\nFROM ${LEXUE_RUNTIME_IMAGE}\n');
  writeFileSync(join(root, 'server/index.mjs'), 'console.log("应用");');
  writeFileSync(join(root, 'dist/index.html'), '<h1>乐学</h1>');
  writeFileSync(join(root, '.env'), 'SECRET=private');
  writeFileSync(join(root, 'data/story.mp3'), 'private audio');
  writeFileSync(join(root, 'node_modules/unwanted'), 'dependency');
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('轻量发布包与环境标识', () => {
  it('应用版本和代码变化不会改变环境，依赖和环境定义变化会改变环境', () => {
    const root = fixture(); const original = runtimeKey(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.12.0', dependencies: { pg: '^8.0.0' } }));
    writeFileSync(join(root, 'server/index.mjs'), '新代码');
    expect(runtimeKey(root)).toBe(original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.12.0', dependencies: { pg: '^9.0.0' } }));
    expect(runtimeKey(root)).not.toBe(original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.11.0', dependencies: { pg: '^8.0.0' } }));
    writeFileSync(join(root, 'deploy/Dockerfile.environment'), 'FROM node:24-alpine\n');
    expect(runtimeKey(root)).not.toBe(original);
  });
  it('只包含应用文件，排除密钥、数据和依赖，并生成可验证的校验文件', () => {
    const root = fixture(); const output = join(root, 'release');
    const { archive } = packageRelease(root, 'v0.11.0', output);
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(files).toContain('dist/index.html'); expect(files).toContain('server/index.mjs');
    expect(files).not.toContain('.env'); expect(files).not.toContain('node_modules'); expect(files).not.toContain('story.mp3');
    execFileSync('shasum', ['-a', '256', '-c', `${archive}.sha256`], { cwd: output });
    expect(() => packageRelease(root, 'v0.12.0', output)).toThrow('版本不一致');
  });
});

function deployFixture(mode = 'success', missing = false) {
  const root = fixture(); packageRelease(root, 'v0.11.0', root);
  writeFileSync(join(root, '.env'), 'LEXUE_IMAGE=old:version\nLEXUE_PORT=8081\n');
  writeFileSync(join(root, '.env.runtime'), 'RUNTIME_SECRET=preserve-runtime');
  writeFileSync(join(root, '.env.tts'), 'TTS_SECRET=preserve-tts');
  writeFileSync(join(root, 'env-config.mjs'), readFileSync(resolve('deploy/env-config.mjs')));
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_ROOT/docker.log"
case "$1" in
  inspect)
    case "$3" in
      *Config.Image*) printf 'old:version\\n' ;;
      *) if [ "$MOCK_MODE" = unhealthy ] && grep -q "LEXUE_IMAGE='new:version'" "$MOCK_ROOT/.env"; then printf 'unhealthy\\n'; else printf 'healthy\\n'; fi ;;
    esac ;;
  image)
    if [ "$MOCK_MISSING" = true ] && [ "$3" = runtime:fixed ] && [ ! -f "$MOCK_ROOT/loaded" ]; then exit 1; fi ;;
  run)
    shift
    while [ "$1" != env-config.mjs ]; do shift; done
    shift
    action="$1"; shift; shift
    node "$MOCK_ROOT/env-config.mjs" "$action" "$MOCK_ROOT" "$@"
    ;;
  load) touch "$MOCK_ROOT/loaded" ;;
  build) if [ "$MOCK_MODE" = build-fail ]; then exit 1; fi ;;
  compose) if [ "$MOCK_MODE" = compose-fail ] && grep -q "LEXUE_IMAGE='new:version'" "$MOCK_ROOT/.env"; then exit 1; fi ;;
esac
`, { mode: 0o755 });
  if (missing) {
    writeFileSync(join(root, 'runtime.tar'), 'runtime image');
    execFileSync('gzip', ['runtime.tar'], { cwd: root });
    const hash = execFileSync('shasum', ['-a', '256', 'runtime.tar.gz'], { cwd: root, encoding: 'utf8' });
    writeFileSync(join(root, 'runtime.tar.gz.sha256'), hash);
  }
  const run = () => spawnSync('sh', [resolve('deploy/remote-deploy.sh')], { cwd: root, encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_ROOT: root, MOCK_MODE: mode, MOCK_MISSING: String(missing),
    LEXUE_IMAGE: 'new:version', LEXUE_RUNTIME_IMAGE: 'runtime:fixed', LEXUE_APP_ARCHIVE: 'lexue-app-v0.11.0.tar.gz',
    LEXUE_RUNTIME_ARCHIVE: missing ? 'runtime.tar.gz' : '', LEXUE_PORT: '8081'
  } });
  return { root, run };
}
describe('生产部署失败恢复', () => {
  it('环境已缓存时不导入镜像，离线构建后健康切换并保留私有配置', () => {
    const { root, run } = deployFixture(); const result = run();
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'docker.log'), 'utf8');
    expect(log).not.toContain('load '); expect(log).toContain('build --network none --pull=false');
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain("LEXUE_IMAGE='new:version'");
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('RUNTIME_SECRET=');
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('preserve-runtime');
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('preserve-tts');
  });
  it('服务器缺少环境时先校验并导入环境，再构建应用', () => {
    const { root, run } = deployFixture('success', true); const result = run();
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'docker.log'), 'utf8');
    expect(log.indexOf('load -i')).toBeLessThan(log.indexOf('build --network'));
  });
  it('校验失败或构建失败时不会切换生产镜像', () => {
    for (const mode of ['checksum-fail', 'build-fail']) {
      const { root, run } = deployFixture(mode);
      if (mode === 'checksum-fail') writeFileSync(join(root, 'lexue-app-v0.11.0.tar.gz'), 'tampered');
      expect(run().status).not.toBe(0);
      expect(readFileSync(join(root, '.env'), 'utf8')).toMatch(/LEXUE_IMAGE=['"]?old:version/);
    }
  });
  it('新容器启动或健康检查失败会回滚旧镜像，并将发布标记为失败', () => {
    for (const mode of ['unhealthy', 'compose-fail']) {
      const { root, run } = deployFixture(mode); const result = run();
      expect(result.status).toBe(1);
      expect(readFileSync(join(root, '.env'), 'utf8')).toMatch(/LEXUE_IMAGE=['"]?old:version/);
      expect(result.stderr).toContain('已回滚到');
      const env = readFileSync(join(root, '.env'), 'utf8');
      expect(env).toContain('preserve-runtime'); expect(env).toContain('preserve-tts');
    }
  });
});
