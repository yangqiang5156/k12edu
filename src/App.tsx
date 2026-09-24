import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  recordLearning, updateLearningSettings, resolveReward, mutateAppData, clearUserData, createBackup, deleteContentItem,
  importContentPack, loadAppData, restoreBackup, saveContentItem, saveRewardDefinition, saveStoryListening
} from './db';
import { calculateWallet, completedDaysThisWeek, localDateKey, rewardBalanceAdjustmentEntries, validateBackup, validateContentPack } from './logic';
import { MODULE_META, type LearningAction, type AppData, type ContentItem, type DailyPlan, type ParentSettings, type Redemption, type RewardDefinition, type RewardLedgerEntry, type Wallet } from './types';
import { ParentPanel } from './components/ParentPanel';
import { StoryLibrary } from './components/StoryLibrary';
import { Pet } from './components/Pet';
import { PinGate } from './components/PinGate';
import { TaskModal } from './components/TaskModal';
import { scheduleCloudUpload } from './cloud';
import type { StoryListenEvent, StoryProgress } from './story-types';
import { DEFAULT_STORY_SETTINGS, recommendedStories, visibleStories } from './stories';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type ChildTab = 'home' | 'growth' | 'rewards';

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [data, setData] = useState<AppData>();
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [tab, setTab] = useState<ChildTab>('home');
  const [storyRoute, setStoryRoute] = useState<string | null>(null);
  const [pinGate, setPinGate] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [celebrate, setCelebrate] = useState(0);
  const [feeding, setFeeding] = useState(false);
  const [feedAnimation, setFeedAnimation] = useState(0);
  const feedTimer = useRef<number | undefined>(undefined);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [today, setToday] = useState(localDateKey);
  const [loadError, setLoadError] = useState('');

  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_swUrl, registration) => {
      if (!registration) return;
      const checkForUpdate = () => { void registration.update(); };
      const hadController = Boolean(navigator.serviceWorker.controller);
      const reloadOnUpdate = () => {
        if (hadController) window.location.reload();
      };
      void registration.update();
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnUpdate, { once: true });
      window.setInterval(checkForUpdate, 5 * 60 * 1000);
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }
  });

  const refresh = async () => {
    try { setData(await loadAppData()); setLoadError(''); }
    catch (error) { setLoadError(error instanceof Error ? error.message : '本地数据暂时无法读取'); throw error; }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
    const checkDate = () => { setToday(localDateKey()); };
    const timer = window.setInterval(checkDate, 30000);
    window.addEventListener('focus', checkDate);
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('focus', checkDate); window.clearInterval(timer); };
  }, [today]);

  useEffect(() => {
    const onHash = () => {
      const value = location.hash.replace('#/', '');
      if (value === 'growth' || value === 'rewards' || value === 'home') setTab(value);
      setStoryRoute(value === 'stories' ? '' : value.startsWith('stories/') ? decodeURIComponent(value.slice(8)) : null);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => () => {
    if (feedTimer.current) window.clearTimeout(feedTimer.current);
  }, []);

  const currentPlan = data?.plans.find((plan) => plan.date === today);
  const wallet = useMemo(() => calculateWallet(data?.ledger ?? []), [data?.ledger]);
  const activeTask = currentPlan?.modules.find((task) => task.id === activeTaskId);

  useEffect(() => {
    if (data) scheduleCloudUpload(createBackup(data));
  }, [data]);

  const toast = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const updateSettings = async (settings: ParentSettings) => {
    try { setData(await updateLearningSettings(settings)); toast('设置已保存，未开始的任务已更新'); }
    catch (error) { toast(error instanceof Error ? error.message : '设置保存失败'); throw error; }
  };

  const markItem = async (taskId: string, itemId: string, action: LearningAction) => {
    const updated = await recordLearning(taskId, itemId, action);
    setData(updated);
    const before = currentPlan?.modules.find(task => task.id === taskId);
    const after = updated.plans.flatMap(plan => plan.modules).find(task => task.id === taskId);
    if (!before?.collectedAt && after?.collectedAt) {
      setCelebrate(value => value + 1);
      toast(`完成${MODULE_META[after.module].title}，星光飞来啦！`);
    }
  };

  const feedPet = async () => {
    if (!data || wallet.foodHalfUnits < 2 || feeding) return;
    setFeeding(true);
    setFeedAnimation((value) => value + 1);
    const now = new Date().toISOString();
    const entry: RewardLedgerEntry = { id: `feed-${Date.now()}`, date: today, createdAt: now, reason: '喂养学习伙伴', sourceId: `feed-${Date.now()}`, currency: 'foodHalfUnits', delta: -2 };
    try {
      setData(await mutateAppData(current => {
        if (calculateWallet(current.ledger).foodHalfUnits < 2) throw new Error('粮食不足');
        return { ...current, ledger: [...current.ledger, entry], pet: { ...current.pet,
          mood: Math.min(100, current.pet.mood + 10), fedCount: current.pet.fedCount + 1, lastInteractionAt: now } };
      }));
      if (feedTimer.current) window.clearTimeout(feedTimer.current);
      feedTimer.current = window.setTimeout(() => {
        setFeeding(false);
        toast('伙伴吃饱啦，谢谢你的照顾！');
      }, data.settings.reduceMotion ? 500 : 2400);
    } catch {
      setFeeding(false);
      toast('喂食没有成功，请再试一次');
    }
  };

  const requestReward = async (reward: RewardDefinition) => {
    if (!data) return;
    const available = reward.currency === 'stars' ? wallet.stars : wallet.badges;
    if (available < reward.cost) return toast(`还差 ${reward.cost - available} ${reward.currency === 'stars' ? '星光' : '勋章'}哦`);
    if (data.redemptions.some((item) => item.rewardId === reward.id && item.status === 'pending')) return toast('这个奖励正在等家长确认');
    const redemption: Redemption = { id: `redeem-${Date.now()}`, rewardId: reward.id, rewardTitle: reward.title, requestedAt: new Date().toISOString(), status: 'pending' };
    try {
      setData(await mutateAppData(current => {
        const latest = current.rewardDefinitions.find(entry => entry.id === reward.id && entry.enabled);
        if (!latest || calculateWallet(current.ledger)[latest.currency] < latest.cost) throw new Error('余额不足或奖励已变化');
        if (current.redemptions.some(entry => entry.rewardId === reward.id && entry.status === 'pending')) throw new Error('这个奖励正在等家长确认');
        return { ...current, redemptions: [...current.redemptions, redemption] };
      }));
      toast('已请家长来确认啦！');
    } catch (error) { toast(error instanceof Error ? error.message : '申请失败，请重试'); }
  };

  const resolveRedemption = async (redemption: Redemption, approved: boolean) => {
    try { setData(await resolveReward(redemption.id, approved)); toast(approved ? '兑换已确认并扣除余额' : '兑换已拒绝'); }
    catch (error) { toast(error instanceof Error ? error.message : '兑换保存失败，请重试'); }
  };

  const saveReward = async (reward: RewardDefinition) => {
    if (!data) return;
    await saveRewardDefinition(reward);
    setData({ ...data, rewardDefinitions: data.rewardDefinitions.map((entry) => entry.id === reward.id ? reward : entry) });
  };

  const adjustWallet = async (target: Pick<Wallet, 'stars' | 'foodHalfUnits' | 'gems' | 'badges'>) => {
    if (!data) return;
    try {
      setData(await mutateAppData(current => {
        const entries = rewardBalanceAdjustmentEntries(calculateWallet(current.ledger), target, today);
        if (!entries.length) throw new Error('奖励数值没有变化');
        return { ...current, ledger: [...current.ledger, ...entries] };
      }));
    } catch (error) { toast(error instanceof Error ? error.message : '奖励数值未保存，请重试'); return; }
    toast('首页奖励数值已更新');
  };

  const importBackupFile = async (file: File) => {
    try {
      const validation = validateBackup(JSON.parse(await file.text()));
      if (!validation.ok) return toast(validation.error);
      if (!window.confirm(`备份导出于 ${new Date(validation.backup.exportedAt).toLocaleString()}，恢复后将覆盖当前所有数据。继续吗？`)) return;
      if (data) downloadJson(`乐学恢复前备份-${today}.json`, createBackup(data));
      await restoreBackup(validation.backup);
      await refresh();
      toast('备份恢复成功');
    } catch (error) { toast(error instanceof SyntaxError ? '备份不是有效的 JSON 文件' : error instanceof Error ? error.message : '恢复失败，原数据已保留'); }
  };

  const restoreCloudBackup = async (backup: import('./types').BackupEnvelopeV1) => {
    if (data) downloadJson(`乐学云恢复前备份-${today}.json`, createBackup(data));
    await restoreBackup(backup);
    await refresh();
    setActiveTaskId(undefined);
    toast('云端学习记录已恢复');
  };

  const importContentFile = async (file: File) => {
    try {
      const validation = validateContentPack(JSON.parse(await file.text()));
      if (!validation.ok) return toast(validation.errors.slice(0, 3).join('；'));
      const record = await importContentPack(validation.pack);
      await refresh();
      toast(`成功导入 ${record.itemCount} 条内容`);
    } catch (error) { toast(error instanceof SyntaxError ? '内容包不是有效的 JSON 文件' : error instanceof Error ? error.message : '导入失败'); }
  };

  const install = async () => {
    if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(undefined); }
    else setShowInstallHelp(true);
  };

  const updateTodayPlan = async (updater: (plan: DailyPlan) => DailyPlan) => {
    if (!data || !currentPlan) return;
    setData(await mutateAppData(current => {
      const latest = current.plans.find(entry => entry.date === today);
      if (!latest) throw new Error('今日任务不存在，请刷新');
      return { ...current, plans: current.plans.map(entry => entry.date === today ? updater(latest) : entry) };
    }));
    toast('今日任务已更新');
  };

  const removeTaskItem = async (taskId: string, itemId: string) => updateTodayPlan((plan) => ({ ...plan, modules: plan.modules.map((task) => task.id === taskId && !task.collectedAt && !task.doneItemIds.includes(itemId) && task.items.length > 1 && task.items.some(item => item.id !== itemId && !task.doneItemIds.includes(item.id)) ? { ...task, items: task.items.filter((item) => item.id !== itemId), doneItemIds: task.doneItemIds.filter((id) => id !== itemId) } : task) }));

  const addLibraryTask = async (taskId: string, content: AppData['content'][number]) => updateTodayPlan((plan) => ({ ...plan, modules: plan.modules.map((task) => task.id === taskId && !task.collectedAt && !task.items.some((item) => item.contentId === content.id) ? { ...task, items: [...task.items, {
    id: `${task.id}-${content.id}-${Date.now()}`,
    contentId: content.id,
    title: content.title,
    detail: [content.subtitle, content.body].filter(Boolean).join('\n'),
    kind: content.kind,
    prompt: content.prompt,
    answer: content.answer,
    options: content.options
  }] } : task) }));

  const upsertContent = async (content: ContentItem) => {
    await saveContentItem(content);
    setData((current) => current && ({ ...current, content: current.content.some((item) => item.id === content.id)
      ? current.content.map((item) => item.id === content.id ? content : item)
      : [...current.content, content] }));
    toast('资料已保存');
  };

  const removeContent = async (content: ContentItem) => {
    await deleteContentItem(content.id);
    setData((current) => current && ({ ...current, content: current.content.filter((item) => item.id !== content.id) }));
    toast('资料已删除');
  };

  if (loadError) return <div className="loading-screen"><strong>学习数据暂时无法打开</strong><p role="alert">{loadError}</p><button className="primary-button" onClick={() => void refresh().catch(() => undefined)}>重新读取</button></div>;
  if (!data || !currentPlan) return <div className="loading-screen"><div className="loading-star">⭐</div><strong>正在准备今天的学习...</strong></div>;
  if (parentOpen) return <>
    <ParentPanel data={data} onClose={() => setParentOpen(false)} onSaveSettings={updateSettings} onResolveRedemption={resolveRedemption} onSaveReward={saveReward}
      onAdjustWallet={adjustWallet}
      onRemoveTaskItem={removeTaskItem} onAddLibraryTask={addLibraryTask}
      onSaveContent={upsertContent} onDeleteContent={removeContent}
      onExport={() => downloadJson(`乐学备份-${today}.json`, createBackup(data))} onImportBackup={importBackupFile} onImportContent={importContentFile}
      onRestoreCloud={restoreCloudBackup}
      onClear={async () => { try { await clearUserData(); await refresh(); setActiveTaskId(undefined); toast('学习数据已清空，今日计划已重新生成'); } catch { toast('清空失败，请重试'); } }} />
    {needRefresh && <div className="update-banner"><span>新版本准备好啦</span><button onClick={() => updateServiceWorker(true)}>立即更新</button><button onClick={() => setNeedRefresh(false)}>稍后</button></div>}
    {notice && <div className="global-toast">{notice}</div>}
  </>;

  const lastActive = (data.learningEvents ?? []).filter(event => event.date === today)
    .slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(event => currentPlan.modules.find(task => task.id === event.taskId && !task.collectedAt)).find(Boolean);
  const nextTask = lastActive ?? currentPlan.modules.find(task => !task.collectedAt);
  const completedModules = currentPlan.modules.filter((task) => task.collectedAt).length;
  const percent = currentPlan.modules.length ? Math.round(completedModules / currentPlan.modules.length * 100) : 0;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const storySettings = { ...DEFAULT_STORY_SETTINGS, ...data.settings.storySettings };
  const suggestedStory = recommendedStories(storySettings, data.settings.childAge ?? 4, data.storyProgress ?? [])[0];
  const continueStory = (data.storyProgress ?? []).filter(item => !item.completedAt && item.positionSeconds > 0).sort((a, b) => b.lastListenedAt.localeCompare(a.lastListenedAt))[0];
  const storyOnHome = continueStory ? visibleStories(storySettings).find(item => item.id === continueStory.id) ?? suggestedStory : suggestedStory;

  return (
    <div className={`app-shell ${data.settings.reduceMotion ? 'reduce-motion' : ''}`}>
      <header className="topbar">
        <h1>乐学</h1>
        <div className="topbar-actions">
          {tab === 'rewards' && <button className="parent-entry" onClick={() => setPinGate(true)}>家长 👨‍👩‍👦</button>}
          <span className="hello">嗨，{data.settings.childName} 👋</span>
        </div>
      </header>

      <main className="child-main">
        {storyRoute !== null && storySettings.enabled && <StoryLibrary data={data} initialStoryId={storyRoute || undefined} onClose={() => { location.hash = '#/home'; }} onOpenStory={(id) => { location.hash = id ? `#/stories/${encodeURIComponent(id)}` : '#/stories'; }} onSave={async (progress: StoryProgress, event?: StoryListenEvent) => { setData(await saveStoryListening(progress, event)); }} />}
        {storyRoute !== null && !storySettings.enabled && <div className="empty-card">故事屋已由家长关闭。<button className="soft-button" onClick={() => { location.hash = '#/home'; }}>返回今日</button></div>}
        {storyRoute === null && tab === 'home' && <>
          {nextTask && <section className="continue-card"><div><span>今天的小小进步</span><h2>{MODULE_META[nextTask.module].title}</h2><p>{nextTask.items.find(item => !nextTask.doneItemIds.includes(item.id))?.title} · 还剩 {nextTask.items.length - nextTask.doneItemIds.length} 个内容</p></div><button className="primary-button" onClick={() => setActiveTaskId(nextTask.id)}>{lastActive || nextTask.doneItemIds.length ? '继续学习' : '开始学习'} →</button></section>}
          {!nextTask && currentPlan.isActiveDay && <section className="continue-card"><div><h2>{currentPlan.completedAt ? '今天的学习完成啦' : '今天没有到期任务'}</h2><p>{currentPlan.completedAt ? '休息一下，下次再来。' : '可请家长检查年龄、学习起点，或等待下一次复习。'}</p></div></section>}
          <section className="wallet-row">
            <span>⭐ <strong>{wallet.stars}</strong></span><span className={`carrot-balance ${feeding ? 'is-feeding' : ''}`} key={`carrot-${feedAnimation}`}>🥕 <strong>{wallet.foodHalfUnits / 2}</strong></span><span>💎 <strong>{wallet.gems}</strong></span><span>🏅 <strong>{wallet.badges}</strong></span>
          </section>
          <Pet pet={data.pet} wallet={wallet} settings={data.settings} feeding={feeding} feedAnimation={feedAnimation} onFeed={feedPet} />
          {storySettings.enabled && <button className="story-home-card" onClick={() => { location.hash = '#/stories'; }}><span>📖</span><div><strong>{storyOnHome ? `故事时间 · ${storyOnHome.title}` : '故事时间'}</strong><small>{storyOnHome?.summary ?? '来听一个故事吧'}</small></div><b>去听 ›</b></button>}
          {!isStandalone && <section className="install-card"><div><strong>把乐学装到手机桌面</strong><span>离线也能学，每天打开就有新清单</span></div><button onClick={install}>添加</button></section>}
          <section className="today-heading"><div><span className="eyebrow">今日学习清单</span><h2>{currentPlan.isActiveDay ? `${completedModules}/${currentPlan.modules.length} 个模块完成` : '今天是轻松休息日'}</h2></div><div className="progress-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}><span>{percent}%</span></div></section>
          <div className="task-list">
            {currentPlan.modules.map((task) => {
              const meta = MODULE_META[task.module];
              const progress = task.items.length ? task.doneItemIds.length / task.items.length * 100 : 0;
              return <button className={`module-card ${task.collectedAt ? 'completed' : ''}`} key={task.id} onClick={() => setActiveTaskId(task.id)} style={{ '--module': meta.color } as React.CSSProperties}>
                <span className="module-icon">{meta.icon}</span><div className="module-copy"><strong>{meta.title}<small>{task.title}</small></strong><div className="module-progress"><i style={{ width: `${progress}%` }} /></div><span>{task.collectedAt ? '奖励已领取 ✓' : `${task.doneItemIds.length}/${task.items.length} 个小任务`}</span></div><b>{task.collectedAt ? '✓' : '›'}</b>
              </button>;
            })}
            {!currentPlan.modules.length && !currentPlan.isActiveDay && <section className="rest-card"><span>🌈</span><h2>今天休息一下吧</h2><p>散散步、看看云，也是在好好长大。</p></section>}
          </div>
        </>}

        {storyRoute === null && tab === 'growth' && <section className="page-section"><span className="eyebrow">我的成长</span><h2>每一天都算数 🌱</h2>
          <div className="streak-card"><span>🔥</span><div><strong>本周已打卡 {completedDaysThisWeek(data.plans, today)} 天</strong><small>完成5天会得到全勤宝石</small></div></div>
          <h3>成长记录</h3>{data.reports.slice().sort((a, b) => b.date.localeCompare(a.date)).map((report) => <article className="growth-record" key={report.date}><time>{new Date(`${report.date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</time><div>{report.completedModules.map((id) => <span key={id}>{MODULE_META[id].icon}</span>)}</div><strong>+{report.earnedStars} ⭐</strong><p>{report.note}</p></article>)}
          {!data.reports.length && <div className="empty-card">完成一个学习模块，成长记录就会出现在这里。</div>}
        </section>}

        {storyRoute === null && tab === 'rewards' && <section className="page-section"><span className="eyebrow">星光兑换屋</span><h2>努力换来小惊喜 🎁</h2>
          <div className="reward-balance"><span>可用星光 <strong>{wallet.stars}</strong></span><span>可用勋章 <strong>{wallet.badges}</strong></span></div>
          <div className="reward-list">{data.rewardDefinitions.filter((reward) => reward.enabled).map((reward) => <article key={reward.id}><span>{reward.icon}</span><div><strong>{reward.title}</strong><small>{reward.cost} {reward.currency === 'stars' ? '⭐ 星光' : '🏅 勋章'}</small></div><button onClick={() => requestReward(reward)}>想要</button></article>)}</div>
          <h3>兑换记录</h3>{data.redemptions.slice().reverse().map((item) => <div className="redeem-history" key={item.id}><span>{item.rewardTitle}</span><b className={item.status}>{item.status === 'pending' ? '等家长确认' : item.status === 'approved' ? '已兑换' : '未通过'}</b></div>)}
        </section>}
      </main>

      {storyRoute === null && <nav className="bottom-nav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => { location.hash = '#/home'; }}><span>🏠</span>今日</button>
        <button className={tab === 'growth' ? 'active' : ''} onClick={() => { location.hash = '#/growth'; }}><span>🌱</span>成长</button>
        <button className={tab === 'rewards' ? 'active' : ''} onClick={() => { location.hash = '#/rewards'; }}><span>🎁</span>兑换</button>
      </nav>}

      {activeTask && <TaskModal key={activeTask.id} events={data.learningEvents ?? []} task={activeTask} soundEnabled={data.settings.soundEnabled} onProgress={(itemId, action) => markItem(activeTask.id, itemId, action)} onClose={() => setActiveTaskId(undefined)} />}
      {pinGate && <PinGate settings={data.settings} onSaveSettings={updateSettings} onUnlock={() => { setPinGate(false); setParentOpen(true); }} onClose={() => setPinGate(false)} />}
      {notice && <div className="global-toast">{notice}</div>}
      {celebrate > 0 && <div className="star-rain" key={celebrate}>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--x': `${(index * 37) % 100}%`, '--delay': `${(index % 6) * .08}s` } as React.CSSProperties}>⭐</i>)}</div>}
      {needRefresh && <div className="update-banner"><span>新版本准备好啦</span><button onClick={() => updateServiceWorker(true)}>立即更新</button><button onClick={() => setNeedRefresh(false)}>稍后</button></div>}
      {showInstallHelp && <div className="modal-backdrop"><section className="install-help"><button className="icon-button" onClick={() => setShowInstallHelp(false)}>×</button><span>📲</span><h2>添加到手机桌面</h2>{isIos ? <ol><li>请使用 Safari 打开本页</li><li>点击底部“分享”按钮</li><li>选择“添加到主屏幕”</li><li>点击右上角“添加”</li></ol> : <p>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。应用需要通过 HTTPS 访问。</p>}</section></div>}
    </div>
  );
}

export default App;
