import type { ContentItem, ContentKind, ModuleId } from './types';

export const CONTENT_KINDS_BY_MODULE: Record<ModuleId, Array<{ id: ContentKind; label: string }>> = {
  guoxue: [{ id: 'poem', label: '古诗' }, { id: 'classic', label: '经典古文' }],
  literacy: [{ id: 'character', label: '汉字' }],
  math: [{ id: 'math-choice', label: '数学选择题' }],
  english: [{ id: 'letter', label: '字母' }, { id: 'word', label: '单词' }, { id: 'reader', label: '绘本' }],
  writing: [{ id: 'trace', label: '描红' }],
  science: [{ id: 'science', label: '科学任务' }]
};

export const CONTENT_AGE_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface ContentCoverage {
  current: number;
  target: number;
  percent: number;
  remaining: number;
  reached: boolean;
}

export function calculateContentCoverage(items: ContentItem[], module: ModuleId, target: number): ContentCoverage {
  const current = items.filter((item) => item.module === module && item.kind !== 'reader' && item.kind !== 'classic').length;
  const safeTarget = Math.max(1, target);
  return {
    current,
    target: safeTarget,
    percent: Math.min(100, current / safeTarget * 100),
    remaining: Math.max(0, safeTarget - current),
    reached: current >= safeTarget
  };
}

function defaultAgeRange(item: Pick<ContentItem, 'kind' | 'stage'>): { ageMin: number; ageMax: number } {
  if (item.kind === 'math-choice') {
    const ranges = [[4, 5], [4, 6], [5, 6], [5, 7], [5, 7], [6, 8]];
    const [ageMin, ageMax] = ranges[Math.max(0, Math.min(5, (item.stage ?? 1) - 1))];
    return { ageMin, ageMax };
  }
  switch (item.kind) {
    case 'poem': return { ageMin: 4, ageMax: 8 };
    case 'classic': return { ageMin: 5, ageMax: 9 };
    case 'character': return { ageMin: 4, ageMax: 7 };
    case 'letter': return { ageMin: 4, ageMax: 6 };
    case 'word':
    case 'reader':
    case 'trace':
    case 'science': return { ageMin: 4, ageMax: 7 };
  }
}

export function ensureContentAge(item: ContentItem): ContentItem {
  const fallback = defaultAgeRange(item);
  const ageMin = Number.isInteger(item.ageMin) ? Math.max(3, Math.min(12, item.ageMin as number)) : fallback.ageMin;
  const ageMaxCandidate = Number.isInteger(item.ageMax) ? Math.max(3, Math.min(12, item.ageMax as number)) : fallback.ageMax;
  return { ...item, ageMin: Math.min(ageMin, ageMaxCandidate), ageMax: Math.max(ageMin, ageMaxCandidate) };
}

export function formatContentAge(item: Pick<ContentItem, 'ageMin' | 'ageMax'>): string {
  if (!item.ageMin || !item.ageMax) return '年龄待补充';
  return item.ageMin === item.ageMax ? `适合${item.ageMin}岁` : `适合${item.ageMin}–${item.ageMax}岁`;
}

export function createContentDraft(module: ModuleId = 'guoxue', now = Date.now()): ContentItem {
  return ensureContentAge({
    id: `parent-${module}-${now}`,
    module,
    kind: CONTENT_KINDS_BY_MODULE[module][0].id,
    title: '',
    source: 'imported'
  });
}

export function filterContentLibrary(items: ContentItem[], module: ModuleId | 'all', query: string, age: number | 'all' = 'all'): ContentItem[] {
  const keyword = query.trim().toLowerCase();
  return items.filter((item) => (module === 'all' || item.module === module)
    && (age === 'all' || ((item.ageMin ?? 0) <= age && (item.ageMax ?? 99) >= age)) && (!keyword || [
    item.id, item.title, item.subtitle, item.exampleWord, item.body, item.prompt, item.answer, item.options?.join(' '), item.tags?.join(' ')
  ].filter(Boolean).join(' ').toLowerCase().includes(keyword)));
}

export function normalizeContentItem(item: ContentItem): ContentItem {
  const result: ContentItem = { ...item, title: item.title.trim() };
  for (const key of ['subtitle', 'exampleWord', 'body', 'prompt', 'answer', 'url'] as const) {
    const value = result[key]?.trim();
    if (value) result[key] = value;
    else delete result[key];
  }
  if (!result.options?.some((option) => option.trim())) delete result.options;
  else result.options = result.options.map((option) => option.trim()).filter(Boolean);
  if (!result.tags?.some((tag) => tag.trim())) delete result.tags;
  else result.tags = result.tags.map((tag) => tag.trim()).filter(Boolean);
  if (!result.stage) delete result.stage;
  return ensureContentAge(result);
}
