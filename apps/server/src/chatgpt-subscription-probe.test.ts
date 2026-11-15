import { afterEach, expect, test } from 'bun:test';
import { OpenCode } from '@opencode/client';
import { authenticateSubscription, verifySubscription } from './lawoss/test-support/chatgpt-subscription-probe.js';

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });

function fixture(options: { method?: string; connected?: string; status?: string; url?: string; instructions?: string; expired?: boolean; models?: string[]; answer?: string } = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const location = { directory: '/synthetic', projectID: 'synthetic' };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body: unknown = request.method === 'POST' ? await request.json() : undefined;
    calls.push({ method: request.method, path, body });
    if (path === '/api/integration') return Response.json({ location, data: [{ id: 'openai', name: 'OpenAI',
      connections: options.connected ? [{ id: 'synthetic', type: 'credential', method: options.connected }] : [],
      methods: [{ type: 'oauth', id: options.method ?? 'chatgpt-headless', label: 'Device sign-in' }, { type: 'key', label: 'API key' }] }] });
    if (path === '/api/integration/openai/connect/oauth' && request.method === 'POST') return Response.json({ location, data: {
      attemptID: 'attempt_synthetic', mode: 'auto', url: options.url ?? 'https://auth.openai.com/codex/device',
      instructions: options.instructions ?? 'Enter code: ABCD-EFGH', time: { created: Date.now(), expires: options.expired ? 0 : Date.now() + 60_000 },
    } });
    if (path === '/api/integration/openai/connect/oauth/attempt_synthetic') {
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ location, data: { status: options.status ?? 'complete', time: { created: 1, expires: Date.now() + 60_000 } } });
    }
    if (path === '/api/model') return Response.json({ location, data: (options.models ?? ['gpt-6-luna']).map(id => ({ providerID: 'openai', id })) });
    if (path === '/api/session' && request.method === 'POST') return Response.json({ data: { id: 'ses_synthetic' } });
    if (path === '/api/session/ses_synthetic/generate') return Response.json({ data: { text: options.answer ?? 'CHATGPT_SUBSCRIPTION_OK' } });
    return new Response(null, { status: 500 });
  } });
  stops.push(() => { server.stop(true); });
  return { calls, client: OpenCode.make({ baseUrl: server.url.origin }), directory: location.directory, signal: AbortSignal.timeout(5000) };
}

test('selects the exact native device method and completes only its attempt without a key connection', async () => {
  const probe = fixture();
  let published: unknown;
  await authenticateSubscription({ ...probe, publish: async value => { published = value; } });
  expect(published).toMatchObject({ url: 'https://auth.openai.com/codex/device', code: 'ABCD-EFGH' });
  expect(probe.calls.find(call => call.path.endsWith('/connect/oauth'))?.body).toMatchObject({ methodID: 'chatgpt-headless' });
  expect(probe.calls.some(call => call.path.includes('/connect/key') || call.method === 'DELETE')).toBe(false);
});

test.each(['chatgpt-browser', 'external-method'])('does not substitute %s for the device method', async method => {
  const probe = fixture({ method });
  await expect(authenticateSubscription({ ...probe, publish: async () => {} })).rejects.toThrow('device_unavailable');
  expect(probe.calls.every(call => call.method === 'GET')).toBe(true);
});

test.each(['key', 'env', 'oauth'])('fresh login refuses an existing %s connection', async connected => {
  const probe = fixture({ connected });
  await expect(authenticateSubscription({ ...probe, publish: async () => {} })).rejects.toThrow('not_subscription');
  expect(probe.calls.every(call => call.method === 'GET')).toBe(true);
});

test.each([
  { url: 'https://auth.openai.com.evil.invalid/codex/device' },
  { url: 'https://auth.openai.com/codex/device?token=synthetic' },
  { instructions: 'Enter code: ABCD-EFGH\nunsafe suffix' },
])('rejects an unexpected device challenge and cancels its native attempt', async options => {
  const probe = fixture(options);
  let published = false;
  await expect(authenticateSubscription({ ...probe, publish: async () => { published = true; } })).rejects.toThrow('invalid_challenge');
  expect(published).toBe(false);
  expect(probe.calls.at(-1)?.method).toBe('DELETE');
});

test('expiry cancels the native attempt and never generates', async () => {
  const probe = fixture({ expired: true });
  await expect(authenticateSubscription({ ...probe, publish: async () => {} })).rejects.toThrow('auth_timeout');
  expect(probe.calls.at(-1)?.method).toBe('DELETE');
  expect(probe.calls.some(call => call.path.includes('/session'))).toBe(false);
});

test('failed secure publication cancels login rather than exposing the code in another channel', async () => {
  const probe = fixture();
  await expect(authenticateSubscription({ ...probe, publish: async () => { throw new Error('synthetic publication failure'); } })).rejects.toThrow('synthetic publication failure');
  expect(probe.calls.at(-1)?.method).toBe('DELETE');
});

test('operator cancellation cancels the same attempt and sends no model prompt', async () => {
  const probe = fixture({ status: 'pending' });
  const controller = new AbortController();
  await expect(authenticateSubscription({ ...probe, signal: controller.signal, publish: async () => { controller.abort(new Error('synthetic cancellation')); } })).rejects.toThrow();
  expect(probe.calls.at(-1)?.method).toBe('DELETE');
  expect(probe.calls.some(call => call.path.includes('/session'))).toBe(false);
});

test('only an active OAuth connection and the exact requested model can generate', async () => {
  const probe = fixture({ connected: 'oauth' });
  await verifySubscription({ ...probe, model: 'gpt-6-luna' });
  expect(probe.calls.find(call => call.path === '/api/session')?.body).toMatchObject({ agent: 'subscription-probe', title: 'Synthetic subscription probe', model: { providerID: 'openai', id: 'gpt-6-luna' } });
  expect(probe.calls.filter(call => call.path.endsWith('/generate'))).toHaveLength(1);
});

test('the selected GPT-6.1 Sol reaches session creation without an alias or substitution', async () => {
  const probe = fixture({ connected: 'oauth', models: ['gpt-6.1-sol'] });
  await verifySubscription({ ...probe, model: 'gpt-6.1-sol' });
  expect(probe.calls.find(call => call.path === '/api/session')?.body).toMatchObject({ model: { providerID: 'openai', id: 'gpt-6.1-sol' } });
});

test.each(['key', 'env'])('does not generate with a %s connection even if a model is listed', async connected => {
  const probe = fixture({ connected });
  await expect(verifySubscription({ ...probe, model: 'gpt-6-luna' })).rejects.toThrow('not_subscription');
  expect(probe.calls).toHaveLength(1);
});

test('does not replace an unavailable model or treat an arbitrary answer as a pass', async () => {
  const unavailable = fixture({ connected: 'oauth', models: ['gpt-5.6-luna'] });
  await expect(verifySubscription({ ...unavailable, model: 'gpt-6-luna' })).rejects.toThrow('model_unavailable');
  expect(unavailable.calls.some(call => call.path.includes('/session'))).toBe(false);
  const failed = fixture({ connected: 'oauth', answer: 'I could not complete the request.' });
  await expect(verifySubscription({ ...failed, model: 'gpt-6-luna' })).rejects.toThrow('unexpected_reply');
});
