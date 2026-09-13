import { describe, expect, it, vi } from 'vitest';
import { generateContent, validateGeneratedContent } from './content-generator.mjs';

const validMath = {
  module: 'math', kind: 'math-choice', title: '5以内加法', subtitle: null, body: null,
  prompt: '2个苹果加1个苹果，一共有几个？', options: ['2', '3', '4'], answer: '3', stage: 1,
  ageMin: 4, ageMax: 5, tags: ['数学', '加法'], url: null,
};

const response = (content, ok = true, status = 200) => ({
  ok, status,
  json: async () => ok ? { choices: [{ message: { content: JSON.stringify(content) } }] } : content,
});

describe('DeepSeek 一句话新增资料', () => {
  it('生成与手工新增一致的 ContentItem 结构', () => {
    const item = validateGeneratedContent(validMath, 123);
    expect(item).toMatchObject({
      id: expect.stringMatching(/^parent-math-123-/), source: 'imported', module: 'math', kind: 'math-choice',
      title: '5以内加法', prompt: validMath.prompt, options: ['2', '3', '4'], answer: '3', stage: 1,
      ageMin: 4, ageMax: 5, tags: ['数学', '加法'],
    });
  });

  it('拒绝不完整内容和不匹配的答案', () => {
    expect(() => validateGeneratedContent({ ...validMath, tags: [] })).toThrow('标签');
    expect(() => validateGeneratedContent({ ...validMath, answer: '5' })).toThrow('正确答案不在选项中');
    expect(() => validateGeneratedContent({ ...validMath, module: 'science' })).toThrow('资料类型与所属模块不匹配');
  });

  it('使用 DeepSeek V4 Flash JSON 输出且密钥只放在服务端请求头', async () => {
    const request = vi.fn().mockResolvedValue(response(validMath));
    const item = await generateContent('增加一道适合5岁的苹果加法题', { DEEPSEEK_API_KEY: 'secret' }, request);
    expect(item.title).toBe('5以内加法');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'deepseek-v4-flash', response_format: { type: 'json_object' }, thinking: { type: 'disabled' },
    });
  });

  it('首次返回不完整时带校验反馈自动重试', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ ...validMath, answer: null }))
      .mockResolvedValueOnce(response(validMath));
    await expect(generateContent('出一道加法题', { DEEPSEEK_API_KEY: 'secret' }, request)).resolves.toMatchObject({ answer: '3' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body).messages[1].content).toContain('缺少题目、选项或答案');
  });

  it('缺少服务端密钥时不访问外网', async () => {
    const request = vi.fn();
    await expect(generateContent('新增资料', {}, request)).rejects.toThrow('DEEPSEEK_API_KEY');
    expect(request).not.toHaveBeenCalled();
  });
});
