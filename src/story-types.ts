export type StoryStage = 'kindergarten' | 'primary-lower' | 'primary-upper';
export type StoryTheme = 'bedtime' | 'habit' | 'emotion' | 'safety' | 'friendship' | 'fable' | 'idiom' | 'myth' | 'history' | 'classic' | 'science' | 'growth';

export interface Story {
  id: string;
  title: string;
  summary: string;
  stage: StoryStage;
  ageMin: number;
  ageMax: number;
  themes: StoryTheme[];
  icon: string;
  paragraphs: string[];
  audioVersion: string;
  durationSeconds: number;
}

export interface StoryCue {
  paragraphIndex: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface StoryCueSheet {
  id: string;
  version: string;
  model: string;
  voice: string;
  durationSeconds: number;
  cues: StoryCue[];
}

export interface StoryProgress {
  id: string;
  audioVersion: string;
  positionSeconds: number;
  durationSeconds: number;
  heardRanges: Array<[number, number]>;
  completionCount: number;
  completedAt?: string;
  favorite: boolean;
  lastListenedAt: string;
}

export interface StoryListenEvent {
  id: string;
  storyId: string;
  title: string;
  date: string;
  startedAt: string;
  endedAt: string;
  listenedSeconds: number;
  completed: boolean;
}

export interface StorySettings {
  enabled: boolean;
  dailyLimitMinutes: 0 | 10 | 20 | 30 | 45 | 60;
  autoplayNext: boolean;
  allowDailyReward: boolean;
  hiddenStoryIds: string[];
  hiddenThemes: StoryTheme[];
}
