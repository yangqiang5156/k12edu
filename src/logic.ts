import type {
  AppData,
  BackupEnvelopeV1,
  CompletionEvent,
  ContentItem,
  ContentPackV1,
  DailyItem,
  DailyModuleTask,
  DailyPlan,
  ModuleId,
  ParentSettings,
  RewardLedgerEntry,
  Wallet
} from './types';

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
export const DAILY_PLAN_CURRICULUM_VERSION = 2;

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function daySeed(dateKey: string): number {
  return Math.floor(new Date(`${dateKey}T12:00:00`).getTime() / 86_400_000);
}

export function weekStartKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return localDateKey(date);
}

export function datePlusDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function masteredPoemCount(completions: CompletionEvent[]): number {
  return new Set(
    completions.flatMap((event) => event.contentIds.filter((id) => id.startsWith('poem-')))
  ).size;
}

export function unlockedClassicCount(poemCount: number): number {
  return Math.floor(poemCount / 10);
}

function toDailyItem(item: ContentItem, date: string, suffix = ''): DailyItem {
  return {
    id: `${date}-${item.id}${suffix}`,
    contentId: item.id,
    title: item.title,
    detail: [item.subtitle, item.body].filter(Boolean).join('\n'),
    kind: item.kind,
    prompt: item.prompt,
    answer: item.answer,
    options: item.options
  };
}

function pickCircular<T>(items: T[], start: number, count: number): T[] {
  if (!items.length) return [];
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(start + index) % items.length]);
}

function moduleTask(date: string, module: ModuleId, title: string, items: ContentItem[]): DailyModuleTask {
  return {
    id: `${date}-${module}`,
    module,
    title,
    items: items.map((item, index) => toDailyItem(item, date, `-${index}`)),
    doneItemIds: []
  };
}

export function generateDailyPlan(
  date: string,
  settings: ParentSettings,
  content: ContentItem[],
  completions: CompletionEvent[]
): DailyPlan {
  const dateObject = new Date(`${date}T12:00:00`);
  const weekday = dateObject.getDay();
  const seed = daySeed(date);
  const isActiveDay = settings.activeWeekdays.includes(weekday);
  const enabled = new Set(settings.enabledModules);
  const byModule = (module: ModuleId, kind?: ContentItem['kind']) => content.filter(
    (item) => item.module === module && (!kind || item.kind === kind)
  );
  const modules: DailyModuleTask[] = [];

  if (isActiveDay && enabled.has('guoxue')) {
    const poems = byModule('guoxue', 'poem');
    const classics = byModule('guoxue', 'classic');
    const isNewDay = [1, 3, 5].includes(weekday);
    const poemIndex = Math.abs(seed * 3 + weekday) % Math.max(1, poems.length);
    const selected = pickCircular(poems, isNewDay ? poemIndex : Math.max(0, poemIndex - 1), isNewDay ? 1 : 2);
    const unlockedClassics = unlockedClassicCount(masteredPoemCount(completions));
    if (unlockedClassics > 0 && weekday === 5 && classics.length) {
      selected.push(classics[Math.min(unlockedClassics, classics.length) - 1]);
    }
    modules.push(moduleTask(date, 'guoxue', isNewDay ? '新诗轻轻读' : '古诗再见面', selected));
  }

  if (isActiveDay && enabled.has('literacy')) {
    const chars = byModule('literacy', 'character');
    const start = Math.abs(seed * 2) % Math.max(1, chars.length);
    const selected = pickCircular(chars, start, 2);
    const review = pickCircular(chars, Math.max(0, start - 6), 2);
    modules.push(moduleTask(date, 'literacy', '2个新字 + 旧字复习', [...selected, ...review]));
  }

  if (isActiveDay && enabled.has('math')) {
    const maths = byModule('math', 'math-choice');
    const completedMath = completions.filter((event) => event.module === 'math').length;
    const stage = Math.min(6, Math.floor(completedMath / 10) + 1);
    const stageItems = maths.filter((item) => item.stage === stage);
    modules.push(moduleTask(date, 'math', `第${stage}阶 · 趣味数学`, pickCircular(stageItems, seed, seed % 2 ? 3 : 2)));
  }

  if (isActiveDay && enabled.has('english')) {
    const letters = byModule('english', 'letter');
    const words = byModule('english', 'word');
    const readers = byModule('english', 'reader');
    const learnedLetterIds = new Set(
      completions.flatMap((event) => event.module === 'english'
        ? event.contentIds.filter((id) => id.startsWith('letter-'))
        : [])
    );
    if (letters.length && learnedLetterIds.size < letters.length) {
      const newLetters = letters.filter((item) => !learnedLetterIds.has(item.id)).slice(0, 2);
      const reviews = letters.filter((item) => learnedLetterIds.has(item.id)).slice(-2);
      modules.push(moduleTask(
        date,
        'english',
        `字母启蒙 · 已认识 ${learnedLetterIds.size}/${letters.length}`,
        [...newLetters, ...reviews]
      ));
    } else {
      const selected = pickCircular(words, seed * 3, 3);
      if ([1, 3, 5].includes(weekday) && readers.length) selected.push(readers[Math.abs(seed) % readers.length]);
      modules.push(moduleTask(date, 'english', [1, 3, 5].includes(weekday) ? '单词 + 绘本朗读' : '主题单词复习', selected));
    }
  }

  if (isActiveDay && enabled.has('writing')) {
    const traces = byModule('writing', 'trace');
    modules.push(moduleTask(date, 'writing', '慢慢描一描', pickCircular(traces, seed * 4, 4)));
  }

  if (isActiveDay && enabled.has('science') && [2, 4].includes(weekday)) {
    const science = byModule('science', 'science');
    modules.push(moduleTask(date, 'science', '5分钟小观察', pickCircular(science, seed, 1)));
  }

  return { date, generatedAt: new Date().toISOString(), curriculumVersion: DAILY_PLAN_CURRICULUM_VERSION, isActiveDay, modules };
}

export function regenerateDailyPlanForSettings(
  date: string,
  settings: ParentSettings,
  content: ContentItem[],
  completions: CompletionEvent[],
  existingPlan?: DailyPlan
): DailyPlan {
  const freshPlan = generateDailyPlan(date, settings, content, completions);
  if (!existingPlan) return freshPlan;

  const previousModules = new Map(existingPlan.modules.map((module) => [module.module, module]));
  freshPlan.modules = freshPlan.modules.map((module) => previousModules.get(module.module) ?? module);
  if (freshPlan.modules.length > 0 && freshPlan.modules.every((module) => module.collectedAt)) {
    freshPlan.completedAt = existingPlan.completedAt;
  }
  freshPlan.weeklyBonusGranted = existingPlan.weeklyBonusGranted;
  return freshPlan;
}

export function moduleRewards(module: ModuleId): Record<'stars' | 'foodHalfUnits' | 'xp', number> {
  return module === 'writing'
    ? { stars: 1, foodHalfUnits: 1, xp: 1 }
    : { stars: 2, foodHalfUnits: 2, xp: 2 };
}

export function rewardEntriesForCompletion(event: CompletionEvent): RewardLedgerEntry[] {
  const rewards = moduleRewards(event.module);
  return (Object.entries(rewards) as Array<[keyof typeof rewards, number]>).map(([currency, delta]) => ({
    id: `${event.id}-${currency}`,
    date: event.date,
    createdAt: event.completedAt,
    reason: `完成${event.module}`,
    sourceId: event.id,
    currency,
    delta
  }));
}

export function calculateWallet(entries: RewardLedgerEntry[]): Wallet {
  return entries.reduce<Wallet>((wallet, entry) => {
    wallet[entry.currency] += entry.delta;
    return wallet;
  }, { stars: 0, foodHalfUnits: 0, xp: 0, gems: 0, badges: 0 });
}

export function rewardBalanceAdjustmentEntries(
  current: Wallet,
  target: Pick<Wallet, 'stars' | 'foodHalfUnits' | 'gems' | 'badges'>,
  date: string,
  createdAt = new Date().toISOString()
): RewardLedgerEntry[] {
  const sourceId = `parent-balance-${createdAt}`;
  return (['stars', 'foodHalfUnits', 'gems', 'badges'] as const).flatMap((currency) => {
    const delta = target[currency] - current[currency];
    return delta === 0 ? [] : [{
      id: `${sourceId}-${currency}`,
      date,
      createdAt,
      reason: '家长调整奖励余额',
      sourceId,
      currency,
      delta
    }];
  });
}

export function petLevel(xp: number): number {
  return Math.floor(Math.max(0, xp) / 100) + 1;
}

export function completedDaysThisWeek(plans: DailyPlan[], date: string): number {
  const start = weekStartKey(date);
  const end = datePlusDays(start, 6);
  return plans.filter((plan) => plan.date >= start && plan.date <= end && Boolean(plan.completedAt)).length;
}

export function shouldGrantAttendanceBonus(plans: DailyPlan[], date: string): boolean {
  const start = weekStartKey(date);
  const end = datePlusDays(start, 6);
  const weekPlans = plans.filter((plan) => plan.date >= start && plan.date <= end);
  return weekPlans.filter((plan) => Boolean(plan.completedAt)).length >= 5
    && !weekPlans.some((plan) => plan.weeklyBonusGranted);
}

export function attendanceBonusEntries(date: string): RewardLedgerEntry[] {
  const createdAt = new Date().toISOString();
  const sourceId = `attendance-${weekStartKey(date)}`;
  return [
    { id: `${sourceId}-stars`, date, createdAt, reason: '每周5天全勤', sourceId, currency: 'stars', delta: 5 },
    { id: `${sourceId}-gems`, date, createdAt, reason: '每周5天全勤', sourceId, currency: 'gems', delta: 1 }
  ];
}

export function milestoneBadgeEntry(completionCount: number, date: string): RewardLedgerEntry | undefined {
  const milestone = [5, 20, 50, 100, 200].find((value) => value === completionCount);
  if (!milestone) return undefined;
  const sourceId = `milestone-${milestone}`;
  return {
    id: `${sourceId}-badge`, date, createdAt: new Date().toISOString(), reason: `完成${milestone}个学习模块`,
    sourceId, currency: 'badges', delta: 1
  };
}

export function validateContentPack(value: unknown): { ok: true; pack: ContentPackV1 } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['内容包必须是 JSON 对象'] };
  const candidate = value as Partial<ContentPackV1>;
  if (candidate.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!candidate.id || typeof candidate.id !== 'string') errors.push('缺少内容包 id');
  if (!candidate.title || typeof candidate.title !== 'string') errors.push('缺少内容包标题');
  if (!candidate.contentVersion || typeof candidate.contentVersion !== 'string') errors.push('缺少 contentVersion');
  if (!Array.isArray(candidate.items) || !candidate.items.length) errors.push('items 必须是非空数组');
  const ids = new Set<string>();
  candidate.items?.forEach((item, index) => {
    if (!item.id || !item.module || !item.kind || !item.title) errors.push(`第 ${index + 1} 条缺少 id、module、kind 或 title`);
    if (!['guoxue', 'literacy', 'math', 'english', 'writing', 'science'].includes(item.module)) errors.push(`第 ${index + 1} 条 module 无效`);
    if (!['poem', 'classic', 'character', 'math-choice', 'letter', 'word', 'reader', 'trace', 'science'].includes(item.kind)) errors.push(`第 ${index + 1} 条 kind 无效`);
    if (item.ageMin !== undefined && (!Number.isInteger(item.ageMin) || item.ageMin < 3 || item.ageMin > 12)) errors.push(`第 ${index + 1} 条 ageMin 应为3到12的整数`);
    if (item.ageMax !== undefined && (!Number.isInteger(item.ageMax) || item.ageMax < 3 || item.ageMax > 12)) errors.push(`第 ${index + 1} 条 ageMax 应为3到12的整数`);
    if (item.ageMin !== undefined && item.ageMax !== undefined && item.ageMin > item.ageMax) errors.push(`第 ${index + 1} 条适合年龄范围无效`);
    if (ids.has(item.id)) errors.push(`内容 id 重复：${item.id}`);
    ids.add(item.id);
  });
  return errors.length ? { ok: false, errors } : { ok: true, pack: candidate as ContentPackV1 };
}

export function validateBackup(value: unknown): { ok: true; backup: BackupEnvelopeV1 } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: '备份文件格式无效' };
  const candidate = value as Partial<BackupEnvelopeV1>;
  if (candidate.schemaVersion !== 1 || candidate.app !== 'lexue-workbench' || !candidate.data) {
    return { ok: false, error: '不是可识别的乐学 V1 备份' };
  }
  const data = candidate.data as Partial<AppData>;
  if (!data.settings || !Array.isArray(data.content) || !Array.isArray(data.plans) || !Array.isArray(data.ledger)) {
    return { ok: false, error: '备份数据不完整' };
  }
  return { ok: true, backup: candidate as BackupEnvelopeV1 };
}

export function numberToChinese(n: number): string {
  if (n === 0) return '零';
  if (n === 1000) return '一千';
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  let result = '';
  if (n >= 100) {
    result += `${digits[Math.floor(n / 100)]}百`;
    if (n % 100 > 0 && n % 100 < 10) result += '零';
  }
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  if (tens > 0) result += tens === 1 && n < 100 ? '十' : `${digits[tens]}十`;
  if (ones > 0) result += digits[ones];
  return result;
}

export function numberToEnglish(n: number): string {
  if (n === 0) return 'Zero';
  if (n === 1000) return 'One Thousand';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  let result = '';
  if (n >= 100) {
    result += `${ones[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) result += ' and ';
  }
  if (n > 0) result += n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ''}`;
  return result;
}

export type NumberAudioLanguage = 'zh' | 'en' | 'both';

export function numberSpeechText(number: number, language: NumberAudioLanguage = 'both'): string {
  if (!Number.isInteger(number) || number < 0 || number > 1000) return '';
  if (language === 'zh') return numberToChinese(number);
  if (language === 'en') return numberToEnglish(number);
  return `${numberToChinese(number)}。${numberToEnglish(number)}.`;
}
