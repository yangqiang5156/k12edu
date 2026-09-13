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
  if (item.kind === 'letter') {
    const upper = item.title.trim().split(/\s+/)[0]?.toUpperCase();
    const example = englishExample(item.detail);
    const exampleSentence = example ? ` ${upper} is for ${example}.` : '';
    return {
      text: `The letter ${upper}. ${upper}. ${upper}.${exampleSentence}`,
      language: 'en'
    };
  }
  if (item.kind === 'character') return { text: `${item.title}。这个字读，${item.title}。`, language: 'auto' };
  return { text: `${item.title}。${lessonDetail ?? ''}`, language: 'auto' };
}
