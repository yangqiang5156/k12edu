import { useEffect, useMemo, useRef, useState } from 'react';
import { localDateKey } from '../logic';
import { activeStoryCue, DEFAULT_STORY_SETTINGS, heardCoverage, listenedToday, mergeHeardRange, recommendedStories, STORIES, STORY_STAGES, STORY_THEMES, storyAudioUrl, storyCues, visibleStories } from '../stories';
import type { Story, StoryListenEvent, StoryProgress, StoryStage, StoryTheme } from '../story-types';
import type { AppData } from '../types';

interface Props {
  data: AppData;
  initialStoryId?: string;
  onSave: (progress: StoryProgress, event?: StoryListenEvent) => Promise<void>;
  onClose: () => void;
  onOpenStory: (id?: string) => void;
}

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const medianDuration = [...STORIES].sort((a, b) => a.durationSeconds - b.durationSeconds)[Math.floor(STORIES.length / 2)]?.durationSeconds ?? 60;

function StoryPlayer({ story, progress, soundEnabled, onSave, onBack, onFinished }: {
  story: Story; progress?: StoryProgress; soundEnabled: boolean; onSave: Props['onSave']; onBack: () => void; onFinished: (sessionSeconds: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const previous = progress?.audioVersion === story.audioVersion ? progress : undefined;
  const progressRef = useRef<StoryProgress>(previous ?? {
    id: story.id, audioVersion: story.audioVersion, positionSeconds: 0, durationSeconds: 0,
    heardRanges: [], completionCount: progress?.completionCount ?? 0,
    completedAt: progress?.completedAt, favorite: progress?.favorite ?? false, lastListenedAt: new Date().toISOString()
  });
  const sessionId = useRef(crypto.randomUUID());
  const sessionStart = useRef(new Date().toISOString());
  const sessionDate = useRef(localDateKey());
  const sessionSeconds = useRef(0);
  const sessionCompleted = useRef(false);
  const lastTick = useRef<{ position: number; wall: number } | undefined>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const lastSave = useRef(Date.now());
  const [position, setPosition] = useState(progressRef.current.positionSeconds);
  const [duration, setDuration] = useState(progressRef.current.durationSeconds);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState<'off' | 'end' | '10' | '20'>('off');
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const cycleCounted = useRef(Boolean(progressRef.current.completedAt && heardCoverage(progressRef.current.heardRanges, progressRef.current.durationSeconds) >= .8));
  const sleepStarted = useRef<number | undefined>(undefined);
  const audioUrl = storyAudioUrl(story);
  const cues = storyCues(story);
  const activeCue = activeStoryCue(cues, position);

  useEffect(() => {
    const container = readingRef.current;
    const sentence = container?.querySelector<HTMLElement>('.story-reading-active');
    if (!container || !sentence) return;
    const top = sentence.offsetTop - container.offsetTop;
    if (top < container.scrollTop + 24 || top + sentence.offsetHeight > container.scrollTop + container.clientHeight - 24) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: 'smooth' });
    }
  }, [activeCue]);

  const persist = (forceEvent = false) => {
    const audio = audioRef.current;
    if (audio) {
      progressRef.current.positionSeconds = audio.currentTime;
      progressRef.current.durationSeconds = audio.duration || progressRef.current.durationSeconds;
    }
    progressRef.current.lastListenedAt = new Date().toISOString();
    const next = { ...progressRef.current, heardRanges: progressRef.current.heardRanges.map(range => [...range] as [number, number]) };
    const event: StoryListenEvent | undefined = sessionSeconds.current >= 10 ? {
      id: sessionId.current, storyId: story.id, title: story.title, date: sessionDate.current,
      startedAt: sessionStart.current, endedAt: new Date().toISOString(), listenedSeconds: Math.floor(sessionSeconds.current),
      completed: sessionCompleted.current
    } : undefined;
    saveQueue.current = saveQueue.current.then(() => onSave(next, event)).catch(() => setMessage('进度保存失败，请检查设备空间'));
    if (forceEvent) lastSave.current = Date.now();
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && previous?.positionSeconds) audio.currentTime = Math.max(0, previous.positionSeconds - 3);
    const onHide = () => { if (document.visibilityState === 'hidden') persist(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); audio?.pause(); persist(true); };
  }, [story.id]);

  useEffect(() => {
    if (!playing || !sleepStarted.current || (sleep !== '10' && sleep !== '20')) return;
    const timer = window.setInterval(() => {
      if (Date.now() - sleepStarted.current! >= Number(sleep) * 60_000) {
        audioRef.current?.pause(); setPlaying(false); setSleep('off'); setMessage('睡眠定时已结束'); persist(true);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, sleep]);

  const tick = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const current = audio.currentTime;
    const now = Date.now();
    const prior = lastTick.current;
    if (prior && !audio.paused && current > prior.position && current - prior.position < 2.5) {
      const wallSeconds = Math.min((now - prior.wall) / 1000, 2);
      if (wallSeconds > 0 && wallSeconds < 2.1) {
        const today = localDateKey();
        if (today !== sessionDate.current) {
          persist(true);
          sessionId.current = crypto.randomUUID(); sessionDate.current = today;
          sessionStart.current = new Date().toISOString(); sessionSeconds.current = 0; sessionCompleted.current = false;
        }
        sessionSeconds.current += wallSeconds;
        progressRef.current.heardRanges = mergeHeardRange(progressRef.current.heardRanges, prior.position, current);
        if (!cycleCounted.current && heardCoverage(progressRef.current.heardRanges, audio.duration) >= .8) {
          cycleCounted.current = true;
          progressRef.current.completedAt ??= new Date().toISOString();
          progressRef.current.completionCount += 1;
          sessionCompleted.current = true;
          setMessage('听完啦！这个故事已记在成长记录里');
        }
      }
    }
    lastTick.current = { position: current, wall: now };
    progressRef.current.positionSeconds = current;
    setPosition(current);
    if (now - lastSave.current >= 15000) { lastSave.current = now; persist(); }
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!soundEnabled) { setMessage('声音已由家长关闭'); return; }
    if (!audio.paused) { audio.pause(); setPlaying(false); persist(true); return; }
    if (finished || audio.ended) {
      audio.currentTime = 0; progressRef.current.heardRanges = []; cycleCounted.current = false;
      lastTick.current = undefined; setFinished(false); setPosition(0);
    }
    try { await audio.play(); setPlaying(true); setMessage(''); if (sleep !== 'off' && !sleepStarted.current) sleepStarted.current = Date.now(); }
    catch { setMessage('音频暂时无法播放，请检查网络后重试'); }
  };
  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, value));
    lastTick.current = { position: audio.currentTime, wall: Date.now() };
    setPosition(audio.currentTime); persist(true);
  };
  const setTimer = (value: typeof sleep) => { setSleep(value); sleepStarted.current = value === '10' || value === '20' ? Date.now() : undefined; };
  const storyLength = story.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  let walked = 0;
  const paragraphIndex = story.paragraphs.findIndex(paragraph => {
    walked += paragraph.length;
    return storyLength && position / Math.max(duration, 1) <= walked / storyLength;
  });

  return <section className="story-player" aria-label={`播放${story.title}`}>
    <button className="soft-back" onClick={onBack}>← 返回故事屋</button>
    <div className="story-cover" aria-hidden="true">{story.icon}</div>
    <span className="eyebrow">{STORY_STAGES[story.stage]} · {story.themes.map(theme => STORY_THEMES[theme]).join(' · ')}</span>
    <h2>{story.title}</h2><p className="story-summary">{story.summary}</p>
    <audio ref={audioRef} src={audioUrl} preload="metadata" onLoadedMetadata={event => {
      const media = event.currentTarget; setDuration(media.duration); progressRef.current.durationSeconds = media.duration;
      if (previous?.positionSeconds) media.currentTime = Math.min(media.duration - 1, Math.max(0, previous.positionSeconds - 3));
    }} onTimeUpdate={tick} onPause={() => setPlaying(false)} onEnded={() => {
      setPlaying(false); setFinished(true); persist(true); if (sleep !== 'end') onFinished(sessionSeconds.current);
    }} onError={() => setMessage('音频加载失败，请联网后重试')} />
    {cues.length ? <div ref={readingRef} className="story-reading" aria-label="故事正文，朗读时逐句高亮">
      {story.paragraphs.map((paragraph, paragraphNumber) => <p key={paragraphNumber}>
        {cues.map((cue, index) => cue.paragraphIndex === paragraphNumber
          ? <span key={index} className={index === activeCue ? 'story-reading-active' : undefined}>{cue.text}</span> : null)}
      </p>)}
    </div> : <p className="story-caption">{story.paragraphs[Math.max(0, paragraphIndex)]}</p>}
    <div className="story-seek"><span>{formatTime(position)}</span><input aria-label="故事播放进度" type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(position, Math.max(1, duration))} onChange={event => seek(Number(event.target.value))} /><span>{formatTime(duration)}</span></div>
    <div className="story-controls"><button onClick={() => seek(position - 15)} aria-label="后退十五秒">↺ 15秒</button><button className="story-play" onClick={() => void toggle()}>{playing ? '暂停' : finished ? '再听一次' : '播放'}</button><button onClick={() => seek(position + 15)} aria-label="前进十五秒">15秒 ↻</button></div>
    <div className="story-options"><button onClick={() => { const values = [0.8, 1, 1.2]; const next = values[(values.indexOf(speed) + 1) % values.length]; setSpeed(next); if (audioRef.current) audioRef.current.playbackRate = next; }}>{speed.toFixed(1)} 倍速</button><select aria-label="睡眠定时" value={sleep} onChange={event => setTimer(event.target.value as typeof sleep)}><option value="off">不定时</option><option value="end">听完本篇停止</option><option value="10">10分钟后停止</option><option value="20">20分钟后停止</option></select><button onClick={() => { progressRef.current.favorite = !progressRef.current.favorite; persist(true); setMessage(progressRef.current.favorite ? '已收藏' : '已取消收藏'); }}>{progressRef.current.favorite ? '♥ 已收藏' : '♡ 收藏'}</button></div>
    {message && <p role="status" className="story-message">{message}</p>}
    {finished && <div className="story-finish"><strong>你最喜欢故事里的哪个角色？</strong><button onClick={onBack}>返回故事屋</button></div>}
  </section>;
}

export function StoryLibrary({ data, initialStoryId, onSave, onClose, onOpenStory }: Props) {
  const settings = { ...DEFAULT_STORY_SETTINGS, ...data.settings.storySettings };
  const age = data.settings.childAge ?? 4;
  const progress = data.storyProgress ?? [];
  const stories = visibleStories(settings);
  const recommended = recommendedStories(settings, age, progress);
  const [stage, setStage] = useState<StoryStage | 'all'>('all');
  const [theme, setTheme] = useState<StoryTheme | 'all'>('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [lengthFilter, setLengthFilter] = useState<'all' | 'short' | 'long'>('all');
  const currentStory = STORIES.find(story => story.id === initialStoryId && stories.some(visible => visible.id === story.id));
  const listened = listenedToday(data.storyListenEvents ?? [], localDateKey());
  const limitReached = settings.dailyLimitMinutes > 0 && listened >= settings.dailyLimitMinutes * 60;
  const admitted = useRef(new Set<string>());
  if (currentStory && !limitReached) admitted.current.add(currentStory.id);
  const recent = [...progress].filter(item => item.positionSeconds > 0 && !item.completedAt && stories.some(story => story.id === item.id))
    .sort((a, b) => b.lastListenedAt.localeCompare(a.lastListenedAt))[0];
  const filtered = useMemo(() => stories.filter(story => (stage === 'all' || story.stage === stage)
    && (theme === 'all' || story.themes.includes(theme))
    && (!onlyFavorites || progress.some(item => item.id === story.id && item.favorite))
    && (lengthFilter === 'all' || (lengthFilter === 'short' ? story.durationSeconds <= medianDuration : story.durationSeconds > medianDuration))),
  [stories, stage, theme, onlyFavorites, lengthFilter, progress]);
  const open = (story: Story) => { if (!limitReached) onOpenStory(story.id); };
  const finish = (sessionSeconds: number) => {
    if (!settings.autoplayNext || limitReached || (settings.dailyLimitMinutes > 0 && listened + sessionSeconds >= settings.dailyLimitMinutes * 60)) return;
    const index = stories.findIndex(story => story.id === currentStory?.id);
    const next = stories.slice(index + 1).find(story => story.ageMin <= age && age <= story.ageMax);
    if (next) onOpenStory(next.id);
  };

  if (currentStory && admitted.current.has(currentStory.id)) return <StoryPlayer key={currentStory.id} story={currentStory} progress={progress.find(item => item.id === currentStory.id)} soundEnabled={data.settings.soundEnabled} onSave={onSave} onBack={() => { admitted.current.delete(currentStory.id); onOpenStory(); }} onFinished={finish} />;
  return <section className="story-library">
    <button className="soft-back" onClick={onClose}>← 返回今日</button>
    <span className="eyebrow">乐学故事屋</span><h2>今天听什么故事？</h2>
    {limitReached ? <div className="story-limit" role="status">今天的故事时间到啦，明天再来听吧。</div> : recent && <button className="story-continue" onClick={() => open(stories.find(story => story.id === recent.id)!)}>▶ 继续听《{stories.find(story => story.id === recent.id)?.title}》</button>}
    <h3>适合 {age} 岁的故事</h3><div className="story-featured">{recommended.slice(0, 4).map(story => <button key={story.id} onClick={() => open(story)} disabled={limitReached}><span>{story.icon}</span><strong>{story.title}</strong><small>{formatTime(story.durationSeconds)} · {story.summary}</small></button>)}</div>
    <h3>全部故事 · {filtered.length} 篇</h3>
    <div className="story-filters"><select aria-label="按阶段筛选" value={stage} onChange={event => setStage(event.target.value as StoryStage | 'all')}><option value="all">全部阶段</option>{Object.entries(STORY_STAGES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><select aria-label="按主题筛选" value={theme} onChange={event => setTheme(event.target.value as StoryTheme | 'all')}><option value="all">全部主题</option>{Object.entries(STORY_THEMES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><select aria-label="按时长筛选" value={lengthFilter} onChange={event => setLengthFilter(event.target.value as typeof lengthFilter)}><option value="all">全部时长</option><option value="short">较短</option><option value="long">较长</option></select><button className={onlyFavorites ? 'selected' : ''} onClick={() => setOnlyFavorites(!onlyFavorites)}>♥ 收藏</button></div>
    <div className="story-list">{filtered.map(story => {
      const item = progress.find(entry => entry.id === story.id);
      return <button key={story.id} onClick={() => open(story)} disabled={limitReached}><span>{story.icon}</span><div><strong>{story.title}</strong><small>{formatTime(story.durationSeconds)} · {STORY_STAGES[story.stage]} · {story.themes.map(theme => STORY_THEMES[theme]).join('、')}</small><p>{story.summary}</p></div><b>{item?.completedAt ? '已听完' : item?.positionSeconds ? '继续听' : '去听'}</b></button>;
    })}</div>
  </section>;
}
