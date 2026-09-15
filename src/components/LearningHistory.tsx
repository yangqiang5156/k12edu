import { useMemo, useState } from 'react';
import { buildLearningHistory, learnedContentIds, type LearningHistoryStatus } from '../learning-history';
import { MODULE_META, type LearningEvent, type CompletionEvent, type DailyPlan, type ModuleId } from '../types';

import { OUTCOME_LABELS } from '../learning';

interface Props {
  events?: LearningEvent[];
  plans: DailyPlan[];
  completions: CompletionEvent[];
  totalContent: number;
}

export function LearningHistory({ plans, completions, totalContent, events = [] }: Props) {
  const [date, setDate] = useState('');
  const [module, setModule] = useState<ModuleId | 'all'>('all');
  const [status, setStatus] = useState<LearningHistoryStatus>('all');
  const [query, setQuery] = useState('');
  const learnedCount = useMemo(() => learnedContentIds(plans, completions).size, [plans, completions]);
  const days = useMemo(() => buildLearningHistory(plans, { date, module, status, query }), [plans, date, module, status, query]);
  const visibleItems = days.flatMap((day) => day.modules.flatMap((task) => task.items));
  const completedItems = visibleItems.filter((item) => item.completed).length;

  return <main className="parent-body learning-history">
    <section className="metrics-grid history-metrics">
      <article><span>累计学过资料</span><strong>{learnedCount}</strong><small>资料库共 {totalContent} 条</small></article>
      <article><span>当前查询</span><strong>{completedItems}/{visibleItems.length}</strong><small>已完成/已安排</small></article>
    </section>
    <section className="parent-card history-filters">
      <h2>学习历史查询</h2>
      <input aria-label="搜索历史内容" value={query} placeholder="搜索内容名称、ID或正文" onChange={(event) => setQuery(event.target.value)} />
      <div className="history-filter-grid">
        <label>学习日期<input aria-label="按学习日期筛选" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>完成状态<select aria-label="按完成状态筛选" value={status} onChange={(event) => setStatus(event.target.value as LearningHistoryStatus)}><option value="all">全部状态</option><option value="completed">已完成</option><option value="incomplete">未完成</option></select></label>
      </div>
      <div className="history-module-filter">{(['all', ...Object.keys(MODULE_META)] as Array<ModuleId | 'all'>).map((id) => <button key={id} className={module === id ? 'selected' : ''} onClick={() => setModule(id)}>{id === 'all' ? '全部模块' : `${MODULE_META[id].icon} ${MODULE_META[id].title}`}</button>)}</div>
      {(date || module !== 'all' || status !== 'all' || query) && <button className="history-reset" onClick={() => { setDate(''); setModule('all'); setStatus('all'); setQuery(''); }}>清除筛选</button>}
    </section>

    <section className="history-days">
      {days.map((day, dayIndex) => {
        const itemCount = day.modules.reduce((sum, task) => sum + task.items.length, 0);
        const doneCount = day.modules.reduce((sum, task) => sum + task.items.filter((item) => item.completed).length, 0);
        return <article className="history-day" key={day.date}>
          <header><div><time>{new Date(`${day.date}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</time><span>{day.modules.length} 个模块 · {itemCount} 个内容</span></div><b>{doneCount}/{itemCount}</b></header>
          {day.modules.map((task, taskIndex) => <details key={task.id} open={dayIndex === 0 && taskIndex === 0}>
            <summary><span>{MODULE_META[task.module].icon} {MODULE_META[task.module].title}</span><small>{task.title}</small><b>{task.items.filter((item) => item.completed).length}/{task.items.length}</b></summary>
            <div className="history-items">{task.items.map((item) => <div key={item.id} className={item.completed ? 'completed' : 'incomplete'}><i>{item.completed ? '✓' : '○'}</i><span><strong>{item.title}</strong><small>{item.contentId}{item.isReview ? ' · 记忆复习' : ' · 新内容'}</small></span><b>{events.find(event => event.id === item.id) ? OUTCOME_LABELS[events.find(event => event.id === item.id)!.outcome] : item.completed ? '已完成 · 未记录表现' : '未完成'}</b></div>)}</div>
          </details>)}
        </article>;
      })}
      {!days.length && <div className="empty-card">没有找到符合条件的学习记录。</div>}
    </section>
  </main>;
}
