import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT } from './content';

describe('扩展课程内容库', () => {
  it('所有内容 ID 唯一', () => {
    expect(new Set(BUILTIN_CONTENT.map((item) => item.id)).size).toBe(BUILTIN_CONTENT.length);
  });

  it('所有内置资料都有有效的适合年龄标记', () => {
    expect(BUILTIN_CONTENT.every((item) => item.ageMin && item.ageMax && item.ageMin <= item.ageMax)).toBe(true);
  });

  it('每首古诗的作者前都标注朝代', () => {
    const poems = BUILTIN_CONTENT.filter((item) => item.kind === 'poem');
    expect(poems.length).toBeGreaterThanOrEqual(300);
    expect(poems.every((item) => /^(先秦|汉|魏晋|南北朝|北朝|隋|唐|五代|宋|金|元|明|清)·[^·]+$/.test(item.subtitle ?? ''))).toBe(true);
    expect(poems.find((item) => item.title === '静夜思')?.subtitle).toBe('唐·李白');
    expect(poems.find((item) => item.title === '小池')?.subtitle).toBe('宋·杨万里');
    expect(poems.find((item) => item.title === '江南')?.subtitle).toBe('汉·汉乐府');
  });

  it('古诗数据没有重复并覆盖小学和初中', () => {
    const poems = BUILTIN_CONTENT.filter((item) => item.kind === 'poem');
    expect(new Set(poems.map((item) => `${item.title}|${item.subtitle}`)).size).toBe(poems.length);
    expect(new Set(poems.map((item) => item.body?.replace(/[\s，。！？；、：：“”‘’《》·]/g, ''))).size).toBe(poems.length);
    expect(poems.every((item) => (item.body?.replace(/\s/g, '').length ?? 0) >= 20)).toBe(true);
    expect(poems.filter((item) => item.tags?.includes('小学古诗')).length).toBeGreaterThanOrEqual(100);
    expect(poems.filter((item) => item.tags?.includes('初中古诗')).length).toBeGreaterThanOrEqual(100);
    expect(poems[0]).toMatchObject({ id: 'poem-1', title: '咏鹅' });
    expect(poems[64]).toMatchObject({ id: 'poem-65', title: '村居' });
  });

  it('六大学习模块均达到扩充目标', () => {
    const count = (module: string, kind?: string) => BUILTIN_CONTENT.filter((item) =>
      item.module === module && (!kind || item.kind === kind)).length;
    expect(count('guoxue', 'poem')).toBeGreaterThanOrEqual(300);
    expect(count('guoxue', 'classic')).toBeGreaterThanOrEqual(10);
    expect(count('literacy', 'character')).toBeGreaterThanOrEqual(600);
    expect(count('math', 'math-choice')).toBe(240);
    expect(count('english', 'letter')).toBe(26);
    expect(count('english', 'word')).toBeGreaterThanOrEqual(200);
    expect(count('english', 'reader')).toBeGreaterThanOrEqual(10);
    expect(count('writing', 'trace')).toBeGreaterThanOrEqual(300);
    expect(count('science', 'science')).toBeGreaterThanOrEqual(90);
  });
});
