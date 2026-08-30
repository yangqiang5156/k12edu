import { useRef, useState, type ChangeEvent } from 'react';
import { MODULE_META, type AppData, type ContentItem, type ModuleId, type ParentSettings, type Redemption, type RewardDefinition, type Wallet } from '../types';
import { calculateWallet, completedDaysThisWeek, localDateKey } from '../logic';
import { formatContentAge } from '../content-library';
import { ContentLibraryManager } from './ContentLibraryManager';

interface Props {
  data: AppData;
  onClose: () => void;
  onSaveSettings: (settings: ParentSettings) => Promise<void>;
  onResolveRedemption: (redemption: Redemption, approved: boolean) => Promise<void>;
  onSaveReward: (reward: RewardDefinition) => Promise<void>;
  onAdjustWallet: (target: Pick<Wallet, 'stars' | 'foodHalfUnits' | 'gems' | 'badges'>) => Promise<void>;
  onRemoveTaskItem: (taskId: string, itemId: string) => Promise<void>;
  onAddLibraryTask: (taskId: string, content: ContentItem) => Promise<void>;
  onSaveContent: (content: ContentItem) => Promise<void>;
  onDeleteContent: (content: ContentItem) => Promise<void>;
  onExport: () => void;
  onImportBackup: (file: File) => Promise<void>;
  onImportContent: (file: File) => Promise<void>;
  onClear: () => Promise<void>;
}

const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
type Tab = 'overview' | 'settings' | 'rewards' | 'data';

export function ParentPanel({ data, onClose, onSaveSettings, onResolveRedemption, onSaveReward, onAdjustWallet, onRemoveTaskItem, onAddLibraryTask, onSaveContent, onDeleteContent, onExport, onImportBackup, onImportContent, onClear }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [draft, setDraft] = useState(data.settings);
  const [libraryPickerTaskId, setLibraryPickerTaskId] = useState<string>();
  const [librarySearch, setLibrarySearch] = useState('');
  const [contentManagerOpen, setContentManagerOpen] = useState(false);
  const wallet = calculateWallet(data.ledger);
  const [rewardBalanceDraft, setRewardBalanceDraft] = useState(() => ({
    stars: wallet.stars,
    foodHalfUnits: wallet.foodHalfUnits,
    gems: wallet.gems,
    badges: wallet.badges
  }));
  const backupInput = useRef<HTMLInputElement>(null);
  const contentInput = useRef<HTMLInputElement>(null);
  const today = localDateKey();
  const todayPlan = data.plans.find((plan) => plan.date === today);
  const pending = data.redemptions.filter((item) => item.status === 'pending');
  const completedCount = todayPlan?.modules.filter((item) => item.collectedAt).length ?? 0;

  const fileHandler = (handler: (file: File) => Promise<void>) => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await handler(file);
    event.target.value = '';
  };

  return (
    <div className="parent-panel">
      <header className="parent-header">
        <button className="icon-button" onClick={onClose}>←</button>
        <div><span className="eyebrow">家长中心</span><h1>{draft.childName}的成长看板</h1></div>
      </header>
      <nav className="parent-tabs">
        {([['overview', '看板'], ['settings', '任务'], ['rewards', '奖励'], ['data', '数据']] as Array<[Tab, string]>).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {tab === 'overview' && <main className="parent-body">
        <section className="metrics-grid">
          <article><span>今日进度</span><strong>{completedCount}/{todayPlan?.modules.length ?? 0}</strong></article>
          <article><span>本周打卡</span><strong>{completedDaysThisWeek(data.plans, today)}/5</strong></article>
          <article><span>星光余额</span><strong>{wallet.stars} ⭐</strong></article>
          <article><span>累计经验</span><strong>{wallet.xp} XP</strong></article>
        </section>
        <section className="parent-card"><h2>今日模块</h2>
          {todayPlan?.modules.map((task) => <div className="report-row" key={task.id}><span>{MODULE_META[task.module].icon} {MODULE_META[task.module].title}</span><strong>{task.doneItemIds.length}/{task.items.length} {task.collectedAt ? '✓' : ''}</strong></div>) ?? <p>今天还没有生成学习清单。</p>}
        </section>
        <section className="parent-card"><h2>最近成长记录</h2>
          {data.reports.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).map((report) => <div className="timeline-row" key={report.date}><time>{report.date.slice(5)}</time><div><strong>完成 {report.completedModules.length} 个模块</strong><span>{report.note}</span></div></div>)}
          {!data.reports.length && <p>完成第一个模块后，这里会出现成长记录。</p>}
        </section>
      </main>}

      {tab === 'settings' && <main className="parent-body">
        <section className="parent-card form-card"><h2>学习设置</h2>
          <label>孩子昵称<input value={draft.childName} maxLength={8} onChange={(e) => setDraft({ ...draft, childName: e.target.value })} /></label>
          <span className="field-label">每周学习日</span><div className="toggle-row">{weekdayLabels.map((label, day) => <button key={day} className={draft.activeWeekdays.includes(day) ? 'selected' : ''} onClick={() => setDraft({ ...draft, activeWeekdays: draft.activeWeekdays.includes(day) ? draft.activeWeekdays.filter((value) => value !== day) : [...draft.activeWeekdays, day].sort() })}>周{label}</button>)}</div>
          <span className="field-label">开启的模块</span>{Object.entries(MODULE_META).map(([id, meta]) => <label className="switch-row" key={id}><span>{meta.icon} {meta.title}</span><input type="checkbox" checked={draft.enabledModules.includes(id as ModuleId)} onChange={(e) => setDraft({ ...draft, enabledModules: e.target.checked ? [...draft.enabledModules, id as ModuleId] : draft.enabledModules.filter((module) => module !== id) })} /></label>)}
          <label className="switch-row"><span>🔊 按钮和朗读声音</span><input type="checkbox" checked={draft.soundEnabled} onChange={(e) => setDraft({ ...draft, soundEnabled: e.target.checked })} /></label>
          <label className="switch-row"><span>🌿 减少动态效果</span><input type="checkbox" checked={draft.reduceMotion} onChange={(e) => setDraft({ ...draft, reduceMotion: e.target.checked })} /></label>
          <span className="field-label">学习伙伴</span><div className="pet-picker">{([['stella', '星黛露', '🌟'], ['archie', '阿奇', '🐶'], ['marie', '玛丽猫', '🐱']] as const).map(([id, name, icon]) => <button key={id} className={draft.petId === id ? 'selected' : ''} onClick={() => setDraft({ ...draft, petId: id })}>{icon}<span>{name}</span></button>)}</div>
          <button className="primary-button" onClick={async () => { await onSaveSettings(draft); }}>保存学习设置</button>
        </section>
        <section className="parent-card"><h2>修改今日任务</h2><p>可以删减小任务，或从对应模块的已有资料库中选择补充；已领取奖励的模块不可再改。</p>
          {todayPlan?.modules.map((task) => {
            const usedContentIds = new Set(task.items.map((item) => item.contentId));
            const keyword = librarySearch.trim().toLowerCase();
            const candidates = data.content.filter((content) => content.module === task.module
              && !usedContentIds.has(content.id)
              && (!keyword || `${content.title} ${content.subtitle ?? ''} ${content.body ?? ''}`.toLowerCase().includes(keyword)))
              .slice(0, 40);
            return <div className="task-editor" key={task.id}><strong>{MODULE_META[task.module].icon} {MODULE_META[task.module].title}</strong>
            {task.items.map((item) => <div className="task-edit-row" key={item.id}><span>{item.title}</span><button disabled={Boolean(task.collectedAt) || task.items.length <= 1} onClick={() => onRemoveTaskItem(task.id, item.id)}>删除</button></div>)}
            <button className="library-picker-trigger" disabled={Boolean(task.collectedAt)} title={task.collectedAt ? '奖励已领取，今日任务不能再修改' : '从已有资料库选择'} onClick={() => {
              setLibraryPickerTaskId(libraryPickerTaskId === task.id ? undefined : task.id);
              setLibrarySearch('');
            }}>{task.collectedAt ? '奖励已领取，不能添加' : libraryPickerTaskId === task.id ? '收起资料库' : '＋ 从资料库添加'}</button>
            {libraryPickerTaskId === task.id && <div className="library-picker">
              <input aria-label={`搜索${MODULE_META[task.module].title}资料库`} value={librarySearch} placeholder="搜索名称或内容" onChange={(event) => setLibrarySearch(event.target.value)} />
              <div className="library-options">
                {candidates.map((content) => <button key={content.id} onClick={async () => {
                  await onAddLibraryTask(task.id, content);
                  setLibraryPickerTaskId(undefined);
                  setLibrarySearch('');
                }}><strong>{content.title}</strong><span>{formatContentAge(content)} · {content.subtitle ?? content.body?.split('\n')[0] ?? '资料库内容'}</span><b>添加</b></button>)}
                {!candidates.length && <p>没有找到可添加的资料，可能已经全部加入今日任务。</p>}
              </div>
              {candidates.length === 40 && <small>当前显示前40条，请输入关键词缩小范围。</small>}
            </div>}
          </div>})}
        </section>
      </main>}

      {tab === 'rewards' && <main className="parent-body">
        {pending.length > 0 && <section className="parent-card pending-card"><h2>待确认兑换</h2>{pending.map((item) => <div className="pending-row" key={item.id}><span>{item.rewardTitle}</span><div><button onClick={() => onResolveRedemption(item, false)}>拒绝</button><button className="approve" onClick={() => onResolveRedemption(item, true)}>同意</button></div></div>)}</section>}
        <section className="parent-card wallet-adjust-card"><h2>首页奖励数值</h2><p>直接设置首页显示的奖励余额，修改会记录在奖励流水中。</p><div className="wallet-adjust-grid">
          <label>⭐ 星光<input aria-label="星光数值" type="number" min="0" step="1" value={rewardBalanceDraft.stars} onChange={(event) => setRewardBalanceDraft({ ...rewardBalanceDraft, stars: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
          <label>🥕 粮食<input aria-label="粮食数值" type="number" min="0" step="0.5" value={rewardBalanceDraft.foodHalfUnits / 2} onChange={(event) => setRewardBalanceDraft({ ...rewardBalanceDraft, foodHalfUnits: Math.max(0, Math.round((Number(event.target.value) || 0) * 2)) })} /></label>
          <label>💎 宝石<input aria-label="宝石数值" type="number" min="0" step="1" value={rewardBalanceDraft.gems} onChange={(event) => setRewardBalanceDraft({ ...rewardBalanceDraft, gems: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
          <label>🏅 勋章<input aria-label="勋章数值" type="number" min="0" step="1" value={rewardBalanceDraft.badges} onChange={(event) => setRewardBalanceDraft({ ...rewardBalanceDraft, badges: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
        </div><button className="primary-button full-button" onClick={() => onAdjustWallet(rewardBalanceDraft)}>保存奖励数值</button></section>
        <section className="parent-card"><h2>兑换标准</h2>{data.rewardDefinitions.map((reward) => <div className="reward-edit" key={reward.id}><span>{reward.icon}</span><input value={reward.title} onChange={(e) => onSaveReward({ ...reward, title: e.target.value })} /><input type="number" min="1" value={reward.cost} onChange={(e) => onSaveReward({ ...reward, cost: Math.max(1, Number(e.target.value)) })} /><small>{reward.currency === 'stars' ? '星光' : '勋章'}</small></div>)}</section>
      </main>}

      {tab === 'data' && contentManagerOpen && <ContentLibraryManager content={data.content} onSave={onSaveContent} onDelete={onDeleteContent} onClose={() => setContentManagerOpen(false)} />}

      {tab === 'data' && !contentManagerOpen && <main className="parent-body">
        <section className="parent-card"><h2>内容库</h2>
          {Object.entries(MODULE_META).map(([id, meta]) => <div className="content-count" key={id}><span>{meta.icon} {meta.title}</span><div><i style={{ width: `${Math.min(100, data.content.filter((item) => item.module === id && item.kind !== 'reader' && item.kind !== 'classic').length / meta.target * 100)}%` }} /></div><strong>{data.content.filter((item) => item.module === id && item.kind !== 'reader' && item.kind !== 'classic').length}/{meta.target}</strong></div>)}
          <button className="primary-button full-button" onClick={() => setContentManagerOpen(true)}>管理全部 {data.content.length} 条资料</button>
          <button className="soft-button full-button" onClick={() => contentInput.current?.click()}>＋ 导入 ContentPackV1</button><input hidden ref={contentInput} type="file" accept="application/json" onChange={fileHandler(onImportContent)} />
          <small>绘本仅管理进度。请只导入已获授权的内容或正版资源链接。</small>
        </section>
        <section className="parent-card"><h2>本地数据保护</h2><p>应用已申请持久存储，但清理浏览器数据或卸载仍可能删除记录。请定期备份。</p>
          <button className="primary-button full-button" onClick={onExport}>↓ 导出完整备份</button>
          <button className="soft-button full-button" onClick={() => backupInput.current?.click()}>↑ 恢复备份</button><input hidden ref={backupInput} type="file" accept="application/json" onChange={fileHandler(onImportBackup)} />
        </section>
        <section className="parent-card danger-zone"><h2>危险操作</h2><button onClick={async () => { if (window.confirm('确定清空所有学习进度、积分和兑换记录吗？内容库和设置会保留。')) await onClear(); }}>清空学习数据</button></section>
      </main>}
    </div>
  );
}
