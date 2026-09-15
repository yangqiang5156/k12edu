import { useMemo, useState } from 'react';
import { CONTENT_AGE_OPTIONS, CONTENT_KINDS_BY_MODULE, createContentDraft, filterContentLibrary, formatContentAge, normalizeContentItem } from '../content-library';
import { generateContentFromPrompt } from '../content-generation';
import { contentErrors } from '../validation';
import { MODULE_META, type ContentItem, type ModuleId } from '../types';

interface Props {
  content: ContentItem[];
  learnedContentIds: ReadonlySet<string>;
  onSave: (item: ContentItem) => Promise<void>;
  onDelete: (item: ContentItem) => Promise<void>;
  onClose: () => void;
}

const PAGE_SIZE = 30;

export function ContentLibraryManager({ content, learnedContentIds, onSave, onDelete, onClose }: Props) {
  const [module, setModule] = useState<ModuleId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [age, setAge] = useState<number | 'all'>('all');
  const [learningStatus, setLearningStatus] = useState<'all' | 'learned' | 'unlearned'>('all');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<ContentItem>();
  const [optionsText, setOptionsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [error, setError] = useState('');
  const [aiMode, setAiMode] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiNotice, setAiNotice] = useState('');

  const filtered = useMemo(() => filterContentLibrary(content, module, query, age).filter((item) => learningStatus === 'all' || (learningStatus === 'learned') === learnedContentIds.has(item.id)), [content, module, query, age, learningStatus, learnedContentIds]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE);

  const startEdit = (item: ContentItem) => {
    setDraft({ ...item });
    setOptionsText(item.options?.join('\n') ?? '');
    setTagsText(item.tags?.join('、') ?? '');
    setError('');
    setAiMode(false);
    setAiPrompt('');
    setAiNotice('');
  };

  const startCreate = () => startEdit(createContentDraft(module === 'all' ? 'guoxue' : module));

  const startAiCreate = () => {
    startEdit(createContentDraft(module === 'all' ? 'guoxue' : module));
    setAiMode(true);
  };

  const closeDraft = () => {
    if (generating) return;
    setDraft(undefined);
    setAiMode(false);
    setAiPrompt('');
    setAiNotice('');
    setError('');
  };

  const generate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return setError('请用一句话描述要新增的资料');
    setGenerating(true);
    setError('');
    setAiNotice('');
    try {
      const item = await generateContentFromPrompt(prompt);
      setDraft(item);
      setOptionsText(item.options?.join('\n') ?? '');
      setTagsText(item.tags?.join('、') ?? '');
      setAiNotice('已智能填写全部适用字段，请核对内容后保存。');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '智能生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };

  const changeModule = (nextModule: ModuleId) => {
    if (!draft) return;
    const defaults = createContentDraft(nextModule);
    setDraft({ ...draft, module: nextModule, kind: defaults.kind, ageMin: defaults.ageMin, ageMax: defaults.ageMax });
  };

  const save = async () => {
    if (!draft?.title.trim()) return setError('请填写资料名称');
    if (!draft.ageMin || !draft.ageMax) return setError('请填写完整的适合年龄范围');
    if (draft.ageMin > draft.ageMax) return setError('最小年龄不能大于最大年龄');
    const item = normalizeContentItem({
      ...draft,
      options: optionsText.split('\n'),
      tags: tagsText.split(/[、,，]/)
    });
    const errors = contentErrors(item);
    if (errors.length) return setError(errors.join('；'));
    try { await onSave(item); setDraft(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : '资料保存失败，请重试'); }
  };

  return <main className="parent-body content-manager">
    <section className="parent-card content-manager-head">
      <div><button className="soft-back" onClick={onClose}>← 返回数据页</button><h2>全部资料库内容</h2><p>共 {content.length} 条，当前筛选 {filtered.length} 条</p></div>
      <div className="content-create-actions"><button className="ai-create-button" onClick={startAiCreate}>✨ AI 一句话新增</button><button className="primary-button" onClick={startCreate}>＋ 手工新增</button></div>
    </section>

    <section className="parent-card content-filters">
      <input aria-label="搜索资料库" value={query} placeholder="搜索标题、正文、题目或标签" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      <label className="content-age-filter">适合年龄<select aria-label="按适合年龄筛选" value={age} onChange={(event) => { setAge(event.target.value === 'all' ? 'all' : Number(event.target.value)); setPage(1); }}><option value="all">全部年龄</option>{CONTENT_AGE_OPTIONS.map((value) => <option key={value} value={value}>{value}岁</option>)}</select></label>
      <label className="content-age-filter">学习状态<select aria-label="按学习状态筛选" value={learningStatus} onChange={(event) => { setLearningStatus(event.target.value as typeof learningStatus); setPage(1); }}><option value="all">全部状态</option><option value="learned">已学过</option><option value="unlearned">未学习</option></select></label>
      <div>{(['all', ...Object.keys(MODULE_META)] as Array<ModuleId | 'all'>).map((id) => <button key={id} className={module === id ? 'selected' : ''} onClick={() => { setModule(id); setPage(1); }}>{id === 'all' ? '全部' : `${MODULE_META[id].icon} ${MODULE_META[id].title}`}</button>)}</div>
    </section>

    <section className="content-record-list">
      {visible.map((item) => <article key={item.id} className="content-record">
        <header><span>{MODULE_META[item.module].icon}</span><div><strong>{item.title}</strong><small>{CONTENT_KINDS_BY_MODULE[item.module].find((kind) => kind.id === item.kind)?.label ?? item.kind} · {item.source === 'builtin' ? '内置' : '家长/导入'}</small></div><div className="content-record-badges"><b className={learnedContentIds.has(item.id) ? 'learning-badge learned' : 'learning-badge'}>{learnedContentIds.has(item.id) ? '已学' : '未学'}</b><b className="content-age-badge">{formatContentAge(item)}</b></div></header>
        <p>{item.subtitle ?? item.prompt ?? item.body?.split('\n')[0] ?? '暂无补充说明'}</p>
        <details><summary>查看全部信息</summary><dl>
          <div><dt>ID</dt><dd>{item.id}</dd></div><div><dt>模块</dt><dd>{MODULE_META[item.module].title}</dd></div><div><dt>类型</dt><dd>{item.kind}</dd></div>
          <div><dt>适合年龄</dt><dd>{formatContentAge(item)}</dd></div>
          {item.subtitle && <div><dt>副标题</dt><dd>{item.subtitle}</dd></div>}{item.body && <div><dt>正文</dt><dd>{item.body}</dd></div>}
          {item.prompt && <div><dt>题目</dt><dd>{item.prompt}</dd></div>}{item.options?.length && <div><dt>选项</dt><dd>{item.options.join(' / ')}</dd></div>}
          {item.answer && <div><dt>答案</dt><dd>{item.answer}</dd></div>}{item.stage && <div><dt>阶段</dt><dd>{item.stage}</dd></div>}
          {item.tags?.length && <div><dt>标签</dt><dd>{item.tags.join('、')}</dd></div>}{item.url && <div><dt>链接</dt><dd>{item.url}</dd></div>}
        </dl></details>
        <footer><button onClick={() => startEdit(item)}>编辑</button><button className="delete" onClick={async () => {
          if (window.confirm(`确定删除“${item.title}”吗？删除后无法从资料库选择，但已生成的学习记录不受影响。`)) await onDelete(item);
        }}>删除</button></footer>
      </article>)}
      {!visible.length && <div className="empty-card">没有找到符合条件的资料。</div>}
    </section>

    {filtered.length > PAGE_SIZE && <nav className="content-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{Math.min(page, pageCount)}/{pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</button></nav>}

    {draft && <div className="modal-backdrop"><section className="content-edit-dialog" role="dialog" aria-modal="true" aria-label={draft.title ? `编辑${draft.title}` : '新增资料'}>
      <header><div><span>{aiMode ? 'AI 一句话新增资料' : draft.title ? '编辑资料' : '手工新增资料'}</span><strong>{draft.id}</strong></div><button className="icon-button" disabled={generating} onClick={closeDraft}>×</button></header>
      {aiMode && <div className="ai-content-creator">
        <label htmlFor="ai-content-prompt">用一句话描述你想增加的内容</label>
        <div><textarea id="ai-content-prompt" rows={3} maxLength={500} disabled={generating} value={aiPrompt} placeholder="例如：增加一道适合5岁孩子的10以内加法选择题，主题是分享苹果" onChange={(event) => setAiPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void generate(); }} /><button className="primary-button" disabled={generating || !aiPrompt.trim()} onClick={() => void generate()}>{generating ? '正在智能填写…' : draft.title ? '重新生成' : '智能填写'}</button></div>
        <small>由 DeepSeek V4 Flash 生成，生成后不会自动保存；请核对原文、答案和事实。</small>
        {aiNotice && <span className="ai-success">✓ {aiNotice}</span>}
      </div>}
      <div className="content-edit-fields">
        <label>所属模块<select value={draft.module} onChange={(event) => changeModule(event.target.value as ModuleId)}>{Object.entries(MODULE_META).map(([id, meta]) => <option key={id} value={id}>{meta.icon} {meta.title}</option>)}</select></label>
        <label>资料类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ContentItem['kind'] })}>{CONTENT_KINDS_BY_MODULE[draft.module].map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></label>
        <fieldset className="content-age-fields"><legend>适合年龄</legend><label>最小年龄<input type="number" min="3" max="12" value={draft.ageMin ?? ''} onChange={(event) => setDraft({ ...draft, ageMin: event.target.value ? Number(event.target.value) : undefined })} /></label><label>最大年龄<input type="number" min="3" max="12" value={draft.ageMax ?? ''} onChange={(event) => setDraft({ ...draft, ageMax: event.target.value ? Number(event.target.value) : undefined })} /></label></fieldset>
        <label>名称（必填）<input value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>副标题／作者／拼音<input value={draft.subtitle ?? ''} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>
        <label>正文／讲解<textarea rows={5} value={draft.body ?? ''} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <label>题目提示<input value={draft.prompt ?? ''} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></label>
        <label>选项（每行一个）<textarea rows={4} value={optionsText} onChange={(event) => setOptionsText(event.target.value)} /></label>
        <label>正确答案<input value={draft.answer ?? ''} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} /></label>
        <label>学习阶段<input type="number" min="0" max="20" value={draft.stage ?? ''} onChange={(event) => setDraft({ ...draft, stage: event.target.value ? Number(event.target.value) : undefined })} /></label>
        <label>标签（用逗号分隔）<input value={tagsText} onChange={(event) => setTagsText(event.target.value)} /></label>
        <label>正版资源链接<input type="url" value={draft.url ?? ''} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
      </div>
      {error && <span className="form-error">{error}</span>}
      <footer><button className="soft-button" disabled={generating} onClick={closeDraft}>取消</button><button className="primary-button" disabled={generating} onClick={save}>保存资料</button></footer>
    </section></div>}
  </main>;
}
