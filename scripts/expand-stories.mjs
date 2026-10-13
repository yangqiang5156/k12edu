import '../server/load-env.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const source = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
const output = new URL('../.cache/story-production/expanded/', import.meta.url);
await mkdir(output, { recursive: true });
const selected = process.argv.includes('--story') ? process.argv[process.argv.indexOf('--story') + 1] : undefined;
const targets = {
  kindergarten: { min: 850, target: 1050, max: 1450, paragraphs: '10到14', parts: 1 },
  'primary-lower': { min: 1400, target: 2050, max: 2600, paragraphs: '5到8', parts: 3 },
  'primary-upper': { min: 2100, target: 3100, max: 3900, paragraphs: '5到8', parts: 4 },
};
const key = process.env.DEEPSEEK_API_KEY?.trim();
if (!key) throw new Error('缺少 DEEPSEEK_API_KEY');
const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash';

async function expandPart(story, part, previous, feedback = '') {
  const spec = targets[story.stage];
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0.55, max_tokens: 6500,
      messages: [
        { role: 'system', content: `你是严谨的中文儿童故事编辑。只输出JSON对象，格式为{"paragraphs":["...", "..."]}。将用户提供的简短故事扩写成适合独立朗读的原创改写稿。保持原故事人物、主线、结局和教育重点，不复制受版权保护的具体表述；不编造可核查的历史事实，不将神话或小说说成史实。语言自然，有动作、对话、场景和情绪变化，但不说教、不恐吓、不加入危险操作细节。不要标题、舞台提示、情绪标签、Markdown或括号旁白。每段两到四句话，句子不要过长，适合听读。` },
        { role: 'user', content: `故事：${story.title}\n适龄：${story.ageMin}—${story.ageMax}岁\n原有正文：${story.paragraphs.join('\n')}\n总共分${spec.parts}部分，本次只写第${part + 1}部分，约${Math.round(spec.target / spec.parts)}个汉字与标点，共${spec.paragraphs}个自然段。${part === 0 ? '本部分介绍人物、背景和起因。' : part === spec.parts - 1 ? '本部分推进至结局，必须保留原有结尾含义。' : '本部分延续情节，写清转折与人物选择，但不要提前写结局。'}${previous.length ? `上文最后两段：${previous.slice(-2).join('\n')}。请顺接，不要重复。` : ''}${feedback ? `上次校验失败：${feedback}；请完整重写本部分。` : ''} 输出JSON。` },
      ],
    }), signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${story.id}: DeepSeek ${response.status} ${data.error?.message || ''}`);
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error(`${story.id}: 生成内容被截断`);
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(result.paragraphs) || !result.paragraphs.every(p => typeof p === 'string' && p.trim().length >= 30)) throw new Error(`${story.id}: 段落无效`);
  const paragraphs = result.paragraphs.map(p => p.trim());
  const length = paragraphs.join('').length;
  if (length < Math.floor(spec.min / spec.parts * .8) || length > Math.ceil(spec.max / spec.parts)) throw new Error(`${story.id} 第${part + 1}部分：字数 ${length} 不在范围`);
  if (paragraphs.some(p => /\[(?:sad|excited|curious|empathetic|serious)\]/i.test(p))) throw new Error(`${story.id}: 正文包含语音标签`);
  return paragraphs;
}

for (const [index, story] of source.entries()) {
  if (selected && selected !== story.id) continue;
  const file = join(output.pathname, `${story.id}.json`);
  try {
    const prior = JSON.parse(await readFile(file, 'utf8'));
    if (prior.paragraphs?.length && prior.length >= targets[story.stage].min) { process.stdout.write(`${index + 1}/${source.length} ${story.title} 已有草稿 ${prior.length}字\n`); continue; }
  } catch { /* 尚无有效草稿 */ }
  const spec = targets[story.stage];
  const paragraphs = [];
  for (let part = 0; part < spec.parts; part++) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        paragraphs.push(...await expandPart(story, part, paragraphs, lastError?.message || ''));
        lastError = undefined; break;
      } catch (error) { lastError = error; process.stderr.write(`${story.id} 第${part + 1}部分第${attempt + 1}次：${error.message}\n`); }
    }
    if (lastError) throw lastError;
  }
  const result = { paragraphs, length: paragraphs.join('').length, model, generatedAt: new Date().toISOString() };
  if (result.length < spec.min || result.length > spec.max) throw new Error(`${story.id}: 全文 ${result.length} 字，不在 ${spec.min}—${spec.max} 范围`);
  await writeFile(file, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(`${index + 1}/${source.length} ${story.title} ${result.length}字\n`);
}

if (!selected) {
  const drafts = await Promise.all(source.map(async story => {
    const draft = JSON.parse(await readFile(join(output.pathname, `${story.id}.json`), 'utf8'));
    if (!Array.isArray(draft.paragraphs) || draft.length !== draft.paragraphs.join('').length) throw new Error(`${story.id} 草稿校验失败`);
    return { id: story.id, title: story.title, stage: story.stage, ...draft };
  }));
  await writeFile(new URL('../src/data/story-drafts.json', import.meta.url), JSON.stringify(drafts, null, 2) + '\n');
  process.stdout.write(`已汇总 ${drafts.length} 篇扩写稿到 src/data/story-drafts.json\n`);
}
