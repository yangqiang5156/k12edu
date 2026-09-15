import type { AppData, DailyPlan, LearningAction, LearningEvent, LearningOutcome } from './types';
import { attendanceBonusEntries, DAILY_PLAN_CURRICULUM_VERSION, datePlusDays, generateDailyPlan, localDateKey, milestoneBadgeEntry, rewardEntriesForCompletion, shouldGrantAttendanceBonus, weekStartKey } from './logic';

export const OUTCOME_LABELS: Record<LearningOutcome, string> = {
  independent: '独立完成', assisted: '需要提示', practice: '还需练习', unknown: '未记录表现'
};

// 旧记录只迁移完成事实，不能把过去的点击完成推断成独立掌握。
export function migrateLearningEvents(data: Pick<AppData, 'plans' | 'completions' | 'learningEvents'>): LearningEvent[] {
  const events = new Map((data.learningEvents ?? []).map(event => [event.id, event]));
  for (const plan of data.plans) for (const task of plan.modules) for (const item of task.items) {
    if (events.has(item.id) || (!task.collectedAt && !task.doneItemIds.includes(item.id))) continue;
    const completedAt = task.collectedAt ?? `${plan.date}T12:00:00`;
    events.set(item.id, { id: item.id, date: plan.date, taskId: task.id, module: task.module,
      contentId: item.contentId, title: item.title, kind: item.kind, isReview: Boolean(item.isReview),
      outcome: 'unknown', attempts: 0, wrongAttempts: 0, completedAt, updatedAt: completedAt, legacy: true });
  }
  for (const completion of data.completions) for (const contentId of completion.contentIds) {
    if ([...events.values()].some(event => event.date === completion.date && event.contentId === contentId && event.completedAt)) continue;
    const id = `legacy-${completion.id}-${contentId}`;
    events.set(id, { id, date: completion.date, module: completion.module, taskId: completion.taskId,
      contentId, title: contentId, kind: completion.module === 'math' ? 'math-choice' : completion.module === 'english' ? 'word' : completion.module === 'writing' ? 'trace' : completion.module === 'literacy' ? 'character' : completion.module === 'science' ? 'science' : 'poem',
      isReview: false, outcome: 'unknown', attempts: 0, wrongAttempts: 0,
      completedAt: completion.completedAt, updatedAt: completion.completedAt, legacy: true });
  }
  return [...events.values()];
}

export function ensureTodayPlan(data: AppData, date = localDateKey()): AppData {
  const learningEvents = migrateLearningEvents(data);
  const existing = data.plans.find(plan => plan.date === date);
  let todayPlan = existing;
  if (!existing || existing.curriculumVersion !== DAILY_PLAN_CURRICULUM_VERSION) {
    todayPlan = generateDailyPlan(date, data.settings, data.content, data.completions, learningEvents);
    if (existing) {
      const previousModules = new Map(existing.modules.map(module => [module.module, module]));
      todayPlan.modules = todayPlan.modules.map(module => {
        const previous = previousModules.get(module.module);
        return previous?.collectedAt || previous?.doneItemIds.length ? previous : module;
      });
      todayPlan.completedAt = existing.completedAt;
      todayPlan.weeklyBonusGranted = existing.weeklyBonusGranted;
    }
  }
  const plans = existing
    ? data.plans.map(plan => plan.date === date ? todayPlan! : plan)
    : [...data.plans, todayPlan!];
  return { ...data, learningEvents, plans };
}

export function applyLearningAction(data: AppData, taskId: string, itemId: string, action: LearningAction, now = new Date().toISOString()): AppData {
  const plan = data.plans.find(plan => plan.modules.some(task => task.id === taskId));
  const task = plan?.modules.find(task => task.id === taskId);
  const item = task?.items.find(item => item.id === itemId);
  if (!plan || !task || !item) throw new Error('任务已变化，请返回首页后重试');
  if (task.collectedAt || task.doneItemIds.includes(itemId)) return data;
  const events = data.learningEvents ?? [];
  const previous = events.find(event => event.id === itemId);
  const event: LearningEvent = previous ? { ...previous } : {
    id: itemId, date: plan.date, taskId, module: task.module, contentId: item.contentId, title: item.title,
    kind: item.kind, isReview: Boolean(item.isReview), outcome: 'unknown', attempts: 0, wrongAttempts: 0, updatedAt: now
  };
  if (action.type === 'answer') {
    if (!item.options?.includes(action.answer) || !item.answer) throw new Error('题目选项无效');
    const correct = action.answer === item.answer;
    event.attempts += 1;
    event.firstAnswerCorrect ??= correct;
    if (!correct) event.wrongAttempts += 1;
    event.outcome = correct ? (event.wrongAttempts ? 'assisted' : 'independent') : 'practice';
    if (correct) event.completedAt = now;
  } else {
    if (item.options?.length) throw new Error('选择题需要作答后完成');
    event.outcome = action.outcome;
    event.completedAt = now;
  }
  event.updatedAt = now;
  const learningEvents = [...events.filter(entry => entry.id !== itemId), event];
  if (!event.completedAt) return { ...data, learningEvents };
  const updatedTask = { ...task, doneItemIds: [...task.doneItemIds, itemId] };
  const moduleFinished = updatedTask.items.every(entry => updatedTask.doneItemIds.includes(entry.id));
  if (moduleFinished) updatedTask.collectedAt = now;
  const updatedPlan: DailyPlan = { ...plan, modules: plan.modules.map(entry => entry.id === taskId ? updatedTask : entry) };
  const allDone = updatedPlan.modules.every(entry => entry.collectedAt);
  if (allDone) updatedPlan.completedAt = now;
  let completions = data.completions;
  let ledger = data.ledger;
  if (moduleFinished) {
    const completion = { id: `${plan.date}-${task.module}`, date: plan.date, module: task.module, taskId,
      completedAt: now, contentIds: task.items.map(entry => entry.contentId) };
    const rewards = rewardEntriesForCompletion(completion);
    if (!completions.some(entry => entry.id === completion.id)) {
      const badge = milestoneBadgeEntry(completions.length + 1, plan.date);
      if (badge) rewards.push(badge);
    }
    completions = [...completions.filter(entry => entry.id !== completion.id), completion];
    ledger = [...ledger.filter(entry => !rewards.some(reward => reward.id === entry.id)), ...rewards];
  }
  let plans = data.plans.map(entry => entry.date === plan.date ? updatedPlan : entry);
  if (allDone && shouldGrantAttendanceBonus(plans, plan.date)) {
    updatedPlan.weeklyBonusGranted = true;
    const bonus = attendanceBonusEntries(plan.date);
    ledger = [...ledger.filter(entry => !bonus.some(reward => reward.id === entry.id)), ...bonus];
    plans = plans.map(entry => entry.date === plan.date ? updatedPlan : entry);
  }
  const report = {
    date: plan.date, completedModules: updatedPlan.modules.filter(entry => entry.collectedAt).map(entry => entry.module),
    contentIds: learningEvents.filter(entry => entry.date === plan.date && entry.completedAt).map(entry => entry.contentId),
    earnedStars: ledger.filter(entry => entry.date === plan.date && entry.currency === 'stars' && entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0),
    earnedFoodHalfUnits: ledger.filter(entry => entry.date === plan.date && entry.currency === 'foodHalfUnits' && entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0),
    note: allDone ? '今日学习清单已完成。' : `今天已完成 ${learningEvents.filter(entry => entry.date === plan.date && entry.completedAt).length} 个内容。`
  };
  return { ...data, learningEvents, plans, completions, ledger, reports: [...data.reports.filter(entry => entry.date !== plan.date), report] };
}

export function weeklyLearningReport(events: LearningEvent[], date: string, asOf = datePlusDays(weekStartKey(date), 6)) {
  const start = weekStartKey(date);
  const end = datePlusDays(start, 6);
  const week = events.filter(event => event.date >= start && event.date <= asOf && event.date <= end);
  const completed = week.filter(event => event.completedAt);
  const assessed = completed.filter(event => event.outcome !== 'unknown');
  const latest = new Map<string, LearningEvent>();
  for (const event of week.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) latest.set(event.contentId, event);
  const practice = [...latest.values()].filter(event => event.outcome === 'practice' || event.outcome === 'assisted');
  const choices = week.filter(event => event.firstAnswerCorrect !== undefined);
  return { start, end,
    completed: completed.length, assessed: assessed.length,
    newCount: new Set(completed.filter(event => !event.isReview).map(event => event.contentId)).size,
    reviewCount: completed.filter(event => event.isReview).length,
    independent: assessed.filter(event => event.outcome === 'independent').length,
    firstCorrect: choices.filter(event => event.firstAnswerCorrect).length, choiceCount: choices.length,
    practice, unknown: completed.filter(event => event.outcome === 'unknown').length,
    suggestion: practice.length ? `下次优先巩固「${practice[0].title}」等 ${practice.length} 个内容，先提示，再让孩子自己试一次。`
      : assessed.length ? '本周已记录内容暂无待巩固项，继续按计划复习，观察能否独立完成。' : '完成学习后记录表现，周报就能给出更具体的练习建议。'
  };
}
