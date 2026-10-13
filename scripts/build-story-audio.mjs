import '../server/load-env.mjs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { synthesize } from '../server/tts.mjs';

const stories = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
const publishedCues = JSON.parse(await readFile(new URL('../src/data/story-cues.json', import.meta.url), 'utf8'));
let drafts;
try { drafts = JSON.parse(await readFile(new URL('../src/data/story-drafts.json', import.meta.url), 'utf8')); } catch { drafts = []; }
const cache = new URL('../.cache/story-production/', import.meta.url).pathname;
const audioDir = join(cache, 'final');
await mkdir(join(cache, 'clips'), { recursive: true });
await mkdir(join(cache, 'cues'), { recursive: true });
await mkdir(audioDir, { recursive: true });
const selected = process.argv.includes('--story') ? process.argv[process.argv.indexOf('--story') + 1] : undefined;
const availableOnly = process.argv.includes('--available');
const force = process.argv.includes('--force');
const model = process.env.QWEN_TTS_MODEL || 'qwen-audio-3.1-tts-flash';
const voice = process.env.QWEN_TTS_VOICE || 'longanhuan_v3.1';
if ((process.env.TTS_PROVIDER || 'qwen') !== 'qwen') throw new Error('故事录制目前仅支持项目配置的千问语音服务');

function sentences(paragraph) {
  const chunks = paragraph.match(/[^。！？!?]+[。！？!?]*(?:[”’」』])?/g) || [paragraph];
  if (chunks.join('') !== paragraph) throw new Error('句子分段改变了正文');
  return chunks;
}
function emotion(text, stage) {
  if (/小心|危险|洪水|狼来了|求助|紧急|不要/.test(text)) return '[serious]';
  if (/害怕|难过|伤心|想家|哭|道歉|失落/.test(text)) return '[empathetic]';
  if (/惊讶|原来|忽然|竟然|哎呀|发现/.test(text)) return '[amazed]';
  if (/加油|欢呼|高兴|终于|成功|开心|笑/.test(text)) return '[excited]';
  if (/[？?]/.test(text)) return '[curious]';
  return stage === 'kindergarten' ? '[empathetic]' : '';
}
function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${file} ${stderr.slice(-600)}`)));
  });
}
const duration = async path => Number(await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]));
const valid = async path => { try { return (await stat(path)).size > 1000 && await duration(path) > 0.2; } catch { return false; } };

async function build(story, ordinal) {
  const version = force && story.audioVersion === 'v2' ? 'v3' : story.audioVersion === 'v3' ? 'v3' : 'v2';
  const expanded = drafts.find(draft => draft.id === story.id)
    || JSON.parse(await readFile(join(cache, 'expanded', `${story.id}.json`), 'utf8'));
  const rate = story.stage === 'kindergarten' ? .85 : story.stage === 'primary-lower' ? .95 : 1;
  const passages = expanded.paragraphs.flatMap((paragraph, paragraphIndex) => sentences(paragraph).map(text => ({ text, paragraphIndex })));
  const clips = passages.map(({ text }, index) => {
    const spoken = emotion(text, story.stage) + text;
    const hash = createHash('sha256').update(JSON.stringify({ model, voice, spoken, rate })).digest('hex').slice(0, 12);
    return { index, spoken, path: join(cache, 'clips', `${story.id}-${index}-${hash}.wav`) };
  });
  let next = 0;
  const worker = async () => {
    while (next < clips.length) {
      const clip = clips[next++];
      if (await valid(clip.path)) continue;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await synthesize(clip.spoken, 'zh', process.env, fetch, AbortSignal.timeout(90000), { rate });
          if (result.type !== 'audio/wav' || result.bytes.length < 1000) throw new Error('语音接口未返回有效 WAV');
          await writeFile(clip.path, result.bytes);
          if (!await valid(clip.path)) throw new Error('音频校验失败');
          lastError = undefined; break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        }
      }
      if (lastError) throw new Error(`${story.id} 第${clip.index + 1}句合成失败：${lastError.message}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const clipDurations = await Promise.all(clips.map(clip => duration(clip.path)));
  let start = 0;
  const cues = passages.map((passage, index) => {
    const cue = { ...passage, startSeconds: Number(start.toFixed(3)), endSeconds: Number((start + clipDurations[index]).toFixed(3)) };
    start += clipDurations[index];
    return cue;
  });
  const listFile = join(cache, `${story.id}-concat.txt`);
  await writeFile(listFile, clips.map(clip => `file '${clip.path.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
  const mp3 = join(audioDir, `${story.id}-${version}.mp3`);
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', mp3]);
  const total = await duration(mp3);
  if (!Number.isFinite(total) || Math.abs(total - start) > 0.5) throw new Error(`${story.id} 合并时长不匹配：${total} / ${start}`);
  await writeFile(join(cache, 'cues', `${story.id}.json`), JSON.stringify({ id: story.id, version, model, voice, durationSeconds: Math.round(total), cues }, null, 2) + '\n');
  process.stdout.write(`${ordinal}/${stories.length} ${story.title} ${passages.length}句 ${Math.round(total)}秒\n`);
}

for (const [index, story] of stories.entries()) {
  if (selected && selected !== story.id) continue;
  if (!force && ['v2', 'v3'].includes(story.audioVersion) && publishedCues[story.id]?.version === story.audioVersion
    && await valid(join(audioDir, `${story.id}-${story.audioVersion}.mp3`))) {
    process.stdout.write(`${index + 1}/${stories.length} ${story.title} 已发布录音\n`);
    continue;
  }
  if (availableOnly) {
    try { if (!drafts.some(draft => draft.id === story.id)) await stat(join(cache, 'expanded', `${story.id}.json`)); }
    catch { continue; }
  }
  const cueFile = join(cache, 'cues', `${story.id}.json`);
  try {
    const existing = JSON.parse(await readFile(cueFile, 'utf8'));
    const expectedVersion = force && story.audioVersion === 'v2' ? 'v3' : story.audioVersion === 'v3' ? 'v3' : 'v2';
    const expanded = drafts.find(draft => draft.id === story.id)
      || JSON.parse(await readFile(join(cache, 'expanded', `${story.id}.json`), 'utf8'));
    if (existing.version === expectedVersion && existing.model === model && existing.voice === voice
      && existing.cues?.map(cue => cue.text).join('') === expanded.paragraphs.join('')
      && await valid(join(audioDir, `${story.id}-${expectedVersion}.mp3`))) {
      process.stdout.write(`${index + 1}/${stories.length} ${story.title} 已有录音\n`); continue;
    }
  } catch { /* 尚无完整录音 */ }
  await build(story, index + 1);
}
