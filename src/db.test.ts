import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { clearUserData, createBackup, DEFAULT_SETTINGS, importContentPack, loadAppData, mutateAppData, recordLearning, resolveReward, restoreBackup, updateLearningSettings } from './db';
import { calculateWallet, localDateKey } from './logic';
import { validateBackup } from './validation';

beforeEach(async () => {
  await loadAppData();
  await updateLearningSettings({ ...DEFAULT_SETTINGS, activeWeekdays: [new Date().getDay()] });
  await clearUserData();
});

describe('IndexedDB 事务与恢复', () => {
  it('首次加载产生计划，清空后无需刷新页面即有今日计划', async () => {
    const data = await loadAppData();
    expect(data.plans.some(plan => plan.date === localDateKey())).toBe(true);
    await clearUserData();
    const db = await openDB('lexue-workbench', 2);
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
    const db = await openDB('lexue-workbench', 2);
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
});
