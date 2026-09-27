import { dailyContentCount } from './types';
import type {
  LearningEvent,
  CompletionEvent,
  ContentItem,
  DailyItem,
  DailyModuleTask,
  DailyPlan,
  ModuleId,
  ParentSettings,
  RewardLedgerEntry,
  Wallet
} from './types';

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
export const DAILY_PLAN_CURRICULUM_VERSION = 6;

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

function toDailyItem(item: ContentItem, date: string, suffix = '', isReview = false): DailyItem {
  return {
    id: `${date}-${item.id}${suffix}`,
    contentId: item.id,
    title: item.title,
    detail: [item.subtitle, item.body].filter(Boolean).join('\n'),
    exampleWord: item.exampleWord,
    kind: item.kind,
    prompt: item.prompt,
    answer: item.answer,
    options: item.options,
    isReview
  };
}

function pickCircular<T>(items: T[], start: number, count: number): T[] {
  if (!items.length) return [];
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(start + index) % items.length]);
}

function moduleTask(date: string, module: ModuleId, newItems: ContentItem[], reviewItems: ContentItem[], prefix = ''): DailyModuleTask {
  const title = [prefix, newItems.length ? `${newItems.length}个新内容` : '', reviewItems.length ? `${reviewItems.length}个记忆复习` : ''].filter(Boolean).join(' · ');
  return {
    id: `${date}-${module}`,
    module,
    title,
    items: [
      ...newItems.map((item, index) => toDailyItem(item, date, `-new-${index}`)),
      ...reviewItems.map((item, index) => toDailyItem(item, date, `-review-${index}`, true))
    ],
    doneItemIds: []
  };
}

export function alignWritingWithLiteracy(date: string, modules: DailyModuleTask[], content: ContentItem[]): DailyModuleTask[] {
  const literacy = modules.find(task => task.module === 'literacy');
  if (!literacy || !modules.some(task => task.module === 'writing')) return modules;
  const traces = new Map(content.filter(item => item.module === 'writing' && item.kind === 'trace').map(item => [item.title, item]));
  const items: DailyItem[] = literacy.items.map((character, index) => ({
    id: `${date}-writing-${character.contentId}-${index}`,
    contentId: traces.get(character.title)?.id ?? `trace-for-${character.contentId}`,
    title: character.title,
    detail: '沿着浅色笔画慢慢描',
    kind: 'trace',
    isReview: character.isReview
  }));
  const newCount = items.filter(item => !item.isReview).length;
  const reviewCount = items.length - newCount;
  const title = ['慢慢描一描', newCount ? `${newCount}个新内容` : '', reviewCount ? `${reviewCount}个记忆复习` : ''].filter(Boolean).join(' · ');
  return modules.map(task => task.module === 'writing' ? { ...task, title, items } : task);
}

export function enrichCharacterWords(modules: DailyModuleTask[], content: ContentItem[]): DailyModuleTask[] {
  const words = new Map(content.filter(item => item.kind === 'character' && item.exampleWord).map(item => [item.id, item.exampleWord]));
  return modules.map(task => {
    if (task.module !== 'literacy') return task;
    const items = task.items.map(item => item.exampleWord || !words.has(item.contentId)
      ? item : { ...item, exampleWord: words.get(item.contentId) });
    return items.every((item, index) => item === task.items[index]) ? task : { ...task, items };
  });
}

interface ContentLearningHistory {
  firstDate: string;
  completionDates: Set<string>;
}

function learningHistoryBefore(date: string, completions: CompletionEvent[]): Map<string, ContentLearningHistory> {
  const history = new Map<string, ContentLearningHistory>();
  for (const event of completions.filter((entry) => entry.date < date).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const contentId of event.contentIds) {
      const existing = history.get(contentId);
      if (existing) existing.completionDates.add(event.date);
      else history.set(contentId, { firstDate: event.date, completionDates: new Set([event.date]) });
    }
  }
  return history;
}

function daysBetween(start: string, end: string): number {
  return daySeed(end) - daySeed(start);
}

function dueReviewItems(date: string, items: ContentItem[], history: Map<string, ContentLearningHistory>): ContentItem[] {
  return items.flatMap((item) => {
    const learned = history.get(item.id);
    if (!learned) return [];
    const overdueInterval = REVIEW_INTERVALS.find((interval) => {
      const dueDate = datePlusDays(learned.firstDate, interval);
      return dueDate <= date && !Array.from(learned.completionDates).some((completionDate) => completionDate >= dueDate);
    });
    return overdueInterval === undefined ? [] : [{ item, overdueBy: daysBetween(datePlusDays(learned.firstDate, overdueInterval), date) }];
  }).sort((a, b) => b.overdueBy - a.overdueBy || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
}

export function generateDailyPlan(
  date: string,
  settings: ParentSettings,
  content: ContentItem[],
  completions: CompletionEvent[],
  learningEvents: LearningEvent[] = []
): DailyPlan {
  const dateObject = new Date(`${date}T12:00:00`);
  const weekday = dateObject.getDay();
  const seed = daySeed(date);
  const isActiveDay = settings.activeWeekdays.includes(weekday);
  const enabled = new Set(settings.enabledModules);
  const itemCompletions: CompletionEvent[] = learningEvents.filter(event => event.completedAt).map(event => ({
    id: event.id, date: event.date, module: event.module, taskId: event.taskId,
    completedAt: event.completedAt!, contentIds: [event.contentId]
  }));
  const history = learningHistoryBefore(date, [...completions, ...itemCompletions]);
  const pastEvents = learningEvents.filter(event => event.date < date).slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const latestEvents = new Map<string, LearningEvent>();
  for (const event of pastEvents) latestEvents.set(event.contentId, event);
  const learnedIds = new Set(history.keys());
  const byModule = (module: ModuleId, kind?: ContentItem['kind']) => content.filter(
    (item) => item.module === module && (!kind || item.kind === kind)
      && (settings.childAge === undefined || ((item.ageMin ?? 3) <= settings.childAge && (item.ageMax ?? 12) >= settings.childAge))
  );
  const modules: DailyModuleTask[] = [];

  if (isActiveDay) for (const module of settings.enabledModules) {
    if (!enabled.has(module)) continue;
    const allModuleItems = byModule(module);
    const count = dailyContentCount(settings, module);
    let newPool = allModuleItems;
    let prefix = '';

    if (module === 'guoxue') {
      const poems = byModule('guoxue', 'poem');
      const classics = byModule('guoxue', 'classic').slice(0, unlockedClassicCount(masteredPoemCount([...completions, ...itemCompletions].filter((event) => event.date < date))));
      newPool = [...poems, ...classics];
      prefix = '国学积累';
    } else if (module === 'math') {
      let stage = settings.mathStartStage ?? 1;
      while (stage < 6) {
        const passed = allModuleItems.filter(item => item.stage === stage && latestEvents.get(item.id)?.outcome === 'independent').length;
        if (passed < 10 || !allModuleItems.some(item => item.stage === stage + 1)) break;
        stage += 1;
      }
      newPool = byModule('math', 'math-choice').filter((item) => item.stage === stage);
      prefix = `第${stage}阶`;
    } else if (module === 'english') {
      const letters = byModule('english', 'letter');
      const learnedLetterCount = letters.filter((item) => learnedIds.has(item.id)).length;
      const words = byModule('english', 'word');
      const readers = byModule('english', 'reader');
      const preferredReader = [1, 3, 5].includes(weekday)
        ? pickCircular(readers.filter((item) => !learnedIds.has(item.id)), Math.abs(seed), 1)
        : [];
      newPool = settings.englishStart !== 'words' && learnedLetterCount < letters.length ? letters : [...preferredReader, ...words, ...readers.filter((item) => !preferredReader.includes(item))];
      prefix = settings.englishStart !== 'words' && learnedLetterCount < letters.length ? `字母启蒙 ${learnedLetterCount}/${letters.length}` : '英语积累';
    } else if (module === 'literacy') prefix = '识字积累';
    else if (module === 'writing') prefix = '慢慢描一描';
    else if (module === 'science') prefix = '小小科学家';

    const unseen = newPool.filter((item) => !learnedIds.has(item.id) && !latestEvents.has(item.id));
    const newItems = module === 'english'
      ? unseen.slice(0, count)
      : pickCircular(unseen, Math.abs(seed * 7 + settings.enabledModules.indexOf(module) * 11), count);
    const selectedIds = new Set(newItems.map((item) => item.id));
    const legacyDue = new Set(dueReviewItems(date, allModuleItems, history).map(item => item.id));
    const due = allModuleItems.filter(item => {
      const latest = latestEvents.get(item.id);
      if (!latest || latest.outcome === 'unknown') return legacyDue.has(item.id);
      const successful = pastEvents.filter(event => event.contentId === item.id && event.outcome === 'independent' && event.completedAt);
      const lastDifficulty = pastEvents.filter(event => event.contentId === item.id && ['assisted', 'practice'].includes(event.outcome)).at(-1);
      const streak = successful.filter(event => !lastDifficulty || event.updatedAt > lastDifficulty.updatedAt).length;
      const interval = latest.outcome === 'practice' ? 1 : latest.outcome === 'assisted' ? 3 : REVIEW_INTERVALS[Math.min(Math.max(0, streak - 1), REVIEW_INTERVALS.length - 1)];
      return datePlusDays(latest.date, interval) <= date;
    }).sort((a, b) => {
      const priority = (id: string) => latestEvents.get(id)?.outcome === 'practice' ? 0 : latestEvents.get(id)?.outcome === 'assisted' ? 1 : 2;
      return priority(a.id) - priority(b.id) || a.id.localeCompare(b.id);
    });
    let reviews = due.filter((item) => !selectedIds.has(item.id)).slice(0, count);
    if (!newItems.length && !reviews.length && !pastEvents.length) {
      reviews = pickCircular(allModuleItems.filter((item) => learnedIds.has(item.id)), Math.abs(seed), count);
    }
    if (newItems.length || reviews.length) modules.push(moduleTask(date, module, newItems, reviews, prefix));
  }

  if (modules.some(task => task.module === 'literacy') && enabled.has('writing') && !modules.some(task => task.module === 'writing')) {
    const position = modules.filter(task => settings.enabledModules.indexOf(task.module) < settings.enabledModules.indexOf('writing')).length;
    modules.splice(position, 0, { id: `${date}-writing`, module: 'writing', title: '', items: [], doneItemIds: [] });
  }
  return { date, generatedAt: new Date().toISOString(), curriculumVersion: DAILY_PLAN_CURRICULUM_VERSION, isActiveDay, modules: alignWritingWithLiteracy(date, modules, content) };
}

export function regenerateDailyPlanForSettings(
  date: string,
  settings: ParentSettings,
  content: ContentItem[],
  completions: CompletionEvent[],
  existingPlan?: DailyPlan,
  previousSettings?: ParentSettings,
  learningEvents: LearningEvent[] = []
): DailyPlan {
  const freshPlan = generateDailyPlan(date, settings, content, completions, learningEvents);
  if (!existingPlan) return freshPlan;

  const previousModules = new Map(existingPlan.modules.map((module) => [module.module, module]));
  const schedulingChanged = previousSettings ? (
    previousSettings.childAge !== settings.childAge
    || previousSettings.mathStartStage !== settings.mathStartStage
    || previousSettings.englishStart !== settings.englishStart
    || previousSettings.activeWeekdays.join(',') !== settings.activeWeekdays.join(',')
    || previousSettings.enabledModules.join(',') !== settings.enabledModules.join(',')
    || settings.enabledModules.some((module) => dailyContentCount(previousSettings, module) !== dailyContentCount(settings, module))
  ) : false;
  freshPlan.modules = freshPlan.modules.map((module) => {
    const previous = previousModules.get(module.module);
    if (!previous) return module;
    if (!schedulingChanged || previous.collectedAt || previous.doneItemIds.length) return previous;
    return module;
  });
  freshPlan.modules = enrichCharacterWords(freshPlan.modules, content);
  const writing = freshPlan.modules.find(module => module.module === 'writing');
  if (writing && !writing.collectedAt && !writing.doneItemIds.length) {
    freshPlan.modules = alignWritingWithLiteracy(date, freshPlan.modules, content);
  }
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

export { validateContentPack, validateBackup } from './validation';

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
