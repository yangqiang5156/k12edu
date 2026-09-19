import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAudioCache } from './audio-cache.mjs';

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('语音共享缓存', () => {
  it('按模型、音色、语言和文本生成稳定键并持久读取', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lexue-audio-cache-'));
    temporary.push(directory);
    const cache = createAudioCache({ TTS_CACHE_DIR: directory });
    const input = { provider: 'qwen', model: 'tts', voice: 'voice-a', language: 'zh', text: '你好' };
    const key = cache.keyFor(input);
    expect(cache.keyFor(input)).toBe(key);
    expect(cache.keyFor({ ...input, voice: 'voice-b' })).not.toBe(key);
    expect(await cache.get(key)).toBeUndefined();
    await cache.put(key, { bytes: Buffer.from('wave'), type: 'audio/wav' });
    await expect(cache.get(key)).resolves.toMatchObject({ bytes: Buffer.from('wave'), type: 'audio/wav', source: 'local' });
  });
});
