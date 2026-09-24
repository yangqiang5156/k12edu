import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const stories = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
const audioDir = new URL('../public/stories/', import.meta.url).pathname;

function duration(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 && Number(output) > 1 ? resolve(Math.round(Number(output))) : reject(new Error(`音频无效：${path}`)));
  });
}

const manifest = Object.fromEntries(await Promise.all(stories.map(async story => [story.id, await duration(join(audioDir, `${story.id}-${story.audioVersion}.mp3`))])));
await writeFile(new URL('../src/data/story-audio.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`已核对 ${stories.length} 篇音频；时长 ${Math.min(...Object.values(manifest))}–${Math.max(...Object.values(manifest))} 秒\n`);
