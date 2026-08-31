import { useEffect, useState } from 'react';
import { playOfflineLessonAudio, speak, stopOfflineLessonAudio } from '../audio';
import { MODULE_META, type DailyModuleTask } from '../types';
import { TraceCanvas } from './TraceCanvas';
import { NumberLab } from './NumberLab';

interface Props {
  task: DailyModuleTask;
  soundEnabled: boolean;
  onProgress: (itemId: string) => void;
  onClose: () => void;
}

export function TaskModal({ task, soundEnabled, onProgress, onClose }: Props) {
  const [index, setIndex] = useState(() => {
    const first = task.items.findIndex((item) => !task.doneItemIds.includes(item.id));
    return first < 0 ? 0 : first;
  });
  const [feedback, setFeedback] = useState('');
  const [showLab, setShowLab] = useState(false);
  const [audioStatus, setAudioStatus] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const item = task.items[index];
  const isDone = task.doneItemIds.includes(item.id);
  const meta = MODULE_META[task.module];
  const hasLessonAudio = task.module !== 'math';
  const [letterUpper = '', letterLower = ''] = item.kind === 'letter' ? item.title.split(/\s+/) : [];
  const letterExample = item.kind === 'letter' ? item.detail?.split('\n').at(-1) : undefined;
  const lessonDetail = item.kind === 'classic'
    ? item.detail?.replace(/^掌握\d+首古诗后解锁\s*/, '')
    : item.detail;
  const poemParts = item.kind === 'poem' ? lessonDetail?.split('\n').filter(Boolean) ?? [] : [];
  const poemAuthor = poemParts[0];
  const poemPhrases = poemParts.slice(1).join('\n').match(/[^，。！？；\n]+[，。！？；]?/g)?.map((phrase) => phrase.trim()).filter(Boolean) ?? [];
  const audioButtonLabel = item.kind === 'character'
    ? '听汉字朗读'
    : item.kind === 'letter'
      ? '听字母和例词'
      : item.kind === 'word' || item.kind === 'reader'
        ? '听英语朗读'
        : item.kind === 'poem' || item.kind === 'classic'
          ? '听国学朗读'
          : '听内容朗读';

  useEffect(() => {
    stopOfflineLessonAudio();
    setAudioStatus('');
    setAudioPlaying(false);
  }, [item.id]);

  useEffect(() => stopOfflineLessonAudio, []);

  const finish = () => {
    if (!isDone) onProgress(item.id);
    setFeedback('完成啦，真棒！');
    window.setTimeout(() => {
      setFeedback('');
      if (index < task.items.length - 1) setIndex(index + 1);
    }, 500);
  };

  const choose = (option: string) => {
    if (option === item.answer) {
      setFeedback('答对啦！⭐');
      finish();
    } else {
      setFeedback('再想一想，你可以的～');
    }
  };

  const readItem = async () => {
    if (!soundEnabled) {
      setAudioStatus('声音已由家长关闭');
      return;
    }
    if (item.kind === 'character' && /^char-\d+$/.test(item.contentId)) {
      setAudioPlaying(true);
      setAudioStatus('正在朗读…');
      try {
        await playOfflineLessonAudio(`audio/literacy/${item.contentId}.mp3`, true);
        setAudioStatus('朗读完成，再点汉字可以重听');
      } catch {
        setAudioStatus('语音加载失败，请刷新应用后再试');
      } finally {
        setAudioPlaying(false);
      }
      return;
    }
    if (item.kind === 'letter' && /^letter-[a-z]$/.test(item.contentId)) {
      setAudioPlaying(true);
      setAudioStatus('正在朗读字母和例词…');
      try {
        await playOfflineLessonAudio(`audio/english/${item.contentId}.mp3`, true);
        setAudioStatus('朗读完成，再点字母可以重听');
      } catch {
        setAudioStatus('语音加载失败，请刷新应用后再试');
      } finally {
        setAudioPlaying(false);
      }
      return;
    }
    if ((item.kind === 'poem' || item.kind === 'classic') && /^(poem|classic)-\d+$/.test(item.contentId)) {
      setAudioPlaying(true);
      setAudioStatus('正在有节奏地朗读标题和正文…');
      try {
        const audioFile = item.kind === 'classic' ? `${item.contentId}-clean-v2.mp3` : `${item.contentId}.mp3`;
        await playOfflineLessonAudio(`audio/guoxue/${audioFile}`, true);
        setAudioStatus('朗读完成，再点一次可以重听');
      } catch {
        setAudioStatus('语音加载失败，请刷新应用后再试');
      } finally {
        setAudioPlaying(false);
      }
      return;
    }
    const text = item.kind === 'word' ? `${item.title}, ${lessonDetail ?? ''}` : `${item.title}。${lessonDetail ?? ''}`;
    speak(text, soundEnabled, item.kind === 'word' || item.kind === 'reader' ? 'en-US' : 'zh-CN');
    setAudioStatus('已调用设备朗读');
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="task-modal" role="dialog" aria-modal="true" aria-label={task.title}>
        <header className="modal-header">
          <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
          <div><span>{meta.icon} {meta.title}</span><strong>{task.title}</strong></div>
          <span className="step-count">{index + 1}/{task.items.length}</span>
        </header>
        <div className="step-dots">{task.items.map((entry, step) => <i key={entry.id} className={task.doneItemIds.includes(entry.id) ? 'done' : step === index ? 'current' : ''} />)}</div>

        {showLab ? <NumberLab soundEnabled={soundEnabled} /> : (
          <main className={`task-content task-${item.kind}`}>
            {item.kind === 'trace' ? <TraceCanvas glyph={item.title} onDone={finish} /> : <>
              <div className={`lesson-visual ${audioPlaying ? 'is-speaking' : ''}`}>
                <span>{item.kind === 'character' || item.kind === 'word' || item.kind === 'letter' ? item.title : meta.icon}</span>
              </div>
              {item.kind === 'letter' ? <div className="letter-read-flow">
                <div><span>大写字母</span><strong>{letterUpper}</strong></div>
                <div><span>小写字母</span><strong>{letterLower}</strong></div>
                <div className="letter-word-step"><span>例词</span><strong>{letterExample}</strong></div>
              </div> : <>
                <h2>{item.prompt ?? item.title}</h2>
                {item.kind === 'poem' && lessonDetail ? <div className="lesson-detail poem-detail">
                  {poemAuthor && <span className="poem-author">{poemAuthor}</span>}
                  <div className="poem-verses">{poemPhrases.map((phrase, phraseIndex) => <span key={`${phrase}-${phraseIndex}`}>{phrase}</span>)}</div>
                </div> : lessonDetail && <div className="lesson-detail">{lessonDetail}</div>}
              </>}
              {hasLessonAudio && <>
                <button className={`lesson-audio-button ${audioPlaying ? 'is-speaking' : ''}`} onClick={() => void readItem()} disabled={audioPlaying}>
                  <span aria-hidden="true">🔊</span>
                  <strong>{audioPlaying ? '正在朗读…' : audioButtonLabel}</strong>
                </button>
                <div className="lesson-audio-status" role="status">{audioStatus}</div>
              </>}
              {item.options?.length ? <div className="answer-grid">{item.options.map((option) => <button key={option} onClick={() => choose(option)}>{option}</button>)}</div> : <button className="primary-button finish-button" onClick={finish}>{isDone ? '已经完成 ✓' : item.kind === 'reader' ? '朗读完成' : '我学会啦'}</button>}
            </>}
          </main>
        )}

        {task.module === 'math' && <button className="lab-toggle" onClick={() => setShowLab(!showLab)}>{showLab ? '← 回到今日任务' : '🔢 打开数字探索 0–1000'}</button>}
        {feedback && <div className="toast-feedback" role="status">{feedback}</div>}
        <footer className="modal-footer">
          <button disabled={index === 0} onClick={() => setIndex(index - 1)}>← 上一个</button>
          <button disabled={index === task.items.length - 1} onClick={() => setIndex(index + 1)}>下一个 →</button>
        </footer>
      </section>
    </div>
  );
}
