import { describe, expect, it } from 'vitest';
import { buildLearningHistory, learnedContentIds } from './learning-history';
import type { CompletionEvent, DailyPlan } from './types';

const plans: DailyPlan[] = [{
  date: '2026-09-12', generatedAt: '', isActiveDay: true, modules: [{
    id: 'task-1', module: 'literacy', title: '识字积累', doneItemIds: ['item-1'], items: [
      { id: 'item-1', contentId: 'char-one', title: '一', kind: 'character' },
      { id: 'item-2', contentId: 'char-two', title: '二', kind: 'character', isReview: true }
    ]
  }]
}, {
  date: '2026-09-11', generatedAt: '', isActiveDay: true, modules: [{
    id: 'task-2', module: 'math', title: '第1阶', doneItemIds: [], collectedAt: 'done', items: [
      { id: 'item-3', contentId: 'math-one', title: '1+1', kind: 'math-choice' }
    ]
  }]
}];

describe('家长学习历史', () => {
  it('按每日、模块和每个内容返回实际完成状态', () => {
    const history = buildLearningHistory(plans);
    expect(history.map((day) => day.date)).toEqual(['2026-09-12', '2026-09-11']);
    expect(history[0].modules[0].items.map((item) => [item.contentId, item.completed])).toEqual([['char-one', true], ['char-two', false]]);
  });

  it('支持日期、模块、状态和关键词组合查询', () => {
    expect(buildLearningHistory(plans, { date: '2026-09-12', module: 'literacy', status: 'incomplete', query: '二' })[0].modules[0].items.map((item) => item.contentId)).toEqual(['char-two']);
    expect(buildLearningHistory(plans, { module: 'science' })).toEqual([]);
  });

  it('资料库已学状态兼容小任务完成和旧完成事件', () => {
    const completion: CompletionEvent = { id: 'old', date: '2026-09-10', module: 'english', taskId: 'old', completedAt: '', contentIds: ['word-old'] };
    expect([...learnedContentIds(plans, [completion])].sort()).toEqual(['char-one', 'math-one', 'word-old']);
  });
});
