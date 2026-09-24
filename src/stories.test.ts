import { describe, expect, it } from 'vitest';
import drafts from './data/story-drafts.json';
import { activeStoryCue, DEFAULT_STORY_SETTINGS, heardCoverage, listenedToday, mergeHeardRange, recommendedStories, STORIES, storyCues, visibleStories } from './stories';

describe('故事屋', () => {
  it('幼儿园有二十篇，两个小学阶段各有十篇', () => {
    expect(STORIES).toHaveLength(40);
    expect(STORIES.filter(story => story.stage === 'kindergarten')).toHaveLength(20);
    for (const stage of ['primary-lower', 'primary-upper']) expect(STORIES.filter(story => story.stage === stage)).toHaveLength(10);
    for (let age = 3; age <= 12; age++) {
      const expected = age <= 5 ? 20 : age === 6 ? 30 : age === 9 ? 20 : 10;
      expect(recommendedStories(DEFAULT_STORY_SETTINGS, age, [])).toHaveLength(expected);
    }
  });

  it('隐藏主题和单篇故事后不再推荐', () => {
    const settings = { ...DEFAULT_STORY_SETTINGS, hiddenStoryIds: ['tortoise-hare'], hiddenThemes: ['science' as const] };
    const visible = visibleStories(settings);
    expect(visible.some(story => story.id === 'tortoise-hare')).toBe(false);
    expect(visible.some(story => story.themes.includes('science'))).toBe(false);
  });

  it('跳播和重复听同一段不能凑满八成', () => {
    let ranges: Array<[number, number]> = [];
    ranges = mergeHeardRange(ranges, 0, 20);
    ranges = mergeHeardRange(ranges, 0, 20);
    ranges = mergeHeardRange(ranges, 80, 100);
    expect(heardCoverage(ranges, 100)).toBe(.4);
    ranges = mergeHeardRange(ranges, 20, 60);
    expect(heardCoverage(ranges, 100)).toBe(.8);
  });

  it('每日时长只累计当天的有效会话', () => {
    expect(listenedToday([{ id: 'a', storyId: 'a', title: '故事', date: '2026-09-23', startedAt: '', endedAt: '', listenedSeconds: 40, completed: false },
      { id: 'b', storyId: 'a', title: '故事', date: '2026-09-22', startedAt: '', endedAt: '', listenedSeconds: 90, completed: true }], '2026-09-23')).toBe(40);
  });

  it('朗读高亮按真实音频时间点切换，拖动后也能定位', () => {
    const cues = [{ paragraphIndex: 0, text: '第一句。', startSeconds: 0, endSeconds: 2.4 },
      { paragraphIndex: 0, text: '第二句。', startSeconds: 2.4, endSeconds: 5.1 }];
    expect(activeStoryCue(cues, 0)).toBe(0);
    expect(activeStoryCue(cues, 2.39)).toBe(0);
    expect(activeStoryCue(cues, 2.4)).toBe(1);
    expect(activeStoryCue(cues, 5.1)).toBe(1);
    expect(activeStoryCue([], 2)).toBe(-1);
  });

  it('已上线长版的逐句高亮与正文完全一致', () => {
    for (const story of STORIES.filter(item => ['v2', 'v3'].includes(item.audioVersion))) {
      const cues = storyCues(story);
      expect(cues.length).toBeGreaterThan(20);
      expect(cues.map(cue => cue.text).join('')).toBe(story.paragraphs.join(''));
      expect(cues[0].startSeconds).toBe(0);
      expect(Math.abs(cues.at(-1)!.endSeconds - story.durationSeconds)).toBeLessThan(1);
    }
  });

  it('40 篇长版草稿按年龄分层且保留在独立内容文件中', () => {
    expect(drafts).toHaveLength(40);
    for (const story of STORIES) {
      const draft = drafts.find(item => item.id === story.id);
      expect(draft?.title).toBe(story.title);
      const minimum = story.stage === 'kindergarten' ? 850 : story.stage === 'primary-lower' ? 1400 : 2100;
      expect(draft?.length).toBeGreaterThanOrEqual(minimum);
    }
  });
});
