import rawStories from './data/stories.json';
import audioDurations from './data/story-audio.json';
import rawCues from './data/story-cues.json';
import type { Story, StoryProgress, StorySettings, StoryStage, StoryTheme, StoryListenEvent, StoryCue, StoryCueSheet } from './story-types';

export const STORIES: Story[] = rawStories.map(story => ({ ...story, durationSeconds: audioDurations[story.id as keyof typeof audioDurations] } as Story));
export const STORY_STAGES: Record<StoryStage, string> = { kindergarten: '幼儿园', 'primary-lower': '小学低年级', 'primary-upper': '小学高年级' };
export const STORY_THEMES: Record<StoryTheme, string> = {
  bedtime: '睡前', habit: '好习惯', emotion: '情绪', safety: '安全', friendship: '友情',
  fable: '寓言', idiom: '成语', myth: '神话', history: '历史', classic: '名著', science: '科普', growth: '成长'
};
export const DEFAULT_STORY_SETTINGS: StorySettings = {
  enabled: true, dailyLimitMinutes: 20, autoplayNext: false, allowDailyReward: false, hiddenStoryIds: [], hiddenThemes: []
};

export function storyAudioUrl(story: Story): string {
  return `${import.meta.env.BASE_URL}stories/${story.id}-${story.audioVersion}.mp3`;
}

export function storyCues(story: Story): StoryCue[] {
  const sheet = (rawCues as Record<string, StoryCueSheet>)[story.id];
  return sheet?.version === story.audioVersion ? sheet.cues : [];
}

export function activeStoryCue(cues: StoryCue[], time: number): number {
  if (!cues.length) return -1;
  const index = cues.findIndex(cue => time < cue.endSeconds);
  return index < 0 ? cues.length - 1 : index;
}

export function visibleStories(settings: StorySettings): Story[] {
  return STORIES.filter(story => !settings.hiddenStoryIds.includes(story.id)
    && !story.themes.some(theme => settings.hiddenThemes.includes(theme)));
}

export function recommendedStories(settings: StorySettings, age: number, progress: StoryProgress[]): Story[] {
  const completed = new Set(progress.filter(item => item.completedAt).map(item => item.id));
  return visibleStories(settings).filter(story => story.ageMin <= age && age <= story.ageMax)
    .sort((a, b) => Number(completed.has(a.id)) - Number(completed.has(b.id)) || a.id.localeCompare(b.id));
}

export function mergeHeardRange(ranges: Array<[number, number]>, start: number, end: number): Array<[number, number]> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return ranges;
  const ordered = [...ranges, [Math.max(0, start), end] as [number, number]].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ordered) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 0.2) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range] as [number, number]);
  }
  return merged;
}

export function heardCoverage(ranges: Array<[number, number]>, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(1, ranges.reduce((total, [start, end]) => total + Math.max(0, Math.min(end, duration) - Math.max(0, start)), 0) / duration);
}

export function listenedToday(events: StoryListenEvent[], date: string): number {
  return events.filter(event => event.date === date).reduce((sum, event) => sum + event.listenedSeconds, 0);
}
