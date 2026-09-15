import { describe, expect, it } from 'vitest';
import { lessonSpeechRequest } from './lesson-speech';
import type { DailyItem } from './types';

describe('课程朗读文本', () => {
  it('字母B只朗读大写、小写和例词各一次', () => {
    const item: DailyItem = {
      id: 'today-letter-b', contentId: 'letter-b', kind: 'letter', title: 'B b',
      detail: '字母 B\n⚽ ball · 球'
    };
    expect(lessonSpeechRequest(item)).toEqual({
      text: 'B. b. ball.',
      language: 'en'
    });
    expect(lessonSpeechRequest(item).text).not.toMatch(/[\u4e00-\u9fff⚽]/);
    expect(lessonSpeechRequest(item).text).not.toContain('is for');
  });

  it('缺少例词时仍只朗读大小写字母', () => {
    const item: DailyItem = { id: 'letter-z', contentId: 'letter-z', kind: 'letter', title: 'Z z' };
    expect(lessonSpeechRequest(item)).toEqual({ text: 'Z. z.', language: 'en' });
  });

  it('其他课程保持原有自动语言朗读', () => {
    const item: DailyItem = { id: 'char', contentId: 'char', kind: 'character', title: '人' };
    expect(lessonSpeechRequest(item)).toEqual({ text: '人。这个字读，人。', language: 'auto' });
  });

  it('古诗朗读包含朝代和作者', () => {
    const item: DailyItem = {
      id: 'poem', contentId: 'poem-2', kind: 'poem', title: '静夜思',
      detail: '唐·李白\n床前明月光，疑是地上霜。'
    };
    expect(lessonSpeechRequest(item, item.detail)).toEqual({
      text: '静夜思。唐·李白\n床前明月光，疑是地上霜。',
      language: 'auto'
    });
  });
});

it('数学只读题目，不泄露正确答案', () => {
  expect(lessonSpeechRequest({ id: 'm', contentId: 'm', kind: 'math-choice', title: '加法', prompt: '两个苹果加一个，一共有几个？', answer: '3', options: ['2', '3', '4'] })).toEqual({ text: '两个苹果加一个，一共有几个？', language: 'zh' });
});
