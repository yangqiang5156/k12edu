import { describe, expect, it } from 'vitest';
import { applyLearningAction, ensureTodayPlan, migrateLearningEvents, weeklyLearningReport } from './learning';
import { DEFAULT_SETTINGS } from './db';
import { calculateWallet, generateDailyPlan } from './logic';
import { validateBackup, validateContentPack } from './validation';
import { BUILTIN_CONTENT } from './content';
import type { AppData, ContentItem, LearningEvent } from './types';

const date = '2026-09-14';
const math: ContentItem = { id: 'math-test', module: 'math', kind: 'math-choice', title: '数苹果', prompt: '有几个苹果？', options: ['1', '2'], answer: '2', stage: 1, ageMin: 4, ageMax: 6 };
const base = (): AppData => ({ settings: { ...DEFAULT_SETTINGS, enabledModules: ['math'], dailyContentCounts: { math: 2 } },
  content: [math, { ...math, id: 'math-second' }], plans: [], completions: [], ledger: [], learningEvents: [],
  pet: { id: 'current', selected: 'stella', mood: 80, fedCount: 0 }, redemptions: [], reports: [], contentPacks: [], rewardDefinitions: [] });
const ready = () => ensureTodayPlan(base(), date);
const event = (overrides: Partial<LearningEvent> = {}): LearningEvent => ({ id: 'event', date, module: 'math', taskId: 'task', contentId: math.id,
  kind: 'math-choice', title: math.title, isReview: false, outcome: 'independent', attempts: 1, wrongAttempts: 0,
  firstAnswerCorrect: true, completedAt: `${date}T08:00:00Z`, updatedAt: `${date}T08:00:00Z`, ...overrides });

describe('逐条学习与恢复', () => {
  it('恢复缺少当天计划的数据会补齐，但不会覆盖已有部分进度', () => {
    const data = ready(); const task = data.plans[0].modules[0];
    const done = applyLearningAction(data, task.id, task.items[0].id, { type: 'answer', answer: '2' });
    expect(ensureTodayPlan(done, date).plans[0]).toBe(done.plans[0]);
    expect(ensureTodayPlan(done, '2026-09-15').plans).toHaveLength(2);
  });
  it('课程版本变化时更新未开始模块，并保留已经开始的模块', () => {
    const data = ready();
    const original = data.plans[0];
    original.curriculumVersion = 1;
    original.modules[0].doneItemIds = [original.modules[0].items[0].id];
    const prepared = ensureTodayPlan(data, date);
    expect(prepared.plans[0].curriculumVersion).toBe(6);
    expect(prepared.plans[0].modules[0]).toBe(original.modules[0]);
  });
  it('答错保存但不发奖，重试正确保留首次错误和提示表现', () => {
    const data = ready(); const task = data.plans[0].modules[0]; const item = task.items[0];
    const wrong = applyLearningAction(data, task.id, item.id, { type: 'answer', answer: '1' });
    expect(wrong.learningEvents?.[0]).toMatchObject({ attempts: 1, wrongAttempts: 1, firstAnswerCorrect: false, outcome: 'practice' });
    expect(wrong.ledger).toHaveLength(0);
    expect(wrong.plans[0].modules[0].doneItemIds).toHaveLength(0);
    const correct = applyLearningAction(wrong, task.id, item.id, { type: 'answer', answer: '2' });
    expect(correct.learningEvents?.[0]).toMatchObject({ attempts: 2, wrongAttempts: 1, firstAnswerCorrect: false, outcome: 'assisted' });
    expect(correct.plans[0].modules[0].doneItemIds).toEqual([item.id]);
    expect(correct.completions).toHaveLength(0);
    const tomorrow = generateDailyPlan('2026-09-15', data.settings, data.content, correct.completions, correct.learningEvents);
    expect(tomorrow.modules.flatMap(task => task.items).filter(entry => !entry.isReview).some(entry => entry.contentId === item.contentId)).toBe(false);
  });
  it('最后一条完成时同步产生模块、奖励、日报，重复完成不重复发奖', () => {
    let data = ready(); const task = data.plans[0].modules[0];
    for (const item of task.items) data = applyLearningAction(data, task.id, item.id, { type: 'answer', answer: '2' });
    expect(data.completions).toHaveLength(1);
    expect(data.reports[0].contentIds).toHaveLength(2);
    expect(calculateWallet(data.ledger).stars).toBe(2);
    expect(applyLearningAction(data, task.id, task.items[1].id, { type: 'answer', answer: '2' })).toBe(data);
  });
  it('旧的部分完成记录迁移为未知表现，重复迁移不增生', () => {
    const data = ready(); const task = data.plans[0].modules[0]; task.doneItemIds = [task.items[0].id];
    const events = migrateLearningEvents(data);
    expect(events).toHaveLength(1); expect(events[0].outcome).toBe('unknown');
    expect(migrateLearningEvents({ ...data, learningEvents: events })).toHaveLength(1);
  });
});

describe('适龄起点与表现复习', () => {
  it('年龄过滤生效，英语可直接从单词起步', () => {
    const settings = { ...DEFAULT_SETTINGS, childAge: 4, englishStart: 'words' as const };
    const plan = generateDailyPlan(date, settings, [...BUILTIN_CONTENT, { ...math, id: 'too-old', ageMin: 10, ageMax: 12 }], []);
    expect(plan.modules.flatMap(task => task.items).some(item => item.contentId === 'too-old')).toBe(false);
    expect(plan.modules.find(task => task.module === 'english')?.items.every(item => item.kind !== 'letter')).toBe(true);
  });
  it('需要练习次日复习，需要提示三天后复习', () => {
    const settings = { ...DEFAULT_SETTINGS, enabledModules: ['math' as const], dailyContentCounts: { math: 1 } };
    const practice = event({ outcome: 'practice' });
    const assisted = event({ outcome: 'assisted' });
    expect(generateDailyPlan('2026-09-15', settings, [math], [], [practice]).modules[0].items[0].isReview).toBe(true);
    expect(generateDailyPlan('2026-09-15', settings, [math], [], [assisted]).modules).toHaveLength(0);
    expect(generateDailyPlan('2026-09-17', settings, [math], [], [assisted]).modules[0].items[0].isReview).toBe(true);
  });
  it('第二次独立完成后复习间隔拉长，不会被题库兜底提前安排', () => {
    const events = [event(), event({ id: 'next', date: '2026-09-15', updatedAt: '2026-09-15T08:00:00Z', completedAt: '2026-09-15T08:00:00Z' })];
    expect(generateDailyPlan('2026-09-16', base().settings, [math], [], events).modules).toHaveLength(0);
    expect(generateDailyPlan('2026-09-18', base().settings, [math], [], events).modules[0].items[0].isReview).toBe(true);
  });
  it('数学由当前阶段的十个不同独立完成内容升阶，错误与历史点击不计入', () => {
    const content = [...Array.from({ length: 10 }, (_, i) => ({ ...math, id: `s1-${i}` })), { ...math, id: 's2', stage: 2 }];
    const events = content.slice(0, 10).map((item, i) => event({ id: `e${i}`, contentId: item.id }));
    const plan = generateDailyPlan('2026-09-15', base().settings, content, [], events);
    expect(plan.modules[0].title).toContain('第2阶');
    expect(generateDailyPlan('2026-09-17', base().settings, content, [], events.map(e => ({ ...e, outcome: 'assisted' as const }))).modules[0].title).toContain('第1阶');
    expect(generateDailyPlan(date, { ...base().settings, mathStartStage: 2 }, content, []).modules[0].items[0].contentId).toBe('s2');
  });
});

describe('周报与导入边界', () => {
  it('周报排除未知表现，并覆盖整周，后续独立完成会移除待巩固项', () => {
    const events = [event({ outcome: 'assisted', firstAnswerCorrect: false }),
      event({ id: 'legacy', contentId: 'legacy', outcome: 'unknown', firstAnswerCorrect: undefined, legacy: true }),
      event({ id: 'friday', date: '2026-09-18', isReview: true, updatedAt: '2026-09-18T08:00:00Z' })];
    const report = weeklyLearningReport(events, '2026-09-15');
    expect(report.assessed).toBe(2); expect(report.unknown).toBe(1); expect(report.practice).toHaveLength(0);
    expect(report.choiceCount).toBe(2); expect(report.firstCorrect).toBe(1);
  });
  it.each([null, {}, { items: {} }, { items: [null] }])('畸形内容包返回可读错误而不抛异常：%j', value => {
    expect(validateContentPack(value).ok).toBe(false);
  });
  it('拒绝答案不在选项、模块错配和嵌套备份损坏', () => {
    const pack = (item: unknown) => ({ schemaVersion: 1, id: 'pack', title: '包', contentVersion: '1', items: [item] });
    expect(validateContentPack(pack({ ...math, answer: '9' })).ok).toBe(false);
    expect(validateContentPack(pack({ ...math, module: 'english' })).ok).toBe(false);
    const backup = { schemaVersion: 1, app: 'lexue-workbench', exportedAt: new Date().toISOString(), data: ready() };
    expect(validateBackup(backup).ok).toBe(true);
    expect(validateBackup({ ...backup, data: { ...backup.data, pet: null } }).ok).toBe(false);
    expect(validateBackup({ ...backup, data: { ...backup.data, learningEvents: [{ ...event(), wrongAttempts: 9 }] } }).ok).toBe(false);
    expect(validateBackup({ ...backup, data: { ...backup.data, completions: undefined } }).ok).toBe(false);
  });
});
