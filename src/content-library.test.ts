import { describe, expect, it } from 'vitest';
import { calculateContentCoverage, createContentDraft, ensureContentAge, filterContentLibrary, formatContentAge, normalizeContentItem } from './content-library';
import type { ContentItem } from './types';

const items: ContentItem[] = [
  { id: 'poem-x', module: 'guoxue', kind: 'poem', title: '春晓', subtitle: '孟浩然', body: '春眠不觉晓' },
  { id: 'word-x', module: 'english', kind: 'word', title: 'apple', body: '苹果', tags: ['水果'] }
];

describe('资料库管理', () => {
  it('支持按模块和任意内容字段搜索', () => {
    expect(filterContentLibrary(items, 'all', '孟浩然')).toEqual([items[0]]);
    expect(filterContentLibrary(items, 'english', '水果')).toEqual([items[1]]);
    expect(filterContentLibrary(items, 'guoxue', 'apple')).toEqual([]);
  });

  it('新增资料生成稳定结构并匹配模块默认类型', () => {
    expect(createContentDraft('math', 123)).toMatchObject({ id: 'parent-math-123', module: 'math', kind: 'math-choice', source: 'imported', ageMin: 4, ageMax: 5 });
  });

  it('保存前清理空字段、选项和标签', () => {
    expect(normalizeContentItem({
      id: 'x', module: 'math', kind: 'math-choice', title: ' 题目 ', subtitle: ' ', options: [' A ', '', ' B '], tags: [' 数学 ', '']
    })).toEqual({ id: 'x', module: 'math', kind: 'math-choice', title: '题目', options: ['A', 'B'], tags: ['数学'], ageMin: 4, ageMax: 5 });
  });

  it('旧资料自动补齐适合年龄并支持按年龄筛选', () => {
    const aged = items.map(ensureContentAge);
    expect(aged.every((item) => item.ageMin && item.ageMax)).toBe(true);
    expect(filterContentLibrary(aged, 'all', '', 4)).toHaveLength(2);
    expect(filterContentLibrary(aged, 'all', '', 8).map((item) => item.id)).toEqual(['poem-x']);
    expect(formatContentAge(aged[0])).toBe('适合4–8岁');
  });

  it('内容超过建议基准时保留真实条数，并将参考进度封顶', () => {
    const coverage = calculateContentCoverage([
      ...Array.from({ length: 3 }, (_, index): ContentItem => ({ id: `word-${index}`, module: 'english', kind: 'word', title: `word ${index}`, source: 'builtin' })),
      { id: 'reader-1', module: 'english', kind: 'reader', title: '绘本', source: 'builtin' }
    ], 'english', 2);

    expect(coverage).toEqual({ current: 3, target: 2, percent: 100, remaining: 0, reached: true });
  });
});
