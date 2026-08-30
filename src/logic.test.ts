import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT } from './content';
import { DEFAULT_SETTINGS } from './db';
import {
  attendanceBonusEntries, calculateWallet, completedDaysThisWeek, generateDailyPlan, milestoneBadgeEntry,
  chineseNumberAudioTokens, englishNumberAudioTokens, moduleRewards, numberAudioTokens, numberToChinese, numberToEnglish, petLevel, rewardBalanceAdjustmentEntries, rewardEntriesForCompletion,
  shouldGrantAttendanceBonus, unlockedClassicCount, validateBackup, validateContentPack, weekStartKey
} from './logic';
import type { CompletionEvent, DailyPlan, RewardLedgerEntry } from './types';

const completion = (id: string, module: CompletionEvent['module'] = 'guoxue'): CompletionEvent => ({
  id, date: '2026-08-10', module, taskId: id, completedAt: '2026-08-10T08:00:00.000Z', contentIds: [id]
});

describe('每日排课', () => {
  it('英语从每天两个新字母开始，周一不安排科学', () => {
    const plan = generateDailyPlan('2026-08-10', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    expect(plan.isActiveDay).toBe(true);
    expect(plan.modules.map((task) => task.module)).toEqual(['guoxue', 'literacy', 'math', 'english', 'writing']);
    expect(plan.modules.find((task) => task.module === 'english')?.items.map((item) => item.contentId)).toEqual(['letter-a', 'letter-b']);
    expect(plan.modules.find((task) => task.module === 'english')?.title).toContain('0/26');
    expect(plan.modules.find((task) => task.module === 'literacy')?.items).toHaveLength(4);
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
    expect(plan.modules.find((task) => task.module === 'english')?.items.every((item) => item.kind === 'word')).toBe(true);
  });

  it('非学习日生成稳定的休息日清单', () => {
    const first = generateDailyPlan('2026-08-16', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    const second = generateDailyPlan('2026-08-16', DEFAULT_SETTINGS, BUILTIN_CONTENT, []);
    expect(first.isActiveDay).toBe(false);
    expect(first.modules).toEqual(second.modules);
    expect(first.modules).toHaveLength(0);
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

  it('使用有限离线词元正确组合0到1000中英文读音', () => {
    expect(chineseNumberAudioTokens(10)).toEqual(['zh_ten']);
    expect(chineseNumberAudioTokens(105)).toEqual(['zh_1', 'zh_hundred', 'zh_0', 'zh_5']);
    expect(englishNumberAudioTokens(105)).toEqual(['en_1', 'en_hundred', 'en_and', 'en_5']);
    expect(numberAudioTokens(999)).toEqual(['zh_9', 'zh_hundred', 'zh_9', 'zh_ten', 'zh_9', 'en_9', 'en_hundred', 'en_and', 'en_90', 'en_9']);
    expect(numberAudioTokens(1000, 'en')).toEqual(['en_1', 'en_thousand']);
    expect(numberAudioTokens(1001)).toEqual([]);
  });
});
