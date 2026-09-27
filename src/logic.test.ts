import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT } from './content';
import { DEFAULT_SETTINGS } from './db';
import {
  attendanceBonusEntries, calculateWallet, completedDaysThisWeek, generateDailyPlan, milestoneBadgeEntry,
  moduleRewards, numberSpeechText, numberToChinese, numberToEnglish, petLevel, rewardBalanceAdjustmentEntries, rewardEntriesForCompletion,
  regenerateDailyPlanForSettings, shouldGrantAttendanceBonus, unlockedClassicCount, validateBackup, validateContentPack, weekStartKey
} from './logic';
import type { CompletionEvent, ContentItem, DailyPlan, ParentSettings, RewardLedgerEntry } from './types';

const completion = (id: string, module: CompletionEvent['module'] = 'guoxue'): CompletionEvent => ({
  id, date: '2026-08-10', module, taskId: id, completedAt: '2026-08-10T08:00:00.000Z', contentIds: [id]
});

describe('每日排课', () => {
  it('英语从每天两个新字母开始，所有开启模块都按日安排', () => {
    const plan = generateDailyPlan('2026-08-10', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    expect(plan.isActiveDay).toBe(true);
    expect(plan.modules.map((task) => task.module)).toEqual(['guoxue', 'literacy', 'math', 'english', 'writing', 'science']);
    expect(plan.modules.find((task) => task.module === 'english')?.items.map((item) => item.contentId)).toEqual(['letter-a', 'letter-b']);
    expect(plan.modules.find((task) => task.module === 'english')?.title).toContain('0/26');
    expect(plan.modules.find((task) => task.module === 'literacy')?.items).toHaveLength(2);
    expect(plan.modules.find((task) => task.module === 'writing')?.items.map(item => item.title))
      .toEqual(plan.modules.find((task) => task.module === 'literacy')?.items.map(item => item.title));
  });

  it('控笔同步识字的新字、复习字，也支持没有对应描红内容的自定义字', () => {
    const settings: ParentSettings = { ...DEFAULT_SETTINGS, enabledModules: ['writing', 'literacy'], dailyContentCounts: { literacy: 2, writing: 4 } };
    const custom: ContentItem = { id: 'parent-char', module: 'literacy', kind: 'character', title: '麒', source: 'imported' };
    const content = [custom, ...BUILTIN_CONTENT];
    const learned: CompletionEvent = { id: 'learned', date: '2026-08-10', module: 'literacy', taskId: 'learned', completedAt: '2026-08-10T08:00:00.000Z', contentIds: ['char-1'] };
    const plan = generateDailyPlan('2026-08-11', settings, content, [learned]);
    const literacy = plan.modules.find(task => task.module === 'literacy')!;
    const writing = plan.modules.find(task => task.module === 'writing')!;
    expect(writing.items.map(item => [item.title, item.isReview])).toEqual(literacy.items.map(item => [item.title, item.isReview]));
    expect(writing.items.every(item => item.kind === 'trace')).toBe(true);
    expect(writing.items).toHaveLength(literacy.items.length);
    const customPlan = generateDailyPlan('2026-08-11', { ...settings, dailyContentCounts: { literacy: 1 } }, [custom], []);
    expect(customPlan.modules.find(task => task.module === 'writing')?.items[0].contentId).toBe('trace-for-parent-char');
  });

  it('识字关闭时控笔仍按自身内容排课', () => {
    const settings: ParentSettings = { ...DEFAULT_SETTINGS, enabledModules: ['writing'], dailyContentCounts: { writing: 4 } };
    expect(generateDailyPlan('2026-08-10', settings, BUILTIN_CONTENT, []).modules[0].items).toHaveLength(4);
  });

  it('认识全部字母后进入单词与每周三本绘本排课', () => {
    const learnedLetters: CompletionEvent[] = [{
      id: 'letters-complete', date: '2026-08-09', module: 'english', taskId: 'letters',
      completedAt: '2026-08-09T08:00:00.000Z',
      contentIds: Array.from({ length: 26 }, (_, index) => `letter-${String.fromCharCode(97 + index)}`)
    }];
    const monday = generateDailyPlan('2026-08-10', DEFAULT_SETTINGS, BUILTIN_CONTENT, learnedLetters);
    expect(monday.modules.find((task) => task.module === 'english')?.items.some((item) => item.kind === 'reader')).toBe(true);
    const plan = generateDailyPlan('2026-08-11', DEFAULT_SETTINGS, BUILTIN_CONTENT, learnedLetters);
    expect(plan.modules.some((task) => task.module === 'science')).toBe(true);
    expect(plan.modules.find((task) => task.module === 'english')?.items.filter((item) => !item.isReview).every((item) => item.kind === 'word')).toBe(true);
    expect(plan.modules.find((task) => task.module === 'english')?.items.some((item) => item.isReview && item.kind === 'letter')).toBe(true);
  });

  it('非学习日生成稳定的休息日清单', () => {
    const first = generateDailyPlan('2026-08-16', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    const second = generateDailyPlan('2026-08-16', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    expect(first.isActiveDay).toBe(false);
    expect(first.modules).toEqual(second.modules);
    expect(first.modules).toHaveLength(0);
  });

  it('家长把周六改为学习日后立即重新生成当天清单', () => {
    const date = '2026-08-15';
    const restPlan = generateDailyPlan(date, DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    expect(restPlan.isActiveDay).toBe(false);
    expect(restPlan.modules).toHaveLength(0);

    const saturdaySettings = { ...DEFAULT_SETTINGS, activeWeekdays: [...DEFAULT_SETTINGS.activeWeekdays, 6] };
    const updatedPlan = regenerateDailyPlanForSettings(date, saturdaySettings, BUILTIN_CONTENT, [], restPlan);
    expect(updatedPlan.isActiveDay).toBe(true);
    expect(updatedPlan.modules.map((task) => task.module)).toEqual(['guoxue', 'literacy', 'math', 'english', 'writing', 'science']);
  });

  it('重新生成设置相关清单时保留当天已有进度', () => {
    const date = '2026-08-10';
    const existingPlan = generateDailyPlan(date, DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    existingPlan.modules[0].doneItemIds = [existingPlan.modules[0].items[0].id];

    const updatedPlan = regenerateDailyPlanForSettings(
      date,
      { ...DEFAULT_SETTINGS, soundEnabled: false },
      BUILTIN_CONTENT,
      [],
      existingPlan
    );
    expect(updatedPlan.modules[0].doneItemIds).toEqual(existingPlan.modules[0].doneItemIds);
  });

  it('按模块配置每日新内容数并立即更新未开始的当天任务', () => {
    const date = '2026-08-10';
    const existingPlan = generateDailyPlan(date, DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    const settings = { ...DEFAULT_SETTINGS, dailyContentCounts: { ...DEFAULT_SETTINGS.dailyContentCounts, literacy: 3, science: 2 } };
    const updatedPlan = regenerateDailyPlanForSettings(date, settings, BUILTIN_CONTENT, [], existingPlan, DEFAULT_SETTINGS);
    expect(updatedPlan.modules.find((task) => task.module === 'literacy')?.items).toHaveLength(3);
    expect(updatedPlan.modules.find((task) => task.module === 'writing')?.items.map(item => item.title))
      .toEqual(updatedPlan.modules.find((task) => task.module === 'literacy')?.items.map(item => item.title));
    expect(updatedPlan.modules.find((task) => task.module === 'science')?.items).toHaveLength(2);
  });

  it('已开始的识字任务保留进度并补上新组词', () => {
    const date = '2026-08-10';
    const existing = generateDailyPlan(date, DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    const literacy = existing.modules.find(task => task.module === 'literacy')!;
    literacy.items = literacy.items.map(item => ({ ...item, exampleWord: undefined }));
    literacy.doneItemIds = [literacy.items[0].id];
    const updated = regenerateDailyPlanForSettings(date, DEFAULT_SETTINGS, BUILTIN_CONTENT, [], existing);
    const updatedLiteracy = updated.modules.find(task => task.module === 'literacy')!;
    expect(updatedLiteracy.doneItemIds).toEqual(literacy.doneItemIds);
    expect(updatedLiteracy.items.every(item => item.exampleWord?.includes(item.title))).toBe(true);
  });

  it('按第1、3、7、14、30天加入已学内容并标记为记忆复习', () => {
    const settings: ParentSettings = { ...DEFAULT_SETTINGS, enabledModules: ['literacy'], dailyContentCounts: { literacy: 2 } };
    const learned: CompletionEvent = {
      id: 'learn-chars', date: '2026-08-10', module: 'literacy', taskId: 'learn-chars',
      completedAt: '2026-08-10T08:00:00.000Z', contentIds: ['char-1', 'char-2']
    };
    const dayOne = generateDailyPlan('2026-08-11', settings, BUILTIN_CONTENT, [learned]);
    expect(dayOne.modules[0].items.filter((item) => item.isReview).map((item) => item.contentId)).toEqual(['char-1', 'char-2']);
    expect(dayOne.modules[0].items.filter((item) => !item.isReview)).toHaveLength(2);

    const reviewedDayOne: CompletionEvent = { ...learned, id: 'review-day-1', date: '2026-08-11', contentIds: ['char-1', 'char-2'] };
    const dayTwo = generateDailyPlan('2026-08-12', settings, BUILTIN_CONTENT, [learned, reviewedDayOne]);
    expect(dayTwo.modules[0].items.some((item) => item.isReview)).toBe(false);
    const dayThree = generateDailyPlan('2026-08-13', settings, BUILTIN_CONTENT, [learned, reviewedDayOne]);
    expect(dayThree.modules[0].items.filter((item) => item.isReview)).toHaveLength(2);
  });

  it('每掌握10首不同古诗解锁一篇古文', () => {
    expect(unlockedClassicCount(9)).toBe(0);
    expect(unlockedClassicCount(10)).toBe(1);
    expect(unlockedClassicCount(27)).toBe(2);
  });
});

describe('奖励与全勤', () => {
  it('控笔奖励使用半单位粮食，其他模块为一份粮食', () => {
    expect(moduleRewards('writing')).toEqual({ stars: 1, foodHalfUnits: 1, xp: 1 });
    expect(moduleRewards('math')).toEqual({ stars: 2, foodHalfUnits: 2, xp: 2 });
    const entries = rewardEntriesForCompletion(completion('task-writing', 'writing'));
    expect(calculateWallet(entries).foodHalfUnits / 2).toBe(0.5);
  });

  it('同一完成事件生成固定ID，写入时可以幂等覆盖', () => {
    const event = completion('same-task', 'math');
    expect(rewardEntriesForCompletion(event).map((entry) => entry.id)).toEqual(rewardEntriesForCompletion(event).map((entry) => entry.id));
  });

  it('五天完成后只发放一次全勤奖励', () => {
    const plans = Array.from({ length: 5 }, (_, index): DailyPlan => ({ date: `2026-08-${String(10 + index).padStart(2, '0')}`, generatedAt: '', isActiveDay: true, modules: [], completedAt: 'done' }));
    expect(weekStartKey('2026-08-14')).toBe('2026-08-10');
    expect(completedDaysThisWeek(plans, '2026-08-14')).toBe(5);
    expect(shouldGrantAttendanceBonus(plans, '2026-08-14')).toBe(true);
    plans[4].weeklyBonusGranted = true;
    expect(shouldGrantAttendanceBonus(plans, '2026-08-14')).toBe(false);
    expect(calculateWallet(attendanceBonusEntries('2026-08-14'))).toMatchObject({ stars: 5, gems: 1 });
  });

  it('100经验升级并在里程碑发放勋章', () => {
    expect(petLevel(99)).toBe(1);
    expect(petLevel(100)).toBe(2);
    expect(petLevel(240)).toBe(3);
    expect(milestoneBadgeEntry(5, '2026-08-10')?.delta).toBe(1);
    expect(milestoneBadgeEntry(6, '2026-08-10')).toBeUndefined();
  });

  it('钱包正确累计正负流水', () => {
    const ledger: RewardLedgerEntry[] = [
      { id: 'a', date: '', createdAt: '', reason: '', sourceId: '', currency: 'stars', delta: 10 },
      { id: 'b', date: '', createdAt: '', reason: '', sourceId: '', currency: 'stars', delta: -3 },
      { id: 'c', date: '', createdAt: '', reason: '', sourceId: '', currency: 'foodHalfUnits', delta: 1 }
    ];
    expect(calculateWallet(ledger)).toMatchObject({ stars: 7, foodHalfUnits: 1 });
  });

  it('家长修改奖励余额时只追加差额流水', () => {
    const current = { stars: 8, foodHalfUnits: 4, xp: 8, gems: 0, badges: 0 };
    const entries = rewardBalanceAdjustmentEntries(current, { stars: 12, foodHalfUnits: 3, gems: 2, badges: 0 }, '2026-08-19', '2026-08-19T10:00:00.000Z');
    expect(entries.map((entry) => [entry.currency, entry.delta])).toEqual([
      ['stars', 4], ['foodHalfUnits', -1], ['gems', 2]
    ]);
  });
});

describe('导入校验与数字工具', () => {
  it('拒绝重复ID及非法模块的内容包', () => {
    const result = validateContentPack({ schemaVersion: 1, id: 'x', title: '测试', contentVersion: '1', items: [
      { id: 'same', module: 'bad', kind: 'word', title: 'A' }, { id: 'same', module: 'english', kind: 'word', title: 'B' }
    ] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('')).toContain('重复');
  });

  it('允许导入字母启蒙内容', () => {
    expect(validateContentPack({ schemaVersion: 1, id: 'letters', title: '字母', contentVersion: '1', items: [
      { id: 'letter-extra', module: 'english', kind: 'letter', title: 'A a' }
    ] }).ok).toBe(true);
  });

  it('拒绝无效的适合年龄范围', () => {
    expect(validateContentPack({ schemaVersion: 1, id: 'ages', title: '年龄', contentVersion: '1', items: [
      { id: 'bad-age', module: 'english', kind: 'word', title: 'apple', ageMin: 8, ageMax: 4 }
    ] }).ok).toBe(false);
  });

  it('拒绝不完整备份', () => {
    expect(validateBackup({ schemaVersion: 1, app: 'lexue-workbench', data: {} }).ok).toBe(false);
  });

  it('正确转换0到1000的中英文读法', () => {
    expect(numberToChinese(105)).toBe('一百零五');
    expect(numberToEnglish(105)).toBe('One Hundred and Five');
    expect(numberToChinese(1000)).toBe('一千');
  });

  it('将数字转换为完整朗读文本', () => {
    expect(numberSpeechText(105)).toBe('一百零五。One Hundred and Five.');
    expect(numberSpeechText(10, 'zh')).toBe('十');
    expect(numberSpeechText(1000, 'en')).toBe('One Thousand');
    expect(numberSpeechText(1001)).toBe('');
  });
});
