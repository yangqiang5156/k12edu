import { useEffect, useMemo, useState } from 'react';
import { activeChildId, archiveFamilyStory, generateFamilyStoryAudio, generateStoryDraft, loadFamilyStories, publishFamilyStory, saveFamilyStory, unpublishFamilyStory } from '../family-stories';
import { STORY_STAGES, STORY_THEMES } from '../stories';
import type { Story, StoryDraft, StoryTheme } from '../story-types';

const themeOptions: StoryTheme[] = ['bedtime', 'fable', 'habit', 'emotion', 'friendship', 'science', 'growth'];
const statusLabels: Record<string, string> = {
  draft: '文字草稿', audio_queued: '等待配音', audio_generating: '正在配音', ready: '待试听发布', published: '已发布', failed: '生成失败', archived: '已归档'
};

export function FamilyStoryManager({ childName, childAge }: { childName: string; childAge: number }) {
  const [stories, setStories] = useState<Story[]>([]);
  const [topic, setTopic] = useState('');
  const [theme, setTheme] = useState<StoryTheme>('bedtime');
  const [durationMinutes, setDurationMinutes] = useState<3 | 5 | 8>(5);
  const [useChildName, setUseChildName] = useState(false);
  const [draft, setDraft] = useState<StoryDraft>();
  const [paragraphText, setParagraphText] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    try { setStories(await loadFamilyStories()); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '家庭故事暂时无法读取'); }
  };
  useEffect(() => { void refresh(); }, []);
  const hasPending = useMemo(() => stories.some(story => ['audio_queued', 'audio_generating'].includes(story.status || '')), [stories]);
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  const generate = async () => {
    if (!topic.trim()) return setMessage('请先输入故事主题');
    setBusy('generate'); setMessage('正在创作故事草稿…');
    try {
      const next = await generateStoryDraft({ topic: topic.trim(), age: childAge, durationMinutes, theme, useChildName });
      setDraft(next); setParagraphText(next.paragraphs.join('\n\n')); setMessage('故事草稿已生成，请检查并修改后保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '故事生成失败'); }
    finally { setBusy(''); }
  };

  const edit = (story: Story) => {
    const next: StoryDraft = {
      id: story.id, childId: activeChildId(), title: story.title, summary: story.summary, stage: story.stage,
      ageMin: story.ageMin, ageMax: story.ageMax, themes: story.themes, paragraphs: story.paragraphs,
      durationMinutes: story.durationMinutes || 5,
    };
    setDraft(next); setParagraphText(next.paragraphs.join('\n\n')); setMessage('');
  };

  const save = async () => {
    if (!draft) return;
    const next = { ...draft, paragraphs: paragraphText.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean) };
    setBusy('save');
    try {
      const saved = await saveFamilyStory(next); setDraft(undefined); setParagraphText('');
      setStories(current => [saved, ...current.filter(item => item.id !== saved.id)]); setMessage('故事文字已保存，可以生成朗读音频。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(''); }
  };

  const action = async (key: string, task: () => Promise<unknown>, success: string) => {
    setBusy(key); setMessage('');
    try { await task(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(''); }
  };

  return <main className="parent-body family-story-manager">
    <section className="parent-card story-creator">
      <div><span className="eyebrow">AI 故事创作</span><h2>给{childName}创作一个新故事</h2><p>输入一个主题，生成后先由家长检查，再制作有感情的朗读音频。</p></div>
      <label>故事主题<textarea rows={3} maxLength={200} value={topic} disabled={Boolean(busy)} placeholder="例如：勇敢的小兔子第一次自己睡觉" onChange={event => setTopic(event.target.value)} /></label>
      <div className="story-create-options">
        <label>故事类型<select value={theme} onChange={event => setTheme(event.target.value as StoryTheme)}>{themeOptions.map(value => <option key={value} value={value}>{STORY_THEMES[value]}</option>)}</select></label>
        <label>朗读长度<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value) as 3 | 5 | 8)}><option value={3}>约3分钟</option><option value={5}>约5分钟</option><option value={8}>约8分钟</option></select></label>
        <label className="story-name-toggle"><input type="checkbox" checked={useChildName} onChange={event => setUseChildName(event.target.checked)} />在故事中自然使用“{childName}”</label>
      </div>
      <button className="primary-button full-button" disabled={Boolean(busy) || !topic.trim()} onClick={() => void generate()}>{busy === 'generate' ? '正在创作…' : '✨ 生成故事草稿'}</button>
      <small>AI 内容不会自动发布；请检查适龄性、事实和措辞。</small>
    </section>

    {draft && <section className="parent-card story-draft-editor">
      <h2>{draft.id ? '编辑故事文字' : '检查故事草稿'}</h2>
      <label>标题<input maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>简介<textarea rows={2} maxLength={240} value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
      <div className="story-create-options"><label>最小年龄<input type="number" min={3} max={12} value={draft.ageMin} onChange={event => setDraft({ ...draft, ageMin: Number(event.target.value) })} /></label><label>最大年龄<input type="number" min={3} max={12} value={draft.ageMax} onChange={event => setDraft({ ...draft, ageMax: Number(event.target.value) })} /></label></div>
      <label>正文（段落之间空一行）<textarea rows={14} value={paragraphText} onChange={event => setParagraphText(event.target.value)} /></label>
      <footer><button className="soft-button" disabled={Boolean(busy)} onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '正在保存…' : '保存故事文字'}</button></footer>
    </section>}

    {message && <p className="story-manager-message" role="status">{message}</p>}

    <section className="parent-card"><h2>家庭故事</h2><p>共 {stories.length} 篇；完成试听并手动发布后，孩子才能在故事屋看到。</p></section>
    <section className="family-story-list">
      {stories.map(story => <article className="family-story-card" key={story.id}>
        <header><span>{story.status === 'published' ? '📖' : story.status === 'failed' ? '⚠️' : '✨'}</span><div><strong>{story.title}</strong><small>{STORY_STAGES[story.stage]} · {story.themes.map(value => STORY_THEMES[value]).join(' · ')} · {statusLabels[story.status || 'draft']}</small></div></header>
        <p>{story.summary}</p>
        {story.errorMessage && <p className="form-error">{story.errorMessage}</p>}
        {story.audioUrl && <audio controls preload="metadata" src={story.audioUrl} />}
        <footer>
          {['draft', 'failed'].includes(story.status || '') && <button disabled={Boolean(busy)} onClick={() => edit(story)}>编辑文字</button>}
          {['draft', 'failed', 'ready'].includes(story.status || '') && <button disabled={Boolean(busy)} onClick={() => void action(`audio-${story.id}`, () => generateFamilyStoryAudio(story.id), '音频任务已开始，完成后可在这里试听。')}>{busy === `audio-${story.id}` ? '正在提交…' : story.audioUrl ? '重新生成音频' : '生成朗读音频'}</button>}
          {story.status === 'ready' && <button className="approve" disabled={Boolean(busy)} onClick={() => void action(`publish-${story.id}`, () => publishFamilyStory(story.id), '故事已发布到儿童故事屋。')}>发布</button>}
          {story.status === 'published' && <button disabled={Boolean(busy)} onClick={() => void action(`unpublish-${story.id}`, () => unpublishFamilyStory(story.id), '故事已从儿童故事屋撤下。')}>撤下</button>}
          <button className="delete" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`确定删除“${story.title}”吗？`)) void action(`delete-${story.id}`, () => archiveFamilyStory(story.id), '故事已删除。'); }}>删除</button>
        </footer>
      </article>)}
      {!stories.length && <div className="empty-card">还没有家庭故事，可以从上方输入一个主题开始创作。</div>}
    </section>
  </main>;
}
