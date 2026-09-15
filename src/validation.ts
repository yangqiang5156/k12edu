import type { BackupEnvelopeV1, ContentItem, ContentPackV1, ParentSettings } from './types';

const kinds: Record<string, string[]> = { guoxue: ['poem', 'classic'], literacy: ['character'], math: ['math-choice'], english: ['letter', 'word', 'reader'], writing: ['trace'], science: ['science'] };
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string);
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) => string(v) && Number.isFinite(Date.parse(v));
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const unique = (v: unknown, key: string, check: (v: Record<string, unknown>) => boolean): boolean => Array.isArray(v)
  && v.every(item => record(item) && string(item[key]) && check(item))
  && new Set(v.map(item => item[key])).size === v.length;
const moduleId = (v: unknown) => typeof v === 'string' && Object.hasOwn(kinds, v);

export function contentErrors(value: unknown): string[] {
  if (!record(value)) return ['内容项必须是对象'];
  const errors: string[] = [];
  if (!string(value.id) || !string(value.title)) errors.push('缺少 id 或资料名称');
  if (!moduleId(value.module)) errors.push('module 无效');
  else if (!kinds[value.module as string].includes(String(value.kind))) errors.push('资料类型与模块不匹配');
  for (const key of ['subtitle', 'body', 'prompt', 'answer']) if (!optional(value[key], v => typeof v === 'string')) errors.push(`${key} 必须是文本`);
  for (const key of ['ageMin', 'ageMax']) if (!optional(value[key], v => integer(v, 3, 12))) errors.push(`${key} 应为3到12的整数`);
  if (typeof value.ageMin === 'number' && typeof value.ageMax === 'number' && value.ageMin > value.ageMax) errors.push('适合年龄范围无效');
  // 字母等内置内容历史上使用 stage=0；数学阶段仍严格限定为 1–6。
  if (!optional(value.stage, v => integer(v, value.kind === 'math-choice' ? 1 : 0, value.kind === 'math-choice' ? 6 : 20))) errors.push('学习阶段无效');
  if (!optional(value.tags, strings)) errors.push('标签必须是文本数组');
  if (!optional(value.source, v => v === 'builtin' || v === 'imported')) errors.push('资料来源无效');
  if (value.url !== undefined) {
    try { if (!string(value.url) || !['https:', 'http:'].includes(new URL(value.url).protocol)) errors.push('链接仅支持 HTTP 或 HTTPS'); }
    catch { errors.push('资源链接无效'); }
  }
  if (value.kind === 'math-choice' || value.options !== undefined) {
    if (!strings(value.options) || value.options.length < 2 || value.options.length > 8 || new Set(value.options).size !== value.options.length) errors.push('选择题需要2–8个互不重复的选项');
    if (!string(value.answer) || !Array.isArray(value.options) || !value.options.includes(value.answer)) errors.push('正确答案必须在选项中');
  }
  if (value.kind === 'math-choice' && (!string(value.prompt) || !integer(value.stage, 1, 6))) errors.push('数学题需要题目和1–6阶学习阶段');
  return errors;
}

export function validateSettings(value: unknown): value is ParentSettings {
  if (!record(value)) return false;
  return string(value.childName) && Array.isArray(value.activeWeekdays) && value.activeWeekdays.every(v => integer(v, 0, 6))
    && new Set(value.activeWeekdays).size === value.activeWeekdays.length
    && Array.isArray(value.enabledModules) && value.enabledModules.every(moduleId) && new Set(value.enabledModules).size === value.enabledModules.length
    && typeof value.soundEnabled === 'boolean' && typeof value.reduceMotion === 'boolean' && ['stella', 'archie', 'marie'].includes(String(value.petId))
    && optional(value.childAge, v => integer(v, 3, 12)) && optional(value.mathStartStage, v => integer(v, 1, 6))
    && optional(value.englishStart, v => v === 'letters' || v === 'words')
    && optional(value.dailyContentCounts, v => record(v) && Object.entries(v).every(([key, count]) => moduleId(key) && integer(count, 1, 10)))
    && optional(value.pinPolicyVersion, v => integer(v, 1))
    && optional(value.pinHash, string) && optional(value.pinSalt, string) && Boolean(value.pinHash) === Boolean(value.pinSalt);
}

export function validateContentPack(value: unknown): { ok: true; pack: ContentPackV1 } | { ok: false; errors: string[] } {
  if (!record(value)) return { ok: false, errors: ['内容包必须是 JSON 对象'] };
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!string(value.id) || !string(value.title) || !string(value.contentVersion)) errors.push('缺少内容包 id、标题或版本');
  if (!Array.isArray(value.items) || !value.items.length) errors.push('items 必须是非空数组');
  else {
    const ids = new Set<unknown>();
    for (const [index, item] of value.items.entries()) {
      errors.push(...contentErrors(item).map(error => `第 ${index + 1} 条：${error}`));
      if (record(item)) { if (ids.has(item.id)) errors.push(`内容 id 重复：${item.id}`); ids.add(item.id); }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, pack: value as unknown as ContentPackV1 };
}

// 备份必须能恢复应用曾经合法保存的数据。旧内置题库个别题目存在重复干扰项，
// 导入新内容时仍由 contentErrors 严格拒绝，备份恢复则兼容这些历史条目。
function backupContentErrors(value: unknown): string[] {
  if (!record(value)) return ['内容项必须是对象'];
  if (value.kind !== 'math-choice' || !Array.isArray(value.options)) return contentErrors(value);
  const deduplicated = [...new Set(value.options)];
  return contentErrors({ ...value, options: deduplicated });
}

export function validateBackup(value: unknown): { ok: true; backup: BackupEnvelopeV1 } | { ok: false; error: string } {
  try {
    if (!record(value) || value.schemaVersion !== 1 || value.app !== 'lexue-workbench' || !timestamp(value.exportedAt) || !record(value.data)) throw new Error('不是可识别的乐学 V1 备份');
    const d = value.data;
    if (!validateSettings(d.settings)) throw new Error('学习设置格式无效');
    if (!unique(d.content, 'id', item => backupContentErrors(item).length === 0)) throw new Error('内容库包含无效内容或重复 ID');
    const dailyItem = (item: Record<string, unknown>) => string(item.contentId) && string(item.title)
      && Object.values(kinds).flat().includes(String(item.kind))
      && ['detail', 'prompt', 'answer'].every(key => optional(item[key], v => typeof v === 'string'))
      && optional(item.isReview, v => typeof v === 'boolean')
      && optional(item.options, v => strings(v) && v.length >= 2 && string(item.answer) && v.includes(item.answer));
    if (!unique(d.plans, 'date', plan => date(plan.date) && timestamp(plan.generatedAt) && typeof plan.isActiveDay === 'boolean'
      && optional(plan.completedAt, timestamp) && optional(plan.weeklyBonusGranted, v => typeof v === 'boolean') && optional(plan.curriculumVersion, v => integer(v, 1))
      && unique(plan.modules, 'id', task => moduleId(task.module) && string(task.title) && optional(task.collectedAt, timestamp)
        && unique(task.items, 'id', item => dailyItem(item) && kinds[String(task.module)].includes(String(item.kind))) && Array.isArray(task.items) && task.items.length > 0
        && strings(task.doneItemIds) && new Set(task.doneItemIds).size === task.doneItemIds.length
        && task.doneItemIds.every(id => (task.items as Record<string, unknown>[]).some(item => item.id === id))
        && (!task.collectedAt || task.doneItemIds.length === task.items.length)))) throw new Error('每日计划或完成进度格式无效');
    if (!unique(d.completions, 'id', e => date(e.date) && moduleId(e.module) && string(e.taskId) && timestamp(e.completedAt) && strings(e.contentIds))) throw new Error('模块完成记录格式无效');
    if (!unique(d.ledger, 'id', e => date(e.date) && timestamp(e.createdAt) && string(e.reason) && string(e.sourceId)
      && ['stars', 'foodHalfUnits', 'xp', 'gems', 'badges'].includes(String(e.currency)) && Number.isSafeInteger(e.delta))) throw new Error('奖励流水格式无效');
    if (!record(d.pet) || d.pet.id !== 'current' || !['stella', 'archie', 'marie'].includes(String(d.pet.selected)) || !integer(d.pet.mood, 0, 100) || !integer(d.pet.fedCount, 0) || !optional(d.pet.lastInteractionAt, timestamp)) throw new Error('宠物数据格式无效');
    if (!unique(d.redemptions, 'id', e => string(e.rewardId) && string(e.rewardTitle) && timestamp(e.requestedAt) && optional(e.resolvedAt, timestamp) && ['pending', 'approved', 'rejected'].includes(String(e.status)))) throw new Error('兑换记录格式无效');
    if (!unique(d.reports, 'date', e => date(e.date) && Array.isArray(e.completedModules) && e.completedModules.every(moduleId) && strings(e.contentIds) && integer(e.earnedStars, 0) && integer(e.earnedFoodHalfUnits, 0) && string(e.note))) throw new Error('日报格式无效');
    if (!unique(d.contentPacks, 'id', e => string(e.title) && string(e.contentVersion) && timestamp(e.importedAt) && integer(e.itemCount, 0))) throw new Error('内容包记录格式无效');
    if (!unique(d.rewardDefinitions, 'id', e => string(e.title) && string(e.icon) && ['stars', 'badges'].includes(String(e.currency)) && integer(e.cost, 1) && typeof e.enabled === 'boolean')) throw new Error('兑换标准格式无效');
    if (!optional(d.learningEvents, v => unique(v, 'id', e => date(e.date) && moduleId(e.module) && string(e.taskId) && string(e.contentId) && string(e.title)
      && kinds[String(e.module)].includes(String(e.kind)) && typeof e.isReview === 'boolean' && ['independent', 'assisted', 'practice', 'unknown'].includes(String(e.outcome))
      && integer(e.attempts, 0) && integer(e.wrongAttempts, 0, Number(e.attempts)) && optional(e.firstAnswerCorrect, v => typeof v === 'boolean')
      && optional(e.completedAt, timestamp) && timestamp(e.updatedAt) && optional(e.legacy, v => typeof v === 'boolean')))) throw new Error('逐条学习记录格式无效');
    return { ok: true, backup: value as unknown as BackupEnvelopeV1 };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '备份格式无效' }; }
}

export function assertContent(item: unknown): asserts item is ContentItem {
  const errors = contentErrors(item);
  if (errors.length) throw new Error(errors.join('；'));
}
