import { authorizedFetch, currentCloudChildId } from './cloud';
import type { Story, StoryDraft, StoryTheme } from './story-types';

const api = (path: string) => `${import.meta.env.BASE_URL}api/stories${path}`;

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(api(path), init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '故事服务暂时不可用') as Error & { status?: number };
    error.status = response.status; throw error;
  }
  return data as T;
}

export function activeChildId(): string {
  const childId = currentCloudChildId();
  if (!childId) throw new Error('请先在家长中心登录并选择孩子档案');
  return childId;
}

export async function generateStoryDraft(input: { topic: string; age: number; durationMinutes: 3 | 5 | 8; theme: StoryTheme; useChildName: boolean }): Promise<StoryDraft> {
  const childId = activeChildId();
  const result = await json<{ story: Omit<StoryDraft, 'childId'> }>('/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, childId }),
  });
  return { ...result.story, childId };
}

export async function loadFamilyStories(publishedOnly = false): Promise<Story[]> {
  const childId = currentCloudChildId();
  if (!childId) return [];
  const result = await json<{ stories: Story[] }>(`${publishedOnly ? '/published' : '/family'}?childId=${encodeURIComponent(childId)}`);
  return result.stories;
}

export async function saveFamilyStory(draft: StoryDraft): Promise<Story> {
  const path = draft.id ? `/family/${draft.id}` : '/family';
  const result = await json<{ story: Story }>(path, {
    method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  });
  return result.story;
}

export const generateFamilyStoryAudio = (id: string) => json<{ queued: true }>(`/family/${id}/audio`, { method: 'POST' });
export const publishFamilyStory = (id: string) => json<{ published: boolean }>(`/family/${id}/publish`, { method: 'POST' });
export const unpublishFamilyStory = (id: string) => json<{ published: boolean }>(`/family/${id}/unpublish`, { method: 'POST' });
export const archiveFamilyStory = (id: string) => json<{ archived: true }>(`/family/${id}`, { method: 'DELETE' });
