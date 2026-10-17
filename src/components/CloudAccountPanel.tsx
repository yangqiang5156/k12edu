import { useEffect, useState } from 'react';
import { createBackup } from '../db';
import {
  createCloudChild, currentCloudChildId, deleteFamilyAccount, downloadCloudSnapshot, exportFamilyData, loadAdminContentPacks, loadAdminFamilies, loadAdminOverview,
  loadCloudAccount, loginFamily, logoutFamily, registerFamily, selectCloudChild, updateAdminFamily,
  publishAdminContentPack, updateAdminContentPack, uploadCloudSnapshot, type AdminContentPack, type AdminFamily, type AdminOverview, type CloudAccount, type CloudChild,
} from '../cloud';
import type { AppData, BackupEnvelopeV1 } from '../types';
import { validateCloudCredentials } from '../cloud-auth-validation';

interface Props {
  data: AppData;
  onRestore: (backup: BackupEnvelopeV1, child?: CloudChild) => Promise<void>;
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function AdminConsole() {
  const [overview, setOverview] = useState<AdminOverview>();
  const [families, setFamilies] = useState<AdminFamily[]>([]);
  const [packs, setPacks] = useState<AdminContentPack[]>([]);
  const [packJson, setPackJson] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [summary, list, contentPacks] = await Promise.all([loadAdminOverview(), loadAdminFamilies(), loadAdminContentPacks()]);
      setOverview(summary); setFamilies(list.families); setPacks(contentPacks.packs); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '管理数据读取失败'); }
  };
  useEffect(() => { void load(); }, []);
  const change = async (family: AdminFamily, changes: Parameters<typeof updateAdminFamily>[1]) => {
    try { await updateAdminFamily(family.id, changes); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
  };
  return <section className="parent-card cloud-admin">
    <h2>运营管理</h2>
    {error && <p className="form-error" role="alert">{error}</p>}
    {overview && <div className="metrics-grid">
      <article><span>家庭账号</span><strong>{overview.families.active}/{overview.families.total}</strong></article>
      <article><span>7日活跃设备</span><strong>{overview.devices.active7d}</strong></article>
      <article><span>7日朗读/上游</span><strong>{overview.usage7d.tts_requests}/{overview.usage7d.tts_upstream}</strong></article>
      <article><span>7日AI调用</span><strong>{overview.usage7d.ai_requests}</strong></article>
      <article><span>7日预估费用</span><strong>¥{Number(overview.estimatedCost7d || 0).toFixed(2)}</strong></article>
    </div>}
    {overview?.alerts?.map(alert => <p className="admin-alert" key={alert.alert_key}>⚠️ {alert.message}</p>)}
    <div className="admin-family-list">{families.map(family => <article key={family.id}>
      <div>
        <strong>{family.name}</strong>
        <small className="admin-family-email">注册邮箱：{family.registration_email || '暂无注册邮箱'}</small>
        <small>孩子 {family.children} · 设备 {family.devices} · 今日朗读 {family.tts_today} · AI {family.ai_today}</small>
      </div>
      <button onClick={() => void change(family, { paidEnabled: !family.paid_enabled })}>{family.paid_enabled ? '关闭在线生成' : '启用在线生成'}</button>
      <label>朗读/日<input type="number" min="0" defaultValue={family.tts_daily_limit} onBlur={event => void change(family, { ttsDailyLimit: Number(event.target.value) })} /></label>
      <label>AI/日<input type="number" min="0" defaultValue={family.ai_daily_limit} onBlur={event => void change(family, { aiDailyLimit: Number(event.target.value) })} /></label>
      <button className={family.status === 'blocked' ? 'approve' : 'delete'} onClick={() => void change(family, { status: family.status === 'blocked' ? 'active' : 'blocked' })}>{family.status === 'blocked' ? '恢复' : '停用'}</button>
    </article>)}</div>
    <div className="admin-content-packs"><h3>官方内容包</h3>
      <textarea rows={5} value={packJson} placeholder="粘贴 ContentPackV1 JSON，发布相同 id 和版本会更新内容并重新上架" onChange={event => setPackJson(event.target.value)} />
      <button className="primary-button full-button" disabled={!packJson.trim()} onClick={async () => {
        try { await publishAdminContentPack(JSON.parse(packJson)); setPackJson(''); await load(); }
        catch (cause) { setError(cause instanceof SyntaxError ? '内容包不是有效 JSON' : cause instanceof Error ? cause.message : '发布失败'); }
      }}>发布内容包版本</button>
      {packs.map(pack => <article key={`${pack.id}-${pack.content_version}`}><div><strong>{pack.title}</strong><small>{pack.id} · {pack.content_version}</small></div><button className={pack.status === 'active' ? 'delete' : 'approve'} onClick={async () => {
        try { await updateAdminContentPack(pack, pack.status === 'active' ? 'inactive' : 'active'); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '状态更新失败'); }
      }}>{pack.status === 'active' ? '下架' : '上架'}</button></article>)}
    </div>
  </section>;
}

export function CloudAccountPanel({ data, onRestore }: Props) {
  const [account, setAccount] = useState<CloudAccount>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newChildName, setNewChildName] = useState('');
  const [status, setStatus] = useState('正在检查云端账号…');
  const [deletePassword, setDeletePassword] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setAccount(await loadCloudAccount()); setStatus(''); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : '云端账号暂时不可用'); }
  };
  useEffect(() => { void refresh(); }, []);

  const submit = async () => {
    const validationError = validateCloudCredentials(mode, email, password);
    if (validationError) { setStatus(validationError); return; }
    setBusy(true); setStatus('');
    try {
      const next = mode === 'register' ? await registerFamily(email, password, data.settings.childName) : await loginFamily(email, password);
      setAccount(next); setPassword(''); setStatus(mode === 'register' ? '家庭账号已创建，本机进度将自动同步' : '登录成功');
      const childId = currentCloudChildId();
      if (childId && mode === 'register') await uploadCloudSnapshot(childId, createBackup(data));
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  };

  const upload = async (childId: string) => {
    setBusy(true);
    try { const result = await uploadCloudSnapshot(childId, createBackup(data)); setStatus(`已同步到云端 · 版本 ${result.version}`); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : '同步失败'); }
    finally { setBusy(false); }
  };

  const restore = async (child: CloudChild) => {
    setBusy(true);
    try {
      const snapshot = await downloadCloudSnapshot(child.id);
      if (!snapshot.data) {
        if (!window.confirm(`“${child.name}”还没有学习记录。切换后会保留资料库和学习设置，但清空当前进度，系统会先下载本机备份。继续吗？`)) return;
        const fresh = createBackup({
          ...data,
          settings: { ...data.settings, childName: child.name },
          plans: [], completions: [], ledger: [], redemptions: [], reports: [], learningEvents: [], storyProgress: [], storyListenEvents: [],
          pet: { id: 'current', selected: data.settings.petId, mood: 80, fedCount: 0 },
        });
        selectCloudChild(child.id);
        await onRestore(fresh, child);
        await uploadCloudSnapshot(child.id, fresh);
        setStatus(`已切换到 ${child.name} 的新档案`);
        return;
      }
      if (!window.confirm(`将用“${child.name}”的云端记录覆盖本机当前学习数据，系统会先下载本机备份。继续吗？`)) return;
      selectCloudChild(child.id);
      localStorage.setItem(`lexue:cloud-version:${child.id}`, String(snapshot.version));
      await onRestore(snapshot.data, child);
      setStatus(`已恢复 ${child.name} 的云端记录`);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : '恢复失败'); }
    finally { setBusy(false); }
  };

  if (!account?.authenticated) return <main className="parent-body">
    <section className="parent-card cloud-auth-card">
      <h2>{mode === 'login' ? '登录家庭账号' : '创建家庭账号'}</h2>
      <p>不登录也可以继续学习；登录后可以云端备份、换机恢复和管理多个孩子。</p>
      <form noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label>家长邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {mode === 'register' && <small>密码至少10个字符。孩子不需要单独账号。</small>}
        {status && <p className="cloud-status" role="status">{status}</p>}
        <button type="submit" className="primary-button full-button" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并同步本机进度'}</button>
        <button type="button" className="soft-button full-button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setStatus(''); }}>{mode === 'login' ? '还没有账号？创建家庭账号' : '已有账号？返回登录'}</button>
      </form>
    </section>
  </main>;

  const activeChildId = currentCloudChildId();
  return <main className="parent-body">
    <section className="parent-card cloud-account-card">
      <div className="cloud-account-title"><div><h2>{account.family?.name}</h2><p>{account.user?.email}</p></div><button onClick={async () => { try { await logoutFamily(); await refresh(); } catch (cause) { setStatus(cause instanceof Error ? cause.message : '退出失败，请重试'); } }}>退出</button></div>
      {!account.family?.paidEnabled && <p>在线生成尚未启用，请联系管理员；已有资料、音频和家庭同步仍可使用。</p>}
      <p>在线朗读每日额度 {account.limits?.ttsDaily ?? '—'} 次，AI生成每日额度 {account.limits?.aiDaily ?? '—'} 次。</p>
      {status && <p className="cloud-status" role="status">{status}</p>}
    </section>
    <section className="parent-card"><h2>孩子与云同步</h2>
      <div className="cloud-child-list">{account.children?.map(child => <article className={activeChildId === child.id ? 'active' : ''} key={child.id}>
        <div><strong>{child.name}</strong><small>{activeChildId === child.id ? '当前本机档案' : '云端档案'}</small></div>
        {activeChildId === child.id ? <button disabled={busy} onClick={() => void upload(child.id)}>立即同步</button> : <button disabled={busy} onClick={() => void restore(child)}>切换并恢复</button>}
      </article>)}</div>
      <div className="cloud-add-child"><input maxLength={20} value={newChildName} placeholder="新增孩子昵称" onChange={event => setNewChildName(event.target.value)} /><button disabled={busy || !newChildName.trim()} onClick={async () => {
        setBusy(true); try { const child = await createCloudChild(newChildName.trim()); setNewChildName(''); await refresh(); setStatus(`已创建 ${child.name} 的云端档案`); }
        catch (cause) { setStatus(cause instanceof Error ? cause.message : '新增失败'); } finally { setBusy(false); }
      }}>新增</button></div>
      <small>学习数据仍先保存在本机；登录后会延迟数秒自动上传。发生版本冲突时不会覆盖云端，需要先恢复云端版本。</small>
    </section>
    <section className="parent-card cloud-data-rights"><h2>家庭数据</h2>
      <p>可以随时导出云端账号、孩子档案、学习快照、额度和用量记录。</p>
      <button className="soft-button full-button" onClick={async () => {
        try { downloadJson(`乐学家庭数据-${new Date().toISOString().slice(0, 10)}.json`, await exportFamilyData()); setStatus('家庭数据已导出'); }
        catch (cause) { setStatus(cause instanceof Error ? cause.message : '导出失败'); }
      }}>导出云端家庭数据</button>
      <details><summary>注销家庭账号</summary><p>注销会永久删除家庭账号、所有孩子档案和云端学习快照，本机数据不会自动删除。</p>
        <input type="password" autoComplete="current-password" placeholder="输入家长账号密码确认" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} />
        <button className="danger-button" disabled={!deletePassword} onClick={async () => {
          if (!window.confirm('确定永久注销家庭账号并删除全部云端数据吗？此操作无法恢复。')) return;
          setBusy(true); try { await deleteFamilyAccount(deletePassword); await logoutFamily(); setDeletePassword(''); await refresh(); setStatus('家庭账号已注销，本机学习数据仍保留'); }
          catch (cause) { setStatus(cause instanceof Error ? cause.message : '注销失败'); } finally { setBusy(false); }
        }}>永久注销并删除云端数据</button>
      </details>
    </section>
    {account.user?.isAdmin && <AdminConsole />}
  </main>;
}
