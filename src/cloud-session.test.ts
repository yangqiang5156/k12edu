import { afterEach, expect, it, vi } from 'vitest';
import { authorizedFetch } from './cloud';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubEnv('MODE', 'production');
  const values = new Map<string, string>([['lexue:device-id', 'test-device']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}
it('朗读取消信号传递到游客会话建立过程', async () => {
  setup();
  const controller = new AbortController();
  const request = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  vi.stubGlobal('fetch', request);
  const job = authorizedFetch('/api/tts', { signal: controller.signal });
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].signal).toBe(controller.signal);
});
it('会话失效后重新建立会话仍接受取消信号', async () => {
  setup(); localStorage.setItem('lexue:access-token', 'expired-test-session');
  const controller = new AbortController();
  const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
  vi.stubGlobal('fetch', request);
  const job = authorizedFetch('/api/tts', { signal: controller.signal });
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  controller.abort(); await rejected;
  expect(request.mock.calls[1][1].signal).toBe(controller.signal);
});
