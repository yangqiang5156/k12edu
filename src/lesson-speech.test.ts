import { describe, expect, it } from 'vitest';
import { lessonSpeechRequest } from './lesson-speech';
import type { DailyItem } from './types';

describe('课程朗读文本', () => {
  it('字母B使用纯英文上下文，避免自动语言识别产生起始杂音', () => {
    const item: DailyItem = {
      id: 'today-letter-b', contentId: 'letter-b', kind: 'letter', title: 'B b',
      detail: '字母 B\n⚽ ball · 球'
    };
    expect(lessonSpeechRequest(item)).toEqual({
      text: 'The letter B. B. B. B is for ball.',
      language: 'en'
    });
    expect(lessonSpeechRequest(item).text).not.toMatch(/[\u4e00-\u9fff⚽]/);
  });

  it('其他课程保持原有自动语言朗读', () => {
    const item: DailyItem = { id: 'char', contentId: 'char', kind: 'character', title: '人' };
    expect(lessonSpeechRequest(item)).toEqual({ text: '人。这个字读，人。', language: 'auto' });
  });
});
