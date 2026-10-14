import { useEffect, useRef, useState } from 'react';
import { speak, speakMultilingualSequence, speakSequence, stopSpeech, speechError, DeviceSpeechRequiredError } from '../audio';
import { MODULE_META, type LearningAction, type LearningEvent, type LearningOutcome, type DailyModuleTask } from '../types';
import { TraceCanvas } from './TraceCanvas';
import { NumberLab } from './NumberLab';
import { lessonSpeechRequest } from '../lesson-speech';
import { scienceLesson } from '../science-lesson';

interface Props {
  task: DailyModuleTask;
  soundEnabled: boolean;
  events: LearningEvent[];
  onProgress: (itemId: string, action: LearningAction) => Promise<void>;
  onClose: () => void;
}

export function TaskModal({ task, events, soundEnabled, onProgress, onClose }: Props) {
  const readJob = useRef(0);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [traceReady, setTraceReady] = useState(false);
  const [index, setIndex] = useState(() => {
    const first = task.items.findIndex((item) => !task.doneItemIds.includes(item.id));
    return first < 0 ? 0 : first;
  });
  const [feedback, setFeedback] = useState('');
  const [showLab, setShowLab] = useState(false);
  const [audioStatus, setAudioStatus] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [deviceRead, setDeviceRead] = useState(false);
  const [activeScienceSection, setActiveScienceSection] = useState<number | null>(null);
  const item = task.items[index];
  const isDone = task.doneItemIds.includes(item.id);
  const meta = MODULE_META[task.module];
  const hasLessonAudio = true;
  const [letterUpper = '', letterLower = ''] = item.kind === 'letter' ? item.title.split(/\s+/) : [];
  const letterExample = item.kind === 'letter' ? item.detail?.split('\n').at(-1) : undefined;
  const lessonDetail = item.kind === 'classic'
    ? item.detail?.replace(/^掌握\d+首古诗后解锁\s*/, '')
    : item.detail;
  const poemParts = item.kind === 'poem' ? lessonDetail?.split('\n').filter(Boolean) ?? [] : [];
  const poemAuthor = poemParts[0];
  const poemPhrases = poemParts.slice(1).join('\n').match(/[^，。！？；\n]+[，。！？；]?/g)?.map((phrase) => phrase.trim()).filter(Boolean) ?? [];
  const science = item.kind === 'science' ? scienceLesson(item.title, lessonDetail) : undefined;
  const audioButtonLabel = item.kind === 'math-choice' ? '听题目' : item.kind === 'character'
    ? '听汉字和组词'
    : item.kind === 'letter'
      ? '听字母、例词和中文'
      : item.kind === 'word' || item.kind === 'reader'
        ? '听英语朗读'
        : item.kind === 'poem' || item.kind === 'classic'
          ? '听国学朗读'
          : item.kind === 'science'
            ? '听完整科学讲解'
            : '听内容朗读';

  useEffect(() => {
    readJob.current += 1;
    stopSpeech();
    setAudioStatus('');
    setDeviceRead(false);
    setAudioPlaying(false);
    setActiveScienceSection(null);
    setFeedback('');
    setTraceReady(false);
  }, [item.id]);

  useEffect(() => () => { readJob.current += 1; stopSpeech(); }, []);

  const submit = async (action: LearningAction) => {
    if (savingRef.current || isDone) return;
    savingRef.current = true;
    setSaving(true);
    setFeedback('');
    try {
      await onProgress(item.id, action);
      setFeedback(action.type === 'answer' && action.answer !== item.answer ? '再想一想，或请家长给一点提示。' : '已经记下来啦！');
    } catch (error) {
      setFeedback(error instanceof Error ? `未保存：${error.message}，请再试一次。` : '保存失败，请再试一次。');
    } finally { savingRef.current = false; setSaving(false); }
  };
  const finish = (outcome: Exclude<LearningOutcome, 'unknown'>) => void submit({ type: 'complete', outcome });
  const choose = (option: string) => void submit({ type: 'answer', answer: option });

  const readItem = async () => {
    if (!soundEnabled) {
      setAudioStatus('声音已由家长关闭');
      return;
    }
    const job = ++readJob.current;
    const speechRequest = lessonSpeechRequest(item, lessonDetail);
    setAudioPlaying(true);
    setActiveScienceSection(null);
    setAudioStatus(deviceRead ? '正在启动设备朗读…' : '正在准备在线朗读…');
    const onSegmentChange = (section: number | null) => {
      if (job !== readJob.current) return;
      if (item.kind === 'science') setActiveScienceSection(section);
      if (section !== null) setAudioStatus('正在朗读…');
    };
    try {
      if (speechRequest.multilingualSegments?.length) {
        await speakMultilingualSequence(speechRequest.multilingualSegments, true, speechRequest.pauseMs, onSegmentChange, deviceRead);
      } else if (speechRequest.segments?.length) {
        await speakSequence(speechRequest.segments, true, speechRequest.language, speechRequest.pauseMs, onSegmentChange, deviceRead);
      } else {
        await speak(speechRequest.text, true, speechRequest.language, onSegmentChange, deviceRead);
      }
      if (job === readJob.current) setAudioStatus(deviceRead ? '设备朗读结束；若没有声音，请检查静音开关与媒体音量，或切换在线朗读' : '朗读完成，再点一次可以重听');
    } catch (error) {
      if (job === readJob.current) {
        if (error instanceof DeviceSpeechRequiredError) setDeviceRead(true);
        setAudioStatus(speechError(error));
      }
    } finally {
      if (job === readJob.current) {
        setAudioPlaying(false);
        setActiveScienceSection(null);
      }
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="task-modal" role="dialog" aria-modal="true" aria-label={task.title}>
        <header className="modal-header">
          <button className="icon-button" disabled={saving} onClick={onClose} aria-label="关闭">×</button>
          <div><span>{meta.icon} {meta.title}{item.isReview ? ' · 记忆复习' : ' · 新内容'}</span><strong>{task.title}</strong></div>
          <span className="step-count">{index + 1}/{task.items.length}</span>
        </header>
        <div className="step-dots">{task.items.map((entry, step) => <i key={entry.id} className={task.doneItemIds.includes(entry.id) ? 'done' : step === index ? 'current' : ''} />)}</div>

        {showLab ? <NumberLab soundEnabled={soundEnabled} /> : (
          <main className={`task-content task-${item.kind}`}>
            {item.kind === 'trace' ? <TraceCanvas glyph={item.title} onDone={() => setTraceReady(true)} /> : <>
              <div className={`lesson-visual ${audioPlaying ? 'is-speaking' : ''}`}>
                <span>{item.kind === 'character' || item.kind === 'word' || item.kind === 'letter' ? item.title : meta.icon}</span>
              </div>
              {item.kind === 'letter' ? <div className="letter-read-flow">
                <div><span>大写字母</span><strong>{letterUpper}</strong></div>
                <div><span>小写字母</span><strong>{letterLower}</strong></div>
                <div className="letter-word-step"><span>例词</span><strong>{letterExample}</strong></div>
              </div> : science ? <div className="science-lesson">
                <section className={activeScienceSection === 0 ? 'is-reading' : undefined} aria-current={activeScienceSection === 0 ? 'true' : undefined}><span>科学问题</span><strong>{science.question}</strong></section>
                <section className={activeScienceSection === 1 ? 'is-reading' : undefined} aria-current={activeScienceSection === 1 ? 'true' : undefined}><span>观察方法</span><p>{science.method}</p></section>
                <section className={activeScienceSection === 2 ? 'is-reading' : undefined} aria-current={activeScienceSection === 2 ? 'true' : undefined}><span>观察结果</span><p>{science.result}</p></section>
                <section className={activeScienceSection === 3 ? 'is-reading' : undefined} aria-current={activeScienceSection === 3 ? 'true' : undefined}><span>过程与结果解释</span><p>{science.explanation}</p></section>
              </div> : <>
                <h2>{item.prompt ?? item.title}</h2>
                {item.kind === 'character' && item.exampleWord && <div className="character-word"><span>组词</span><strong>{item.exampleWord}</strong></div>}
                {item.kind === 'poem' && lessonDetail ? <div className="lesson-detail poem-detail">
                  {poemAuthor && <span className="poem-author">{poemAuthor}</span>}
                  <div className="poem-verses">{poemPhrases.map((phrase, phraseIndex) => <span key={`${phrase}-${phraseIndex}`}>{phrase}</span>)}</div>
                </div> : lessonDetail && <div className="lesson-detail">{lessonDetail}</div>}
              </>}
              {hasLessonAudio && <>
                <button className={`lesson-audio-button ${audioPlaying ? 'is-speaking' : ''}`} onClick={() => void readItem()} disabled={audioPlaying}>
                  <span aria-hidden="true">🔊</span>
                  <strong>{audioPlaying ? '正在朗读…' : deviceRead ? '使用设备朗读' : audioButtonLabel}</strong>
                </button>
                <div className="lesson-audio-status" role="status">{audioStatus}</div>
                {!audioPlaying && <button className="text-button" onClick={() => { setDeviceRead(!deviceRead); setAudioStatus(deviceRead ? '已切换在线朗读，请点击上方播放' : '已切换设备朗读，请点击上方播放；无声时请检查静音开关和媒体音量'); }}>{deviceRead ? '切换在线朗读' : '改用设备朗读'}</button>}
              </>}
              {item.options?.length ? <div className="answer-grid">{item.options.map((option) => <button key={option} disabled={saving || isDone} onClick={() => choose(option)}>{option}</button>)}</div> : null}
            </>}
            {isDone ? <div className="learning-assessment"><strong>已经完成 ✓</strong><button className="primary-button" onClick={() => index < task.items.length - 1 ? setIndex(index + 1) : onClose()}>{index < task.items.length - 1 ? '继续下一个 →' : '返回今日学习'}</button></div>
              : !item.options?.length && (item.kind !== 'trace' || traceReady) && <div className="learning-assessment"><strong>这次学得怎么样？</strong><small>家长可以协助记录</small><div className="assessment-options"><button disabled={saving} onClick={() => finish('independent')}>独立完成</button><button disabled={saving} onClick={() => finish('assisted')}>需要提示</button><button disabled={saving} onClick={() => finish('practice')}>还需练习</button></div></div>}
            {events.find(event => event.id === item.id)?.wrongAttempts ? <p className="attempt-note">已经尝试 {events.find(event => event.id === item.id)?.attempts} 次，慢慢来。</p> : null}
            {saving && <p role="status">正在保存…</p>}
          </main>
        )}

        {task.module === 'math' && <button className="lab-toggle" disabled={saving} onClick={() => setShowLab(!showLab)}>{showLab ? '← 回到今日任务' : '🔢 打开数字探索 0–1000'}</button>}
        {feedback && <div className="toast-feedback" role="status">{feedback}</div>}
        <footer className="modal-footer">
          <button disabled={saving || index === 0} onClick={() => setIndex(index - 1)}>← 上一个</button>
          <button disabled={saving || index === task.items.length - 1} onClick={() => setIndex(index + 1)}>下一个 →</button>
        </footer>
      </section>
    </div>
  );
}
