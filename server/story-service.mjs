import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readJson, sendJson } from './http.mjs';
import { qwenConfiguration, synthesize } from './tts.mjs';

const themes = new Set(['bedtime', 'habit', 'emotion', 'safety', 'friendship', 'fable', 'idiom', 'myth', 'history', 'classic', 'science', 'growth']);
const lengths = new Set([3, 5, 8]);
const unsafe = /色情|性爱|自杀方法|制造炸弹|虐杀|肢解|吸毒|赌博技巧/i;
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const stageForAge = (age) => age <= 6 ? 'kindergarten' : age <= 9 ? 'primary-lower' : 'primary-upper';
const hash = (value, size = 16) => createHash('sha256').update(value).digest('hex').slice(0, size);

export function validateStoryDraft(raw, fallback = {}) {
  const title = clean(raw?.title, 80);
  const summary = clean(raw?.summary, 240);
  const ageMin = Number(raw?.ageMin ?? fallback.age);
  const ageMax = Number(raw?.ageMax ?? fallback.age);
  const paragraphs = Array.isArray(raw?.paragraphs) ? raw.paragraphs.map(value => clean(value, 1800)).filter(Boolean).slice(0, 30) : [];
  const selectedThemes = Array.isArray(raw?.themes) ? [...new Set(raw.themes.filter(value => themes.has(value)))].slice(0, 4) : [];
  const body = paragraphs.join('');
  if (!title || !summary || !Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 3 || ageMax > 12 || ageMin > ageMax) {
    throw Object.assign(new Error('AI 返回的故事基本信息不完整'), { status: 502 });
  }
  if (paragraphs.length < 3 || body.length < 220 || body.length > 6000) throw Object.assign(new Error('AI 返回的故事篇幅不符合要求'), { status: 502 });
  if (unsafe.test(`${title}${summary}${body}`)) throw Object.assign(new Error('故事包含不适合儿童的内容，请更换主题'), { status: 422 });
  return { title, summary, ageMin, ageMax, stage: stageForAge(Math.round((ageMin + ageMax) / 2)), themes: selectedThemes.length ? selectedThemes : [fallback.theme || 'growth'], paragraphs };
}

function storyPrompt({ topic, age, durationMinutes, theme, childName, useChildName }) {
  const target = durationMinutes === 3 ? '500–750' : durationMinutes === 8 ? '1300–1900' : '800–1200';
  return `请创作一篇适合${age}岁儿童、约${durationMinutes}分钟朗读的原创中文故事。主题：${topic}。类型：${theme}。${useChildName ? `可以自然使用孩子昵称“${childName}”，但不要透露其他个人信息。` : '不要使用真实孩子姓名。'}
只输出 JSON：{"title":"","summary":"","ageMin":${Math.max(3, age - 1)},"ageMax":${Math.min(12, age + 1)},"themes":["${theme}"],"paragraphs":[""]}。
正文约${target}个汉字，分成5–12段。内容温暖、有情节、有适龄冲突和自然结尾，不血腥、不恐怖、不危险模仿、不照抄现有作品，不要在正文外解释。`;
}

async function generateStory(input, env, request, signal, onUsage) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error('故事生成尚未配置 DEEPSEEK_API_KEY'), { status: 503 });
  const response = await request('https://api.deepseek.com/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: '你是严谨的儿童故事编辑。只创作原创、适龄、安全的故事，并严格输出要求的 JSON。' },
        { role: 'user', content: storyPrompt(input) },
      ],
      response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0.7, max_tokens: 5000,
    }),
  });
  const data = await response.json().catch(() => ({}));
  onUsage?.(data?.usage);
  if (!response.ok) throw Object.assign(new Error(clean(data?.error?.message, 180) || `DeepSeek 请求失败（${response.status}）`), { status: response.status === 401 ? 503 : 502 });
  try { return validateStoryDraft(JSON.parse(data.choices?.[0]?.message?.content || '{}'), input); }
  catch (error) { if (error.status) throw error; throw Object.assign(new Error('DeepSeek 返回的故事格式不正确'), { status: 502 }); }
}

export function splitStorySentences(paragraph) {
  const result = paragraph.match(/[^。！？!?]+[。！？!?]*(?:[”’」』])?/g) || [paragraph];
  return result.map(value => value.trim()).filter(Boolean);
}

function emotion(text, stage) {
  if (/小心|危险|求助|紧急|不要/.test(text)) return '[serious]';
  if (/害怕|难过|伤心|哭|道歉|失落/.test(text)) return '[empathetic]';
  if (/惊讶|原来|忽然|竟然|发现/.test(text)) return '[amazed]';
  if (/加油|欢呼|高兴|终于|成功|开心|笑/.test(text)) return '[excited]';
  if (/[？?]/.test(text)) return '[curious]';
  return stage === 'kindergarten' ? '[empathetic]' : '';
}

function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${file} 执行失败：${stderr.slice(-500)}`)));
  });
}

const duration = async (path) => Number(await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]));
const validAudio = async (path) => { try { return (await stat(path)).size > 1000 && await duration(path) > 0.2; } catch { return false; } };

function publicStory(row, audioUrl) {
  return {
    id: row.id, title: row.title, summary: row.summary, stage: row.stage,
    ageMin: Number(row.age_min), ageMax: Number(row.age_max), themes: row.themes || [], icon: '✨',
    paragraphs: row.paragraphs, audioVersion: row.audio_version || row.content_version,
    durationSeconds: Number(row.audio_duration_seconds || 0), cues: row.cues || [], audioUrl,
    source: 'family', status: row.status, durationMinutes: Number(row.duration_minutes),
    audioModel: row.audio_model, audioVoice: row.audio_voice, errorMessage: row.error_message,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at,
  };
}

export function createStoryService({ database, identity, usage, audioCache, storage, env = process.env, request = fetch }) {
  const running = new Set();
  const workRoot = env.STORY_WORK_DIR || '/app/data/story-work';

  const assertChild = async (familyId, childId) => {
    const result = await database.query('SELECT id,name,birth_year FROM children WHERE id=$1 AND family_id=$2', [childId, familyId]);
    if (!result.rows[0]) throw Object.assign(new Error('孩子档案不存在'), { status: 404 });
    return result.rows[0];
  };

  const synthesizeSentence = async (text, rate, actor) => {
    const provider = env.TTS_PROVIDER || 'qwen';
    const configuration = provider === 'qwen' ? qwenConfiguration(env, 'zh') : { model: provider, voice: provider };
    const key = audioCache.keyFor({ provider, ...configuration, language: 'zh', text, rate });
    const cached = await audioCache.get(key);
    if (cached) {
      await usage.record(actor, { tts_requests: 1, tts_cache_hits: 1, tts_characters: text.length });
      return { ...cached, ...configuration };
    }
    await usage.assertGlobalBudget('tts');
    const audio = await synthesize(text, 'zh', env, request, AbortSignal.timeout(90_000), { rate, ...configuration });
    await audioCache.put(key, audio);
    await usage.record(actor, { tts_requests: 1, tts_upstream: 1, tts_characters: text.length, tts_upstream_characters: text.length });
    return { ...audio, ...configuration };
  };

  const processAudio = async (storyId) => {
    if (running.has(storyId)) return;
    running.add(storyId);
    let directory;
    try {
      const result = await database.query(`SELECT s.*,j.id job_id,j.device_id,j.requested_by FROM family_stories s
        JOIN story_audio_jobs j ON j.story_id=s.id WHERE s.id=$1 AND j.status IN ('queued','processing')`, [storyId]);
      const story = result.rows[0];
      if (!story) return;
      await database.query("UPDATE story_audio_jobs SET status='processing',updated_at=now() WHERE story_id=$1", [storyId]);
      await database.query("UPDATE family_stories SET status='audio_generating',error_message=NULL,updated_at=now() WHERE id=$1", [storyId]);
      const passages = story.paragraphs.flatMap((paragraph, paragraphIndex) => splitStorySentences(paragraph).map(text => ({ paragraphIndex, text })));
      if (!passages.length || passages.length > 120) throw new Error('故事句子数量不符合音频生成要求');
      await database.query('UPDATE story_audio_jobs SET total_sentences=$2,updated_at=now() WHERE story_id=$1', [storyId, passages.length]);
      directory = join(workRoot, storyId);
      await mkdir(directory, { recursive: true });
      const rate = story.stage === 'kindergarten' ? 0.85 : story.stage === 'primary-lower' ? 0.95 : 1;
      const actor = { type: 'account', familyId: story.family_id, userId: story.requested_by, deviceId: story.device_id || undefined };
      const clips = [];
      let selectedModel; let selectedVoice;
      for (const [index, passage] of passages.entries()) {
        const spoken = emotion(passage.text, story.stage) + passage.text;
        const pipeline = { provider: env.TTS_PROVIDER || 'qwen', model: env.QWEN_TTS_MODEL || 'qwen-audio-3.1-tts-flash', voice: env.QWEN_TTS_VOICE || 'longanhuan_v3.1', rate, spoken };
        const path = join(directory, `${String(index).padStart(3, '0')}-${hash(JSON.stringify(pipeline), 12)}.wav`);
        const metadataPath = `${path}.json`;
        if (!await validAudio(path)) {
          const audio = await synthesizeSentence(spoken, rate, actor);
          if (audio.type !== 'audio/wav' || audio.bytes.length < 1000) throw new Error('语音服务没有返回有效 WAV 音频');
          await writeFile(path, audio.bytes);
          await writeFile(metadataPath, JSON.stringify({ model: audio.model, voice: audio.voice }));
          selectedModel = audio.model; selectedVoice = audio.voice;
        } else {
          try {
            const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
            selectedModel ||= metadata.model; selectedVoice ||= metadata.voice;
          } catch { /* 旧任务片段没有元数据时使用当前默认配置。 */ }
        }
        clips.push({ ...passage, path });
        await database.query('UPDATE story_audio_jobs SET completed_sentences=$2,updated_at=now() WHERE story_id=$1', [storyId, index + 1]);
      }
      const durations = await Promise.all(clips.map(clip => duration(clip.path)));
      let start = 0;
      const cues = clips.map((clip, index) => {
        const cue = { paragraphIndex: clip.paragraphIndex, text: clip.text, startSeconds: Number(start.toFixed(3)), endSeconds: Number((start + durations[index]).toFixed(3)) };
        start += durations[index]; return cue;
      });
      const version = `ai-${hash(JSON.stringify({ paragraphs: story.paragraphs, selectedModel, selectedVoice }), 12)}`;
      const list = join(directory, 'concat.txt');
      await writeFile(list, clips.map(clip => `file '${clip.path.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
      const output = join(directory, `${version}.mp3`);
      await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', output]);
      const total = await duration(output);
      if (!Number.isFinite(total) || Math.abs(total - start) > 0.75) throw new Error('合并后的故事音频时长校验失败');
      const objectKey = storage.familyKey(story.family_id, story.id, version);
      await storage.put(objectKey, output);
      await database.transaction(async client => {
        await client.query(`UPDATE family_stories SET status='ready',audio_version=$2,audio_object_key=$3,audio_duration_seconds=$4,
          audio_model=$5,audio_voice=$6,cues=$7,error_message=NULL,updated_at=now() WHERE id=$1`,
        [storyId, version, objectKey, Math.round(total), selectedModel || qwenConfiguration(env, 'zh').model, selectedVoice || qwenConfiguration(env, 'zh').voice, JSON.stringify(cues)]);
        await client.query("UPDATE story_audio_jobs SET status='completed',completed_sentences=total_sentences,last_error=NULL,updated_at=now() WHERE story_id=$1", [storyId]);
      });
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      const message = clean(error instanceof Error ? error.message : '音频生成失败', 500);
      console.error(`家庭故事 ${storyId} 音频生成失败：`, message);
      await database.query("UPDATE family_stories SET status='failed',error_message=$2,updated_at=now() WHERE id=$1", [storyId, message]).catch(() => undefined);
      await database.query("UPDATE story_audio_jobs SET status='failed',last_error=$2,updated_at=now() WHERE story_id=$1", [storyId, message]).catch(() => undefined);
    } finally { running.delete(storyId); }
  };

  const queue = (storyId) => { setTimeout(() => void processAudio(storyId), 0); };

  const start = async () => {
    if (!database.configured) return;
    const jobs = await database.query("SELECT story_id FROM story_audio_jobs WHERE status IN ('queued','processing') ORDER BY updated_at LIMIT 20");
    for (const row of jobs.rows) queue(row.story_id);
  };

  const handle = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const builtIn = path.match(/^\/api\/stories\/builtin\/([a-z0-9-]+-v\d+\.mp3)$/);
    if (builtIn && ['GET', 'HEAD'].includes(req.method)) {
      const target = storage.urlFor(storage.builtInKey(builtIn[1]));
      if (!target) return sendJson(res, 503, { error: '故事音频存储尚未配置' });
      res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' }); res.end(); return;
    }
    if (!path.startsWith('/api/stories/')) return next();
    try {
      if (!database.configured) throw Object.assign(new Error('家庭故事需要配置 PostgreSQL'), { status: 503 });
      const allowGuest = path === '/api/stories/published';
      const actor = await identity.authenticate(req, { allowGuest });
      if (!actor.familyId) {
        if (allowGuest) return sendJson(res, 200, { stories: [] });
        throw Object.assign(new Error('请先登录家长账号'), { status: 401 });
      }
      if (path === '/api/stories/published' && req.method === 'GET') {
        const childId = clean(url.searchParams.get('childId'), 60);
        await assertChild(actor.familyId, childId);
        const result = await database.query("SELECT * FROM family_stories WHERE family_id=$1 AND child_id=$2 AND status='published' ORDER BY published_at DESC", [actor.familyId, childId]);
        return sendJson(res, 200, { stories: result.rows.map(row => publicStory(row, storage.urlFor(row.audio_object_key))) });
      }
      if (path === '/api/stories/family' && req.method === 'GET') {
        const childId = clean(url.searchParams.get('childId'), 60);
        await assertChild(actor.familyId, childId);
        const result = await database.query("SELECT * FROM family_stories WHERE family_id=$1 AND child_id=$2 AND status<>'archived' ORDER BY updated_at DESC", [actor.familyId, childId]);
        return sendJson(res, 200, { stories: result.rows.map(row => publicStory(row, row.audio_object_key ? storage.urlFor(row.audio_object_key) : undefined)) });
      }
      if (path === '/api/stories/generate' && req.method === 'POST') {
        const body = await readJson(req, 8192);
        const child = await assertChild(actor.familyId, clean(body.childId, 60));
        const topic = clean(body.topic, 200); const age = Number(body.age); const durationMinutes = Number(body.durationMinutes); const theme = clean(body.theme, 30);
        if (!topic || unsafe.test(topic)) throw Object.assign(new Error('请填写适合儿童的故事主题'), { status: 400 });
        if (!Number.isInteger(age) || age < 3 || age > 12 || !lengths.has(durationMinutes) || !themes.has(theme)) throw Object.assign(new Error('故事年龄、长度或类型无效'), { status: 400 });
        const generatedToday = await database.query('SELECT generations FROM story_generation_daily WHERE usage_date=current_date AND family_id=$1', [actor.familyId]);
        if (Number(generatedToday.rows[0]?.generations || 0) >= Number(env.STORY_DAILY_GENERATION_LIMIT || 3)) throw Object.assign(new Error('今天已生成 3 篇故事，明天可以继续创作'), { status: 429 });
        await usage.authorize(req, 'ai'); await usage.assertGlobalBudget('ai');
        let tokens = 0;
        const draft = await generateStory({ topic, age, durationMinutes, theme, childName: child.name, useChildName: body.useChildName === true }, env, request, AbortSignal.timeout(90_000), info => { tokens += Number(info?.total_tokens || 0); });
        await usage.record(actor, { ai_requests: 1, ai_tokens: tokens || Math.ceil(topic.length / 2) });
        await database.query(`INSERT INTO story_generation_daily(usage_date,family_id,generations) VALUES(current_date,$1,1)
          ON CONFLICT(usage_date,family_id) DO UPDATE SET generations=story_generation_daily.generations+1,updated_at=now()`, [actor.familyId]);
        return sendJson(res, 200, { story: { ...draft, durationMinutes } });
      }
      if (path === '/api/stories/family' && req.method === 'POST') {
        const body = await readJson(req, 32 * 1024); const childId = clean(body.childId, 60);
        await assertChild(actor.familyId, childId);
        const count = await database.query("SELECT count(*)::int total FROM family_stories WHERE family_id=$1 AND status<>'archived'", [actor.familyId]);
        if (Number(count.rows[0]?.total || 0) >= Number(env.STORY_FAMILY_LIMIT || 50)) throw Object.assign(new Error('家庭故事数量已达到上限，请先归档旧故事'), { status: 409 });
        const draft = validateStoryDraft(body, { age: body.ageMin, theme: body.themes?.[0] });
        const durationMinutes = lengths.has(Number(body.durationMinutes)) ? Number(body.durationMinutes) : 5;
        const id = randomUUID(); const contentVersion = `text-${hash(JSON.stringify(draft))}`;
        const result = await database.query(`INSERT INTO family_stories(id,family_id,child_id,created_by,title,summary,stage,age_min,age_max,themes,paragraphs,duration_minutes,content_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [id, actor.familyId, childId, actor.userId, draft.title, draft.summary, draft.stage, draft.ageMin, draft.ageMax, draft.themes, JSON.stringify(draft.paragraphs), durationMinutes, contentVersion]);
        return sendJson(res, 201, { story: publicStory(result.rows[0]) });
      }
      const match = path.match(/^\/api\/stories\/family\/([0-9a-f-]{36})(?:\/(audio|publish|unpublish))?$/i);
      if (!match) throw Object.assign(new Error('故事接口不存在'), { status: 404 });
      const storyId = match[1]; const action = match[2];
      const found = await database.query("SELECT * FROM family_stories WHERE id=$1 AND family_id=$2 AND status<>'archived'", [storyId, actor.familyId]);
      const story = found.rows[0]; if (!story) throw Object.assign(new Error('故事不存在'), { status: 404 });
      if (!action && req.method === 'PUT') {
        if (!['draft', 'failed'].includes(story.status)) throw Object.assign(new Error('只有草稿或失败故事可以修改文字'), { status: 409 });
        const body = await readJson(req, 32 * 1024); const draft = validateStoryDraft(body, { age: body.ageMin, theme: body.themes?.[0] });
        const version = `text-${hash(JSON.stringify(draft))}`;
        const result = await database.query(`UPDATE family_stories SET title=$3,summary=$4,stage=$5,age_min=$6,age_max=$7,themes=$8,paragraphs=$9,
          duration_minutes=$10,content_version=$11,status='draft',error_message=NULL,updated_at=now() WHERE id=$1 AND family_id=$2 RETURNING *`,
        [storyId, actor.familyId, draft.title, draft.summary, draft.stage, draft.ageMin, draft.ageMax, draft.themes, JSON.stringify(draft.paragraphs), lengths.has(Number(body.durationMinutes)) ? Number(body.durationMinutes) : story.duration_minutes, version]);
        return sendJson(res, 200, { story: publicStory(result.rows[0]) });
      }
      if (!action && req.method === 'DELETE') {
        await database.query("UPDATE family_stories SET status='archived',updated_at=now() WHERE id=$1", [storyId]);
        if (story.audio_object_key) await storage.remove(story.audio_object_key).catch(() => undefined);
        return sendJson(res, 200, { archived: true });
      }
      if (action === 'audio' && req.method === 'POST') {
        if (!['draft', 'failed', 'ready'].includes(story.status)) throw Object.assign(new Error('故事正在生成音频，请稍后查看'), { status: 409 });
        const activeJob = await database.query("SELECT story_id FROM story_audio_jobs WHERE family_id=$1 AND story_id<>$2 AND status IN ('queued','processing') LIMIT 1", [actor.familyId, storyId]);
        if (activeJob.rows[0]) throw Object.assign(new Error('家庭中已有故事正在配音，请完成后再生成下一篇'), { status: 409 });
        const jobId = randomUUID();
        await database.transaction(async client => {
          await client.query(`INSERT INTO story_audio_jobs(id,story_id,family_id,requested_by,device_id,status,completed_sentences,total_sentences,last_error)
            VALUES($1,$2,$3,$4,$5,'queued',0,0,NULL) ON CONFLICT(story_id) DO UPDATE SET requested_by=EXCLUDED.requested_by,device_id=EXCLUDED.device_id,status='queued',completed_sentences=0,total_sentences=0,last_error=NULL,updated_at=now()`,
          [jobId, storyId, actor.familyId, actor.userId, actor.deviceId]);
          await client.query("UPDATE family_stories SET status='audio_queued',error_message=NULL,updated_at=now() WHERE id=$1", [storyId]);
        });
        queue(storyId); return sendJson(res, 202, { queued: true });
      }
      if (action === 'publish' && req.method === 'POST') {
        if (!story.audio_object_key || !['ready', 'published'].includes(story.status)) throw Object.assign(new Error('请先完成音频生成和试听'), { status: 409 });
        await database.query("UPDATE family_stories SET status='published',published_at=COALESCE(published_at,now()),updated_at=now() WHERE id=$1", [storyId]);
        return sendJson(res, 200, { published: true });
      }
      if (action === 'unpublish' && req.method === 'POST') {
        await database.query("UPDATE family_stories SET status='ready',updated_at=now() WHERE id=$1", [storyId]);
        return sendJson(res, 200, { published: false });
      }
      throw Object.assign(new Error('请求方式不支持'), { status: 405 });
    } catch (error) { sendJson(res, Number(error?.status) || 500, { error: error instanceof Error ? error.message : '故事服务暂时不可用' }); }
  };

  return { handle, start, processAudio };
}
