import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { numberAudioTokens } from './logic';
import curriculum from './data/curriculum.json';
import { BUILTIN_CONTENT } from './content';

const audioDirectory = resolve(process.cwd(), 'public/audio/numbers');
const literacyAudioDirectory = resolve(process.cwd(), 'public/audio/literacy');
const englishAudioDirectory = resolve(process.cwd(), 'public/audio/english');
const guoxueAudioDirectory = resolve(process.cwd(), 'public/audio/guoxue');

describe('离线数字语音资产', () => {
  it('44个语音文件均存在且不是空音频', () => {
    const files = readdirSync(audioDirectory).filter((file) => file.endsWith('.mp3'));
    expect(files).toHaveLength(44);
    files.forEach((file) => expect(statSync(resolve(audioDirectory, file)).size, file).toBeGreaterThan(1000));
  });

  it('0到1000的每个读音词元都有对应文件', () => {
    const files = new Set(readdirSync(audioDirectory));
    for (let number = 0; number <= 1000; number += 1) {
      numberAudioTokens(number).forEach((token) => expect(files.has(`${token}.mp3`), `${number}: ${token}`).toBe(true));
    }
  });
});

describe('离线识字语音资产', () => {
  it('全部内置汉字均有有效讲读音频', () => {
    const characterCount = new Set(Array.from(curriculum.characterCorpus)).size;
    const files = readdirSync(literacyAudioDirectory).filter((file) => file.endsWith('.mp3'));
    expect(files).toHaveLength(characterCount);
    for (let index = 1; index <= characterCount; index += 1) {
      const filename = `char-${index}.mp3`;
      expect(files).toContain(filename);
      expect(statSync(resolve(literacyAudioDirectory, filename)).size, filename).toBeGreaterThan(1000);
    }
  });
});

describe('离线英文字母语音资产', () => {
  it('A-Z 均有字母名和例词音频', () => {
    const files = readdirSync(englishAudioDirectory).filter((file) => file.endsWith('.mp3'));
    expect(files).toHaveLength(26);
    for (const [, lower] of curriculum.letters) {
      const filename = `letter-${lower}.mp3`;
      expect(files).toContain(filename);
      expect(statSync(resolve(englishAudioDirectory, filename)).size, filename).toBeGreaterThan(1000);
      const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', resolve(englishAudioDirectory, filename)], { encoding: 'utf8' }).trim());
      expect(duration, `${filename} 应包含字母间隔和过渡语`).toBeGreaterThan(4.5);
    }
  });
});

describe('离线国学朗读资产', () => {
  it('所有内置古诗和经典古文都有标题、正文朗读音频', () => {
    const items = BUILTIN_CONTENT.filter((item) => item.module === 'guoxue' && (item.kind === 'poem' || item.kind === 'classic'));
    const files = readdirSync(guoxueAudioDirectory).filter((file) => file.endsWith('.mp3'));
    expect(files).toHaveLength(items.length);
    for (const item of items) {
      const filename = item.kind === 'classic' ? `${item.id}-clean-v2.mp3` : `${item.id}.mp3`;
      expect(files).toContain(filename);
      expect(statSync(resolve(guoxueAudioDirectory, filename)).size, filename).toBeGreaterThan(1000);
    }
  });
});
