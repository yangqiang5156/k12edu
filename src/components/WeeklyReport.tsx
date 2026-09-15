import { useMemo, useState } from 'react';
import { datePlusDays, localDateKey } from '../logic';
import { OUTCOME_LABELS, weeklyLearningReport } from '../learning';
import { MODULE_META, type LearningEvent } from '../types';

export function WeeklyReport({ events }: { events: LearningEvent[] }) {
  const [date, setDate] = useState(localDateKey);
  const report = useMemo(() => weeklyLearningReport(events, date, localDateKey()), [events, date]);
  return <section className="parent-card weekly-report">
    <h2>学习周报</h2>
    <div className="week-navigation"><button onClick={() => setDate(datePlusDays(date, -7))}>上一周</button><span>{report.start} 至 {report.end}</span><button disabled={date >= localDateKey()} onClick={() => setDate(datePlusDays(date, 7) > localDateKey() ? localDateKey() : datePlusDays(date, 7))}>下一周</button></div>
    <p>本周新学 {report.newCount} 个内容，完成 {report.reviewCount} 次复习。</p>
    <div className="metrics-grid"><article><span>已记录表现</span><strong>{report.assessed}</strong></article><article><span>独立完成</span><strong>{report.independent}</strong></article><article><span>选择题首次答对</span><strong>{report.choiceCount ? `${report.firstCorrect}/${report.choiceCount}` : '暂无作答'}</strong></article><article><span>待巩固内容</span><strong>{report.practice.length}</strong></article></div>
    <p className="weekly-suggestion">{report.suggestion}</p>
    {report.practice.length > 0 && <details><summary>查看待巩固内容（{report.practice.length}）</summary><ul>{report.practice.map(event => <li key={event.contentId}><strong>{event.title}</strong><span>{MODULE_META[event.module].title} · {OUTCOME_LABELS[event.outcome]}{event.wrongAttempts ? ` · 答错 ${event.wrongAttempts} 次` : ''}</span></li>)}</ul></details>}
    <small>选择题依据实际作答记录；其他内容依据孩子或家长的反馈。{report.unknown > 0 ? `本周另有 ${report.unknown} 条历史完成记录没有表现数据，不计入独立完成。` : '完成次数不等同于掌握程度。'}</small>
  </section>;
}
