import type { DailyItem } from './types';
import { scienceLesson, scienceSpeechText } from './science-lesson';

export interface LessonSpeechRequest {
  text: string;
  language: 'auto' | 'zh' | 'en';
  segments?: string[];
  pauseMs?: number;
}

function englishExample(detail?: string): string | undefined {
  const exampleLine = detail?.split('\n').at(-1);
  return exampleLine?.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/)?.[0];
}

export function lessonSpeechRequest(item: DailyItem, lessonDetail?: string): LessonSpeechRequest {
  if (item.kind === 'math-choice') return { text: item.prompt ?? item.title, language: 'zh' };
  if (item.kind === 'letter') {
    const [upper = '', lower = upper.toLowerCase()] = item.title.trim().split(/\s+/);
    const example = englishExample(item.detail);
    const segments = [upper, lower, example].filter((value): value is string => Boolean(value));
    return {
      text: segments.join('. ') + '.',
      language: 'en',
      segments,
      pauseMs: 1000
    };
  }
  if (item.kind === 'character') return { text: `${item.title}。这个字读，${item.title}。`, language: 'auto' };
  if (item.kind === 'science') return {
    text: scienceSpeechText(scienceLesson(item.title, lessonDetail)),
    language: 'zh'
  };
  return { text: `${item.title}。${lessonDetail ?? ''}`, language: 'auto' };
}
