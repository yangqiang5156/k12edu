import { readFile, writeFile, mkdir, copyFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const stories = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
const base = new URL('../.cache/story-production/', import.meta.url).pathname;
const audio = new URL('../public/stories/', import.meta.url).pathname;
const originals = join(base, 'unnormalized');
await mkdir(originals, { recursive: true });

function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.slice(-600))));
  });
}
const duration = async path => Number(await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]));

for (const story of stories) {
  const cuePath = join(base, 'cues', `${story.id}.json`);
  let sheet;
  try { sheet = JSON.parse(await readFile(cuePath, 'utf8')); } catch { continue; }
  const path = join(audio, `${story.id}-${sheet.version}.mp3`);
  const current = await duration(path);
  const [minimum, maximum] = story.stage === 'kindergarten' ? [180, 360]
    : story.stage === 'primary-lower' ? [360, 600] : [600, 900];
  if (current >= minimum && current <= maximum) continue;
  const target = current < minimum ? minimum + 5 : maximum - 5;
  const tempo = current / target;
  if (tempo < .8 || tempo > 1.25) throw new Error(`${story.id} 需要变速 ${tempo.toFixed(3)}，超过安全范围，请人工调整正文`);
  const temporary = join(base, `${story.id}-normalized.mp3`);
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', `atempo=${tempo.toFixed(6)}`, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', temporary]);
  if ((await stat(temporary)).size < 100_000) throw new Error(`${story.id} 变速后音频无效`);
  const adjusted = await duration(temporary);
  if (adjusted < minimum || adjusted > maximum) throw new Error(`${story.id} 变速后 ${adjusted.toFixed(1)} 秒仍不达标`);
  const original = join(originals, `${story.id}-${sheet.version}.mp3`);
  try { await stat(original); } catch { await copyFile(path, original); }
  const scale = adjusted / current;
  sheet.cues = sheet.cues.map(cue => ({ ...cue,
    startSeconds: Number((cue.startSeconds * scale).toFixed(3)),
    endSeconds: Number((cue.endSeconds * scale).toFixed(3)),
  }));
  sheet.durationSeconds = Math.round(adjusted);
  sheet.normalizedFromSeconds = Number(current.toFixed(3));
  await rename(temporary, path);
  await writeFile(cuePath, JSON.stringify(sheet, null, 2) + '\n');
  process.stdout.write(`${story.title} ${current.toFixed(1)}秒 → ${adjusted.toFixed(1)}秒\n`);
}
