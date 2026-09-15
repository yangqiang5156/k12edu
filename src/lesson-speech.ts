import type { DailyItem } from './types';

export interface LessonSpeechRequest {
  text: string;
  language: 'auto' | 'zh' | 'en';
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
    return {
      text: [upper, lower, example].filter(Boolean).join('. ') + '.',
      language: 'en'
    };
  }
  if (item.kind === 'character') return { text: `${item.title}。这个字读，${item.title}。`, language: 'auto' };
  return { text: `${item.title}。${lessonDetail ?? ''}`, language: 'auto' };
}
