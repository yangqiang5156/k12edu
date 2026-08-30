import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT } from './content';

describe('扩展课程内容库', () => {
  it('所有内容 ID 唯一', () => {
    expect(new Set(BUILTIN_CONTENT.map((item) => item.id)).size).toBe(BUILTIN_CONTENT.length);
  });

  it('所有内置资料都有有效的适合年龄标记', () => {
    expect(BUILTIN_CONTENT.every((item) => item.ageMin && item.ageMax && item.ageMin <= item.ageMax)).toBe(true);
  });

  it('六大学习模块均达到扩充目标', () => {
    const count = (module: string, kind?: string) => BUILTIN_CONTENT.filter((item) =>
      item.module === module && (!kind || item.kind === kind)).length;
    expect(count('guoxue', 'poem')).toBeGreaterThanOrEqual(60);
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
