import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { clearUserData, createBackup, DEFAULT_SETTINGS, importContentPack, loadAppData, mutateAppData, recordLearning, resolveReward, restoreBackup, saveRewardDefinition, saveStoryListening, updateLearningSettings } from './db';
import { calculateWallet, localDateKey } from './logic';
import { validateBackup } from './validation';

beforeEach(async () => {
  await loadAppData();
  await updateLearningSettings({ ...DEFAULT_SETTINGS, activeWeekdays: [new Date().getDay()] });
  await clearUserData();
});

describe('IndexedDB 事务与恢复', () => {
  it('已有账户补充音乐奖励、补齐半根余额，重复加载不重复发放', async () => {
    const now = new Date().toISOString();
    await mutateAppData(data => ({ ...data,
      rewardDefinitions: [{ id: 'snack', title: '自定义零食', icon: '🍪', currency: 'stars', cost: 7, enabled: false }],
      ledger: [{ id: 'old-carrot', date: localDateKey(), createdAt: now, currency: 'foodHalfUnits', delta: 3, sourceId: 'old', reason: '历史奖励' }]
    }));
    const first = await loadAppData();
    expect(calculateWallet(first.ledger).foodHalfUnits / 2).toBe(2);
    expect(first.rewardDefinitions.find(reward => reward.id === 'music')).toMatchObject({ title: '听音乐10分钟', currency: 'stars', cost: 20, enabled: true });
    expect(first.rewardDefinitions.find(reward => reward.id === 'snack')).toMatchObject({ title: '自定义零食', cost: 7, enabled: false });
    const second = await loadAppData();
    expect(second.ledger).toHaveLength(2);
    expect(second.rewardDefinitions.filter(reward => reward.id === 'music')).toHaveLength(1);
    await saveRewardDefinition({ ...second.rewardDefinitions.find(reward => reward.id === 'music')!, cost: 5 });
    expect((await loadAppData()).rewardDefinitions.find(reward => reward.id === 'music')?.cost).toBe(5);
  });
  it('恢复旧备份后立即得到整数胡萝卜余额和音乐奖励', async () => {
    const data = await loadAppData();
    const backup = createBackup({ ...data, rewardDefinitions: [], ledger: [{ id: 'half', date: localDateKey(), createdAt: new Date().toISOString(), currency: 'foodHalfUnits', delta: 1, sourceId: 'old', reason: '历史奖励' }] });
    await restoreBackup(backup);
    const db = await openDB('lexue-workbench', 3);
    expect(calculateWallet(await db.getAll('ledger')).foodHalfUnits).toBe(2);
    expect(await db.get('rewardDefinitions', 'music')).toMatchObject({ cost: 20 });
    db.close();
  });
  it('音乐兑换经家长确认只扣除20颗星星', async () => {
    const date = localDateKey(); const now = new Date().toISOString();
    await mutateAppData(data => ({ ...data, rewardDefinitions: [],
      ledger: [{ id: 'music-credit', date, createdAt: now, reason: '测试', sourceId: 'test', currency: 'stars', delta: 25 }],
      redemptions: [{ id: 'music-request', rewardId: 'music', rewardTitle: '听音乐10分钟', requestedAt: now, status: 'pending' }]
    }));
    await loadAppData();
    await resolveReward('music-request', true);
    expect(calculateWallet((await loadAppData()).ledger).stars).toBe(5);
  });
  it('已有音乐奖励自动迁移为20星星，保留标题和开关，迁移后不覆盖家长修改', async () => {
    await mutateAppData(data => ({ ...data, rewardDefinitions: [{ id: 'music', title: '听喜欢的音乐10分钟', icon: '🎵', currency: 'stars', cost: 3, enabled: false }] }));
    const data = await loadAppData();
    const music = data.rewardDefinitions.find(reward => reward.id === 'music')!;
    expect(music).toMatchObject({ title: '听喜欢的音乐10分钟', cost: 20, enabled: false, pricingVersion: 2 });
    await saveRewardDefinition({ ...music, cost: 25 });
    expect((await loadAppData()).rewardDefinitions.find(reward => reward.id === 'music')?.cost).toBe(25);
  });
  it('兑换价格拒绝小数，并将已有的小数价格改为整数', async () => {
    const reward = { id: 'decimal', title: '小奖励', icon: '🎁', currency: 'stars' as const, cost: 2.5, enabled: true };
    await expect(saveRewardDefinition(reward)).rejects.toThrow('正整数');
    await mutateAppData(data => ({ ...data, rewardDefinitions: [reward] }));
    expect((await loadAppData()).rewardDefinitions.find(item => item.id === 'decimal')?.cost).toBe(3);
  });
  it('首次加载产生计划，清空后无需刷新页面即有今日计划', async () => {
    const data = await loadAppData();
    expect(data.plans.some(plan => plan.date === localDateKey())).toBe(true);
    await clearUserData();
    const db = await openDB('lexue-workbench', 3);
    expect(await db.get('plans', localDateKey())).toBeDefined();
    expect(await db.count('learningEvents')).toBe(0);
    db.close();
  });
  it('并发完成同一条内容只记一次，只发一份模块奖励', async () => {
    const data = await loadAppData();
    const weekday = new Date().getDay();
    const changed = await updateLearningSettings({ ...data.settings, activeWeekdays: [weekday], enabledModules: ['literacy'], dailyContentCounts: { literacy: 1 } });
    const task = changed.plans.find(plan => plan.date === localDateKey())!.modules[0];
    await Promise.all(Array.from({ length: 4 }, () => recordLearning(task.id, task.items[0].id, { type: 'complete', outcome: 'independent' })));
    const next = await loadAppData();
    expect(next.learningEvents).toHaveLength(1);
    expect(next.completions).toHaveLength(1);
    expect(calculateWallet(next.ledger).stars).toBe(2);
    expect(next.reports[0].contentIds).toHaveLength(1);
  });
  it('关联写入中途失败会撤销已经写入的进度', async () => {
    const before = await loadAppData();
    // DataCloneError 模拟后续存储失败：计划先写入，随后流水写入失败。
    await expect(mutateAppData(data => ({ ...data,
      plans: data.plans.map(plan => ({ ...plan, completedAt: '2026-09-15T00:00:00Z' })),
      ledger: [...data.ledger, { id: 'broken', date: localDateKey(), createdAt: new Date().toISOString(), currency: 'stars', delta: 1,
        sourceId: 'broken', reason: (() => undefined) as unknown as string }]
    }))).rejects.toThrow();
    const after = await loadAppData();
    expect(after.plans).toEqual(before.plans);
    expect(after.ledger).toEqual(before.ledger);
  });
  it('恢复旧备份补当天计划，旧完成记录不伪造掌握度', async () => {
    const before = await loadAppData();
    const backup = createBackup({ ...before, plans: [], learningEvents: undefined });
    expect(validateBackup(backup).ok).toBe(true);
    await restoreBackup(backup);
    const db = await openDB('lexue-workbench', 3);
    expect(await db.get('plans', localDateKey())).toBeDefined();
    db.close();
  });
  it('兼容恢复历史题库中含重复干扰项的旧计划', async () => {
    const before = await loadAppData();
    const plan = before.plans[0];
    const task = plan.modules.find(entry => entry.module === 'math')!;
    task.items[0] = { ...task.items[0], options: ['1', '1', '2'], answer: '2' };
    const backup = createBackup(before);
    expect(validateBackup(backup).ok).toBe(true);
    await expect(restoreBackup(backup)).resolves.toBeUndefined();
  });
  it('无效嵌套数据在覆盖前被拒绝，原数据完整保留', async () => {
    const before = await loadAppData();
    const originalPet = { ...before.pet };
    const backup = createBackup(before);
    backup.data.pet = null as never;
    await expect(restoreBackup(backup)).rejects.toThrow('宠物');
    expect((await loadAppData()).pet).toEqual(originalPet);
  });
  it('并发审批同一个兑换只扣款一次', async () => {
    const date = localDateKey(); const now = new Date().toISOString();
    await mutateAppData(data => ({ ...data,
      ledger: [{ id: 'credit', date, createdAt: now, reason: '测试', sourceId: 'test', currency: 'stars', delta: 100 }],
      rewardDefinitions: [{ id: 'gift', title: '公园散步', icon: '🌳', currency: 'stars', cost: 30, enabled: true }],
      redemptions: [{ id: 'redeem', rewardId: 'gift', rewardTitle: '公园散步', requestedAt: now, status: 'pending' }]
    }));
    await Promise.all([resolveReward('redeem', true), resolveReward('redeem', true)]);
    const after = await loadAppData();
    expect(calculateWallet(after.ledger).stars).toBe(70);
    expect(after.redemptions[0].status).toBe('approved');
  });
  it('并发审批不同兑换不会透支', async () => {
    const date = localDateKey(); const now = new Date().toISOString();
    await mutateAppData(data => ({ ...data, ledger: [{ id: 'credit', date, createdAt: now, reason: '测试', sourceId: 'test', currency: 'stars', delta: 40 }],
      rewardDefinitions: [{ id: 'gift', title: '散步', icon: '🌳', currency: 'stars', cost: 30, enabled: true }],
      redemptions: ['a', 'b'].map(id => ({ id, rewardId: 'gift', rewardTitle: '散步', requestedAt: now, status: 'pending' as const })) }));
    const results = await Promise.allSettled([resolveReward('a', true), resolveReward('b', true)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(calculateWallet((await loadAppData()).ledger).stars).toBe(10);
  });
  it('重复导入内容包不留下部分记录', async () => {
    const id = `test-${crypto.randomUUID()}`;
    const pack = { schemaVersion: 1 as const, id, title: '测试包', contentVersion: '1', items: [{ id, module: 'literacy' as const, kind: 'character' as const, title: '人' }] };
    await importContentPack(pack);
    await expect(importContentPack({ ...pack, id: `${id}-2`, items: [{ ...pack.items[0], id: `${id}-new` }, pack.items[0]] })).rejects.toThrow('已存在');
    expect((await loadAppData()).content.some(item => item.id === `${id}-new`)).toBe(false);
  });
  it('故事进度随备份恢复，每日可选奖励只发一次', async () => {
    const date = localDateKey(); const now = new Date().toISOString();
    await updateLearningSettings({ ...DEFAULT_SETTINGS, storySettings: { ...DEFAULT_SETTINGS.storySettings!, allowDailyReward: true } });
    const progress = { id: 'tortoise-hare', audioVersion: 'v1', positionSeconds: 40, durationSeconds: 43,
      heardRanges: [[0, 40]] as Array<[number, number]>, completionCount: 1, completedAt: now, favorite: true, lastListenedAt: now };
    const event = { id: 'story-session', storyId: progress.id, title: '龟兔赛跑', date, startedAt: now, endedAt: now, listenedSeconds: 40, completed: true };
    await saveStoryListening(progress, event);
    await saveStoryListening(progress, event);
    expect((await loadAppData()).ledger.filter(item => item.sourceId === `story-daily-${date}`)).toHaveLength(1);
    const backup = createBackup(await loadAppData());
    await clearUserData();
    expect((await loadAppData()).storyProgress).toHaveLength(0);
    await restoreBackup(backup);
    expect((await loadAppData()).storyProgress?.[0].favorite).toBe(true);
    expect((await loadAppData()).storyListenEvents?.[0].title).toBe('龟兔赛跑');
  });
});
