import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const storiesUrl = new URL('../src/data/stories.json', import.meta.url);
const stories = JSON.parse(await readFile(storiesUrl, 'utf8'));
const drafts = JSON.parse(await readFile(new URL('../src/data/story-drafts.json', import.meta.url), 'utf8'));
const partial = process.argv.includes('--partial');
const cueDirectory = new URL('../.cache/story-production/cues/', import.meta.url).pathname;
const audioDirectory = new URL('../public/stories/', import.meta.url).pathname;
if (stories.length !== 40 || drafts.length !== stories.length) throw new Error('故事数量应为 40 篇，且须与扩写稿一致');
const cueManifest = JSON.parse(await readFile(new URL('../src/data/story-cues.json', import.meta.url), 'utf8'));
const durations = JSON.parse(await readFile(new URL('../src/data/story-audio.json', import.meta.url), 'utf8'));
const updated = [];
let published = 0;
for (const story of stories) {
  const draft = drafts.find(item => item.id === story.id);
  if (!draft || draft.stage !== story.stage || draft.title !== story.title) throw new Error(`${story.id} 扩写稿不匹配`);
  let sheet;
  try { sheet = JSON.parse(await readFile(join(cueDirectory, `${story.id}.json`), 'utf8')); }
  catch (error) {
    sheet = cueManifest[story.id];
    if (!sheet) { if (partial) { updated.push(story); continue; } throw error; }
  }
  if (!['v2', 'v3'].includes(sheet.version) || sheet.id !== story.id || !sheet.cues?.length) throw new Error(`${story.id} 缺少有效逐句时间点`);
  if (sheet.cues.map(cue => cue.text).join('') !== draft.paragraphs.join('')) throw new Error(`${story.id} 朗读高亮与正文不一致`);
  for (let index = 0; index < sheet.cues.length; index++) {
    const cue = sheet.cues[index];
    if (cue.paragraphIndex < 0 || cue.paragraphIndex >= draft.paragraphs.length || cue.endSeconds <= cue.startSeconds) throw new Error(`${story.id} 第${index + 1}句时间点无效`);
    if (index && Math.abs(cue.startSeconds - sheet.cues[index - 1].endSeconds) > .01) throw new Error(`${story.id} 高亮时间不连续`);
  }
  const audio = join(audioDirectory, `${story.id}-${sheet.version}.mp3`);
  if ((await stat(audio)).size < 100_000) throw new Error(`${story.id} 音频文件过小`);
  const [min, max] = story.stage === 'kindergarten' ? [180, 360] : story.stage === 'primary-lower' ? [360, 600] : [600, 900];
  if (sheet.durationSeconds < min || sheet.durationSeconds > max) throw new Error(`${story.id} 音频时长 ${sheet.durationSeconds} 秒不在 ${min}—${max} 秒范围`);
  cueManifest[story.id] = sheet;
  durations[story.id] = sheet.durationSeconds;
  updated.push({ ...story, audioVersion: sheet.version, paragraphs: draft.paragraphs });
  published++;
}
await writeFile(storiesUrl, JSON.stringify(updated, null, 2) + '\n');
await writeFile(new URL('../src/data/story-cues.json', import.meta.url), JSON.stringify(cueManifest, null, 2) + '\n');
await writeFile(new URL('../src/data/story-audio.json', import.meta.url), JSON.stringify(durations, null, 2) + '\n');
process.stdout.write(`${published} 篇长版故事、千问录音及逐句时间点已核对并发布到应用数据。\n`);
