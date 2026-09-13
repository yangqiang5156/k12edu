import { normalizeContentItem } from './content-library';
import type { ContentItem } from './types';

export async function generateContentFromPrompt(prompt: string, signal?: AbortSignal): Promise<ContentItem> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/content/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '智能生成暂时不可用，请稍后再试');
  if (!data.item) throw new Error('智能生成没有返回资料内容');
  return normalizeContentItem(data.item as ContentItem);
}
