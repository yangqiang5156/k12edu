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
      text: 'B. B. ball.',
      language: 'en',
      segments: ['B', 'B', 'ball'],
      pauseMs: 1000
    });
    expect(lessonSpeechRequest(item).text).not.toMatch(/[\u4e00-\u9fff⚽]/);
    expect(lessonSpeechRequest(item).text).not.toContain('is for');
  });

  it('缺少例词时仍只朗读大小写字母', () => {
    const item: DailyItem = { id: 'letter-z', contentId: 'letter-z', kind: 'letter', title: 'Z z' };
    expect(lessonSpeechRequest(item)).toEqual({ text: 'Z. Z.', language: 'en', segments: ['Z', 'Z'], pauseMs: 1000 });
  });

  it('识字朗读汉字及其常用组词', () => {
    const item: DailyItem = { id: 'char', contentId: 'char', kind: 'character', title: '人', exampleWord: '人们' };
    expect(lessonSpeechRequest(item)).toEqual({ text: '人。这个字读，人。组词，人们。', language: 'zh' });
  });

  it('英语单词先读英文，再用中文语音读释义', () => {
    const item: DailyItem = { id: 'word', contentId: 'word-1', kind: 'word', title: 'apple', detail: '苹果' };
    expect(lessonSpeechRequest(item, item.detail)).toEqual({
      text: 'apple。苹果。', language: 'auto', pauseMs: 1000,
      multilingualSegments: [{ text: 'apple', language: 'en' }, { text: '苹果', language: 'zh' }]
    });
    expect(lessonSpeechRequest({ ...item, detail: '单词发音\n苹果' }, '单词发音\n苹果').multilingualSegments)
      .toEqual([{ text: 'apple', language: 'en' }, { text: '苹果', language: 'zh' }]);
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

  it('科学朗读包含问题、方法、结果和解释', () => {
    const item: DailyItem = {
      id: 'science', contentId: 'science-1', kind: 'science', title: '会浮起来吗？',
      detail: '准备一片树叶和一块小石头，猜一猜谁会浮在水面。'
    };
    const request = lessonSpeechRequest(item, item.detail);
    expect(request.language).toBe('zh');
    expect(request.text).toContain('科学问题');
    expect(request.text).toContain('观察方法');
    expect(request.text).toContain('观察结果');
    expect(request.text).toContain('科学解释');
  });
});

it('数学只读题目，不泄露正确答案', () => {
  expect(lessonSpeechRequest({ id: 'm', contentId: 'm', kind: 'math-choice', title: '加法', prompt: '两个苹果加一个，一共有几个？', answer: '3', options: ['2', '3', '4'] })).toEqual({ text: '两个苹果加一个，一共有几个？', language: 'zh' });
});
