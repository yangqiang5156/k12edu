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
    expect(cache.keyFor({ ...input, rate: 1 })).not.toBe(key);
    expect(await cache.get(key)).toBeUndefined();
    await cache.put(key, { bytes: Buffer.from('wave'), type: 'audio/wav' });
    await expect(cache.get(key)).resolves.toMatchObject({ bytes: Buffer.from('wave'), type: 'audio/wav', source: 'local' });
  });
});

describe('缓存容量保护', () => {
  it('淘汰旧内容并拒绝超过容量的单个音频', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lexue-bounded-cache-')); temporary.push(directory);
    const cache = createAudioCache({ TTS_CACHE_DIR: directory, TTS_CACHE_MAX_BYTES: '160' });
    const key = cache.keyFor({ text: 'first' }), next = cache.keyFor({ text: 'second' });
    await cache.put(key, { bytes: Buffer.alloc(80), type: 'audio/wav' });
    await new Promise(resolve => setTimeout(resolve, 10));
    await cache.put(next, { bytes: Buffer.alloc(80), type: 'audio/wav' });
    expect(await cache.get(key)).toBeUndefined();
    expect(await cache.get(next)).toBeDefined();
    await expect(cache.put(key, { bytes: Buffer.alloc(161), type: 'audio/wav' })).rejects.toThrow('过大');
  });
});
