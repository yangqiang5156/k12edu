import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createStoryStorage } from '../server/story-storage.mjs';

const configured = process.env.STORY_AUDIO_SOURCE_DIR?.trim();
const directory = configured || new URL('../.cache/story-production/final/', import.meta.url).pathname;
const storage = createStoryStorage();
if (!storage.enabled) throw new Error('请先配置 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET');
const files = (await readdir(directory)).filter(file => file.endsWith('.mp3')).sort();
if (!files.length) throw new Error('public/stories 中没有可上传的 MP3');

for (const [index, file] of files.entries()) {
  const path = join(directory, file);
  const size = (await stat(path)).size;
  const key = storage.builtInKey(file);
  let uploaded = false;
  try {
    const remote = await storage.head(key);
    uploaded = Number(remote.res?.headers?.['content-length']) === size;
  } catch (error) {
    if (error?.status !== 404 && error?.code !== 'NoSuchKey') throw error;
  }
  if (!uploaded) await storage.put(key, path);
  const verified = await storage.head(key);
  const remoteSize = Number(verified.res?.headers?.['content-length']);
  if (remoteSize !== size) throw new Error(`${file} 上传后大小不一致：${remoteSize}/${size}`);
  process.stdout.write(`${index + 1}/${files.length} ${file} ${uploaded ? '已存在' : '已上传'}\n`);
}
