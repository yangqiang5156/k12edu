import '../server/load-env.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const originals = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'));
const drafts = JSON.parse(await readFile(new URL('../src/data/story-drafts.json', import.meta.url), 'utf8'));
const output = new URL('../.cache/story-production/audit/', import.meta.url);
await mkdir(output, { recursive: true });
const key = process.env.DEEPSEEK_API_KEY?.trim();
if (!key) throw new Error('缺少 DEEPSEEK_API_KEY');
const selected = process.argv.includes('--story') ? process.argv[process.argv.indexOf('--story') + 1] : undefined;
const force = process.argv.includes('--force');
for (const [ordinal, draft] of drafts.entries()) {
  if (selected && selected !== draft.id) continue;
  const source = originals.find(item => item.id === draft.id);
  const file = join(output.pathname, `${draft.id}.json`);
  try {
    const prior = JSON.parse(await readFile(file, 'utf8'));
    if (!force && prior?.issues) { process.stdout.write(`${ordinal + 1}/${drafts.length} ${draft.title} 已审校 ${prior.issues.length}项\n`); continue; }
  } catch { /* 尚未审校 */ }
  const request = () => fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0.1, max_tokens: 1600,
      messages: [
        { role: 'system', content: '你是儿童故事的严谨审校员。只输出JSON对象 {"issues":[{"paragraph":1,"severity":"high","problem":"具体问题","suggestion":"具体改法"}]}。只报告有充分正文证据的重大情节矛盾、事实与传说混淆、明显用词错误、英文夹杂、危险行为误导、重复段落。paragraph为1起始的段落号；最多5项。不要提主观风格或已经标注为小说/神话的虚构设定。没有问题则 issues 为空数组。' },
        { role: 'user', content: `标题：${draft.title}\n原故事主线：${source.paragraphs.join('')}\n扩写稿：\n${draft.paragraphs.map((paragraph, index) => `${index + 1}. ${paragraph}`).join('\n')}` },
      ],
    }), signal: AbortSignal.timeout(90000),
  });
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await request(); break; }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1200));
    }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${draft.id} 审校请求失败：${response.status} ${data.error?.message || ''}`);
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(result.issues)) throw new Error(`${draft.id} 审校结果无效`);
  await writeFile(file, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(`${ordinal + 1}/${drafts.length} ${draft.title} ${result.issues.length}项\n`);
}
