import { describe, expect, it } from 'vitest';
import { splitStorySentences, validateStoryDraft } from './story-service.mjs';

describe('家庭故事校验', () => {
  const paragraphs = [
    '小兔子住在山脚下。每天晚上，它都会和月亮说晚安。'.repeat(4),
    '有一天，风吹动了窗帘，小兔子有一点紧张。妈妈陪它一起看看，原来只是晚风。'.repeat(3),
    '小兔子学会深呼吸，也学会打开小夜灯。它慢慢睡着，梦见自己在星星间散步。'.repeat(3),
  ];
  it('保留逐句文字并生成适龄故事结构', () => {
    const draft = validateStoryDraft({ title: '小兔子的晚安灯', summary: '一个温暖的睡前故事', ageMin: 4, ageMax: 6, themes: ['bedtime'], paragraphs });
    expect(draft.stage).toBe('kindergarten');
    expect(draft.paragraphs.join('')).toBe(paragraphs.join(''));
    expect(splitStorySentences('第一句。第二句？')).toEqual(['第一句。', '第二句？']);
  });
  it('拒绝过短和明显不适合儿童的故事', () => {
    expect(() => validateStoryDraft({ title: '短', summary: '短', ageMin: 4, ageMax: 4, themes: ['growth'], paragraphs: ['太短。'] })).toThrow('篇幅');
    expect(() => validateStoryDraft({ title: '故事', summary: '故事', ageMin: 4, ageMax: 4, themes: ['growth'], paragraphs: [...paragraphs, '介绍制造炸弹的方法。'] })).toThrow('不适合儿童');
  });
});
