import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { playClick } from './audio';
import {
  clearUserData, createBackup, deleteContentItem, importContentPack, loadAppData, restoreBackup, saveCompletion,
  saveContentItem, saveLedgerEntries, savePet, savePlan, saveRedemption, saveReport, saveRewardDefinition, saveSettings
} from './db';
import {
  attendanceBonusEntries, calculateWallet, completedDaysThisWeek, DAILY_PLAN_CURRICULUM_VERSION, generateDailyPlan, localDateKey,
  milestoneBadgeEntry, regenerateDailyPlanForSettings, rewardBalanceAdjustmentEntries, rewardEntriesForCompletion, shouldGrantAttendanceBonus, validateBackup, validateContentPack
} from './logic';
import { MODULE_META, type AppData, type CompletionEvent, type ContentItem, type DailyPlan, type ParentSettings, type Redemption, type RewardDefinition, type RewardLedgerEntry, type Wallet } from './types';
import { ParentPanel } from './components/ParentPanel';
import { Pet } from './components/Pet';
import { PinGate } from './components/PinGate';
import { TaskModal } from './components/TaskModal';

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
  const [pinGate, setPinGate] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [celebrate, setCelebrate] = useState(0);
  const [feeding, setFeeding] = useState(false);
  const [feedAnimation, setFeedAnimation] = useState(0);
  const feedTimer = useRef<number | undefined>(undefined);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const today = localDateKey();

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

  const refresh = async () => setData(await loadAppData());

  useEffect(() => {
    void (async () => {
      let loaded = await loadAppData();
      let plan = loaded.plans.find((entry) => entry.date === today);
      if (!plan || plan.curriculumVersion !== DAILY_PLAN_CURRICULUM_VERSION) {
        const freshPlan = generateDailyPlan(today, loaded.settings, loaded.content, loaded.completions);
        if (plan) {
          const previousModules = new Map(plan.modules.map((module) => [module.module, module]));
          freshPlan.modules = freshPlan.modules.map((module) => previousModules.get(module.module)?.collectedAt
            ? previousModules.get(module.module)!
            : module);
          freshPlan.completedAt = plan.completedAt;
          freshPlan.weeklyBonusGranted = plan.weeklyBonusGranted;
        }
        plan = freshPlan;
        await savePlan(plan);
        loaded = { ...loaded, plans: [...loaded.plans.filter((entry) => entry.date !== today), plan] };
      }
      setData(loaded);
      if (navigator.storage?.persist) await navigator.storage.persist();
    })();
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, [today]);

  useEffect(() => {
    const onHash = () => {
      const value = location.hash.replace('#/', '');
      if (value === 'growth' || value === 'rewards' || value === 'home') setTab(value);
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

  const toast = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const updateSettings = async (settings: ParentSettings) => {
    await saveSettings(settings);
    if (data) {
      const pet = { ...data.pet, selected: settings.petId };
      const existingPlan = data.plans.find((plan) => plan.date === today);
      const plan = regenerateDailyPlanForSettings(today, settings, data.content, data.completions, existingPlan, data.settings);
      await Promise.all([savePet(pet), savePlan(plan)]);
      setData((current) => current && ({
        ...current,
        settings,
        pet,
        plans: [...current.plans.filter((entry) => entry.date !== today), plan]
      }));
    }
    toast('设置已保存');
  };

  const markItem = async (taskId: string, itemId: string) => {
    if (!data || !currentPlan) return;
    const task = currentPlan.modules.find((entry) => entry.id === taskId);
    if (!task || task.doneItemIds.includes(itemId)) return;
    playClick(data.settings.soundEnabled);
    const updatedTask = { ...task, doneItemIds: [...task.doneItemIds, itemId] };
    const moduleFinished = updatedTask.doneItemIds.length === updatedTask.items.length && !updatedTask.collectedAt;
    const completedAt = new Date().toISOString();
    if (moduleFinished) updatedTask.collectedAt = completedAt;
    let updatedPlan: DailyPlan = {
      ...currentPlan,
      modules: currentPlan.modules.map((entry) => entry.id === taskId ? updatedTask : entry)
    };
    const allDone = updatedPlan.modules.length > 0 && updatedPlan.modules.every((entry) => entry.collectedAt);
    if (allDone && !updatedPlan.completedAt) updatedPlan = { ...updatedPlan, completedAt };

    let nextCompletions = data.completions;
    let nextLedger = data.ledger;
    if (moduleFinished) {
      const event: CompletionEvent = {
        id: `${today}-${task.module}`,
        date: today,
        module: task.module,
        taskId: task.id,
        completedAt,
        contentIds: task.items.map((item) => item.contentId)
      };
      const rewards = rewardEntriesForCompletion(event);
      const badge = milestoneBadgeEntry(nextCompletions.filter((entry) => entry.id !== event.id).length + 1, today);
      if (badge) rewards.push(badge);
      await saveCompletion(event, rewards);
      nextCompletions = [...nextCompletions.filter((entry) => entry.id !== event.id), event];
      nextLedger = [...nextLedger.filter((entry) => !rewards.some((reward) => reward.id === entry.id)), ...rewards];
      setCelebrate((value) => value + 1);
      toast(`完成${MODULE_META[task.module].title}，星光飞来啦！`);
    }

    let nextPlans = data.plans.map((plan) => plan.date === today ? updatedPlan : plan);
    if (allDone && shouldGrantAttendanceBonus(nextPlans, today)) {
      updatedPlan = { ...updatedPlan, weeklyBonusGranted: true };
      nextPlans = nextPlans.map((plan) => plan.date === today ? updatedPlan : plan);
      const bonus = attendanceBonusEntries(today);
      await saveLedgerEntries(bonus);
      nextLedger = [...nextLedger, ...bonus];
      toast('本周5天全勤！额外获得5星光和1宝石！');
    }
    await savePlan(updatedPlan);

    const completedModules = updatedPlan.modules.filter((entry) => entry.collectedAt).map((entry) => entry.module);
    const report = {
      date: today,
      completedModules,
      contentIds: updatedPlan.modules.filter((entry) => entry.collectedAt).flatMap((entry) => entry.items.map((item) => item.contentId)),
      earnedStars: nextLedger.filter((entry) => entry.date === today && entry.currency === 'stars' && entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0),
      earnedFoodHalfUnits: nextLedger.filter((entry) => entry.date === today && entry.currency === 'foodHalfUnits' && entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0),
      note: allDone ? '今日清单全部完成，专注又认真！' : `今天已完成 ${completedModules.length} 个学习模块。`
    };
    await saveReport(report);
    setData({ ...data, plans: nextPlans, completions: nextCompletions, ledger: nextLedger, reports: [...data.reports.filter((entry) => entry.date !== today), report] });
  };

  const feedPet = async () => {
    if (!data || wallet.foodHalfUnits < 2 || feeding) return;
    setFeeding(true);
    setFeedAnimation((value) => value + 1);
    const now = new Date().toISOString();
    const entry: RewardLedgerEntry = { id: `feed-${Date.now()}`, date: today, createdAt: now, reason: '喂养学习伙伴', sourceId: `feed-${Date.now()}`, currency: 'foodHalfUnits', delta: -2 };
    const pet = { ...data.pet, mood: Math.min(100, data.pet.mood + 10), fedCount: data.pet.fedCount + 1, lastInteractionAt: now };
    try {
      await Promise.all([saveLedgerEntries([entry]), savePet(pet)]);
      setData({ ...data, ledger: [...data.ledger, entry], pet });
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
    await saveRedemption(redemption);
    setData({ ...data, redemptions: [...data.redemptions, redemption] });
    toast('已请家长来确认啦！');
  };

  const resolveRedemption = async (redemption: Redemption, approved: boolean) => {
    if (!data) return;
    const definition = data.rewardDefinitions.find((reward) => reward.id === redemption.rewardId);
    let nextLedger = data.ledger;
    let finalApproved = approved;
    if (approved && definition) {
      const currentWallet = calculateWallet(data.ledger);
      const available = definition.currency === 'stars' ? currentWallet.stars : currentWallet.badges;
      if (available < definition.cost) { finalApproved = false; toast('余额不足，兑换未通过'); }
      else {
        const entry: RewardLedgerEntry = {
          id: `${redemption.id}-cost`, date: today, createdAt: new Date().toISOString(), reason: `兑换：${redemption.rewardTitle}`,
          sourceId: redemption.id, currency: definition.currency, delta: -definition.cost
        };
        await saveLedgerEntries([entry]);
        nextLedger = [...nextLedger, entry];
      }
    }
    const resolved: Redemption = { ...redemption, status: finalApproved ? 'approved' : 'rejected', resolvedAt: new Date().toISOString() };
    await saveRedemption(resolved);
    setData({ ...data, ledger: nextLedger, redemptions: data.redemptions.map((item) => item.id === resolved.id ? resolved : item) });
    toast(finalApproved ? '兑换已确认并扣除余额' : '兑换已拒绝');
  };

  const saveReward = async (reward: RewardDefinition) => {
    if (!data) return;
    await saveRewardDefinition(reward);
    setData({ ...data, rewardDefinitions: data.rewardDefinitions.map((entry) => entry.id === reward.id ? reward : entry) });
  };

  const adjustWallet = async (target: Pick<Wallet, 'stars' | 'foodHalfUnits' | 'gems' | 'badges'>) => {
    if (!data) return;
    const entries = rewardBalanceAdjustmentEntries(calculateWallet(data.ledger), target, today);
    if (!entries.length) return toast('奖励数值没有变化');
    await saveLedgerEntries(entries);
    setData({ ...data, ledger: [...data.ledger, ...entries] });
    toast('首页奖励数值已更新');
  };

  const importBackupFile = async (file: File) => {
    try {
      const validation = validateBackup(JSON.parse(await file.text()));
      if (!validation.ok) return toast(validation.error);
      if (!window.confirm(`备份导出于 ${new Date(validation.backup.exportedAt).toLocaleString()}，恢复后将覆盖当前所有数据。继续吗？`)) return;
      await restoreBackup(validation.backup);
      await refresh();
      toast('备份恢复成功');
    } catch { toast('备份不是有效的 JSON 文件'); }
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
    const plan = updater(currentPlan);
    await savePlan(plan);
    setData({ ...data, plans: data.plans.map((entry) => entry.date === today ? plan : entry) });
    toast('今日任务已更新');
  };

  const removeTaskItem = async (taskId: string, itemId: string) => updateTodayPlan((plan) => ({ ...plan, modules: plan.modules.map((task) => task.id === taskId && !task.collectedAt && task.items.length > 1 ? { ...task, items: task.items.filter((item) => item.id !== itemId), doneItemIds: task.doneItemIds.filter((id) => id !== itemId) } : task) }));

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

  if (!data || !currentPlan) return <div className="loading-screen"><div className="loading-star">⭐</div><strong>正在准备今天的学习...</strong></div>;
  if (parentOpen) return <>
    <ParentPanel data={data} onClose={() => setParentOpen(false)} onSaveSettings={updateSettings} onResolveRedemption={resolveRedemption} onSaveReward={saveReward}
      onAdjustWallet={adjustWallet}
      onRemoveTaskItem={removeTaskItem} onAddLibraryTask={addLibraryTask}
      onSaveContent={upsertContent} onDeleteContent={removeContent}
      onExport={() => downloadJson(`乐学备份-${today}.json`, createBackup(data))} onImportBackup={importBackupFile} onImportContent={importContentFile}
      onClear={async () => { await clearUserData(); await refresh(); toast('学习数据已清空'); }} />
    {needRefresh && <div className="update-banner"><span>新版本准备好啦</span><button onClick={() => updateServiceWorker(true)}>立即更新</button><button onClick={() => setNeedRefresh(false)}>稍后</button></div>}
    {notice && <div className="global-toast">{notice}</div>}
  </>;

  const completedModules = currentPlan.modules.filter((task) => task.collectedAt).length;
  const percent = currentPlan.modules.length ? Math.round(completedModules / currentPlan.modules.length * 100) : 0;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;

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
        {tab === 'home' && <>
          <section className="wallet-row">
            <span>⭐ <strong>{wallet.stars}</strong></span><span className={`carrot-balance ${feeding ? 'is-feeding' : ''}`} key={`carrot-${feedAnimation}`}>🥕 <strong>{wallet.foodHalfUnits / 2}</strong></span><span>💎 <strong>{wallet.gems}</strong></span><span>🏅 <strong>{wallet.badges}</strong></span>
          </section>
          <Pet pet={data.pet} wallet={wallet} settings={data.settings} feeding={feeding} feedAnimation={feedAnimation} onFeed={feedPet} />
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
            {!currentPlan.modules.length && <section className="rest-card"><span>🌈</span><h2>今天休息一下吧</h2><p>散散步、看看云，也是在好好长大。</p></section>}
          </div>
        </>}

        {tab === 'growth' && <section className="page-section"><span className="eyebrow">我的成长</span><h2>每一天都算数 🌱</h2>
          <div className="streak-card"><span>🔥</span><div><strong>本周已打卡 {completedDaysThisWeek(data.plans, today)} 天</strong><small>完成5天会得到全勤宝石</small></div></div>
          <h3>成长记录</h3>{data.reports.slice().sort((a, b) => b.date.localeCompare(a.date)).map((report) => <article className="growth-record" key={report.date}><time>{new Date(`${report.date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</time><div>{report.completedModules.map((id) => <span key={id}>{MODULE_META[id].icon}</span>)}</div><strong>+{report.earnedStars} ⭐</strong><p>{report.note}</p></article>)}
          {!data.reports.length && <div className="empty-card">完成一个学习模块，成长记录就会出现在这里。</div>}
        </section>}

        {tab === 'rewards' && <section className="page-section"><span className="eyebrow">星光兑换屋</span><h2>努力换来小惊喜 🎁</h2>
          <div className="reward-balance"><span>可用星光 <strong>{wallet.stars}</strong></span><span>可用勋章 <strong>{wallet.badges}</strong></span></div>
          <div className="reward-list">{data.rewardDefinitions.filter((reward) => reward.enabled).map((reward) => <article key={reward.id}><span>{reward.icon}</span><div><strong>{reward.title}</strong><small>{reward.cost} {reward.currency === 'stars' ? '⭐ 星光' : '🏅 勋章'}</small></div><button onClick={() => requestReward(reward)}>想要</button></article>)}</div>
          <h3>兑换记录</h3>{data.redemptions.slice().reverse().map((item) => <div className="redeem-history" key={item.id}><span>{item.rewardTitle}</span><b className={item.status}>{item.status === 'pending' ? '等家长确认' : item.status === 'approved' ? '已兑换' : '未通过'}</b></div>)}
        </section>}
      </main>

      <nav className="bottom-nav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => { location.hash = '#/home'; }}><span>🏠</span>今日</button>
        <button className={tab === 'growth' ? 'active' : ''} onClick={() => { location.hash = '#/growth'; }}><span>🌱</span>成长</button>
        <button className={tab === 'rewards' ? 'active' : ''} onClick={() => { location.hash = '#/rewards'; }}><span>🎁</span>兑换</button>
      </nav>

      {activeTask && <TaskModal task={activeTask} soundEnabled={data.settings.soundEnabled} onProgress={(itemId) => markItem(activeTask.id, itemId)} onClose={() => setActiveTaskId(undefined)} />}
      {pinGate && <PinGate settings={data.settings} onSaveSettings={updateSettings} onUnlock={() => { setPinGate(false); setParentOpen(true); }} onClose={() => setPinGate(false)} />}
      {notice && <div className="global-toast">{notice}</div>}
      {celebrate > 0 && <div className="star-rain" key={celebrate}>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--x': `${(index * 37) % 100}%`, '--delay': `${(index % 6) * .08}s` } as React.CSSProperties}>⭐</i>)}</div>}
      {needRefresh && <div className="update-banner"><span>新版本准备好啦</span><button onClick={() => updateServiceWorker(true)}>立即更新</button><button onClick={() => setNeedRefresh(false)}>稍后</button></div>}
      {showInstallHelp && <div className="modal-backdrop"><section className="install-help"><button className="icon-button" onClick={() => setShowInstallHelp(false)}>×</button><span>📲</span><h2>添加到手机桌面</h2>{isIos ? <ol><li>请使用 Safari 打开本页</li><li>点击底部“分享”按钮</li><li>选择“添加到主屏幕”</li><li>点击右上角“添加”</li></ol> : <p>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。应用需要通过 HTTPS 访问。</p>}</section></div>}
    </div>
  );
}

export default App;
