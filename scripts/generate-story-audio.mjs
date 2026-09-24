import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const stories = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
if (stories.some(story => story.audioVersion !== 'v1')) {
  throw new Error('检测到已发布的千问长版故事。此旧版系统语音脚本不得覆盖长版录音，请使用 build-story-audio.mjs。');
}
const output = new URL('../public/stories/', import.meta.url);
await mkdir(output, { recursive: true });

function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${file} 执行失败：${error}`)));
  });
}

const temporary = await mkdtemp(join(tmpdir(), 'lexue-stories-'));
try {
  for (const [index, story] of stories.entries()) {
    const aiff = join(temporary, `${story.id}.aiff`);
    const mp3 = join(output.pathname, `${story.id}-${story.audioVersion}.mp3`);
    const text = `${story.title}。${story.paragraphs.join('。')}`;
    await command('say', ['-v', 'Tingting', '-r', '155', '-o', aiff, text]);
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-codec:a', 'libmp3lame', '-b:a', '64k', mp3]);
    process.stdout.write(`${index + 1}/${stories.length} ${story.title}\n`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
