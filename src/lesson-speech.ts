import type { DailyItem } from './types';
import type { SpeechSegment } from './audio';
import { scienceLesson, scienceSpeechText, scienceSpeechSegments } from './science-lesson';

export interface LessonSpeechRequest {
  text: string;
  language: 'auto' | 'zh' | 'en';
  segments?: string[];
  multilingualSegments?: SpeechSegment[];
  pauseMs?: number;
}

function englishExample(detail?: string): { word?: string; translation?: string } {
  const exampleLine = detail?.split('\n').at(-1);
  const [englishPart, chinesePart] = exampleLine?.split('·', 2) ?? [];
  return {
    word: englishPart?.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/)?.[0],
    translation: chinesePart?.trim() || undefined
  };
}

export function lessonSpeechRequest(item: DailyItem, lessonDetail?: string): LessonSpeechRequest {
  if (item.kind === 'math-choice') return { text: item.prompt ?? item.title, language: 'zh' };
  if (item.kind === 'letter') {
    const [upper = '', lower = upper.toLowerCase()] = item.title.trim().split(/\s+/);
    const example = englishExample(item.detail);
    // 大小写字母的名称读音相同。合成时统一传大写形式，
    // 避免单个小写 a / i 被英文模型当作冠词或代词。
    const segments = [upper, upper, example.word].filter((value): value is string => Boolean(value));
    if (example.translation) return {
      text: `${segments.join('. ')}. ${example.translation}。`,
      language: 'auto',
      multilingualSegments: [
        ...segments.map(text => ({ text, language: 'en' as const })),
        { text: example.translation, language: 'zh' as const }
      ],
      pauseMs: 1000
    };
    return {
      text: segments.join('. ') + '.',
      language: 'en',
      segments,
      pauseMs: 1000
    };
  }
  if (item.kind === 'character') return {
    text: `${item.title}。这个字读，${item.title}。${item.exampleWord ? `组词，${item.exampleWord}。` : ''}`,
    language: 'zh'
  };
  if (item.kind === 'word') {
    const translation = lessonDetail?.split('\n').at(-1)?.trim();
    return translation ? {
      text: `${item.title}。${translation}。`, language: 'auto',
      multilingualSegments: [{ text: item.title, language: 'en' }, { text: translation, language: 'zh' }],
      pauseMs: 1000
    } : { text: item.title, language: 'en' };
  }
  if (item.kind === 'science') return {
    text: scienceSpeechText(scienceLesson(item.title, lessonDetail)),
    language: 'zh',
    segments: scienceSpeechSegments(scienceLesson(item.title, lessonDetail))
  };
  return { text: `${item.title}。${lessonDetail ?? ''}`, language: 'auto' };
}
