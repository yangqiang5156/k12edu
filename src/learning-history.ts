import type { CompletionEvent, DailyPlan, ModuleId } from './types';

export type LearningHistoryStatus = 'all' | 'completed' | 'incomplete';

export interface LearningHistoryFilters {
  date?: string;
  module?: ModuleId | 'all';
  status?: LearningHistoryStatus;
  query?: string;
}

export function learnedContentIds(plans: DailyPlan[], completions: CompletionEvent[] = []): Set<string> {
  const ids = new Set(completions.flatMap((event) => event.contentIds));
  for (const plan of plans) for (const task of plan.modules) for (const item of task.items) {
    if (task.collectedAt || task.doneItemIds.includes(item.id)) ids.add(item.contentId);
  }
  return ids;
}

export function buildLearningHistory(plans: DailyPlan[], filters: LearningHistoryFilters = {}) {
  const moduleFilter = filters.module ?? 'all';
  const statusFilter = filters.status ?? 'all';
  const keyword = filters.query?.trim().toLowerCase() ?? '';
  return plans
    .filter((plan) => !filters.date || plan.date === filters.date)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((plan) => {
      const modules = plan.modules.flatMap((task) => {
        if (moduleFilter !== 'all' && task.module !== moduleFilter) return [];
        const items = task.items.flatMap((item) => {
          const completed = Boolean(task.collectedAt) || task.doneItemIds.includes(item.id);
          if (statusFilter === 'completed' && !completed) return [];
          if (statusFilter === 'incomplete' && completed) return [];
          if (keyword && !`${item.title} ${item.contentId} ${item.detail ?? ''} ${item.prompt ?? ''}`.toLowerCase().includes(keyword)) return [];
          return [{ ...item, completed }];
        });
        return items.length ? [{ id: task.id, module: task.module, title: task.title, items }] : [];
      });
      return modules.length ? [{ date: plan.date, isActiveDay: plan.isActiveDay, modules }] : [];
    });
}
