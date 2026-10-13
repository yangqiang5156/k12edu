import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeKey(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  // 版本号和应用代码不影响环境标识，锁文件和环境定义变化才更新环境。
  const dependencies = Object.fromEntries(Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const hash = createHash('sha256').update(JSON.stringify(dependencies));
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'deploy/Dockerfile.environment', 'deploy/Dockerfile.environment.dockerignore']) {
    hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0');
  }
  return hash.digest('hex');
}

export function packageRelease(root, version, outputDirectory) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('版本必须为 vX.Y.Z');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (`v${manifest.version}` !== version) throw new Error('发布标签与 package.json 版本不一致');
  mkdirSync(outputDirectory, { recursive: true });
  const filename = `lexue-app-${version}.tar.gz`;
  const archive = resolve(outputDirectory, filename);
  // 白名单打包，不包含 .env、学习数据、node_modules 或 OSS 音频。
  execFileSync('tar', ['-czf', archive, '-C', root, 'package.json', 'server', 'dist', 'deploy/Dockerfile.app']);
  const bytes = readFileSync(archive);
  writeFileSync(`${archive}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
  return { archive, bytes: bytes.length, runtimeKey: runtimeKey(root) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, version, output = 'release'] = process.argv.slice(2);
  if (command === 'runtime-key') console.log(runtimeKey(process.cwd()));
  else if (command === 'package') console.log(JSON.stringify(packageRelease(process.cwd(), version, resolve(output))));
  else throw new Error('用法：release-package.mjs runtime-key 或 package vX.Y.Z [输出目录]');
}
