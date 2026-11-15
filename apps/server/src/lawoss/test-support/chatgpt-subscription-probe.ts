import type { OpenCode } from '@opencode/client';

type Client = ReturnType<typeof OpenCode.make>;
export class SubscriptionProbeError extends Error {
  constructor(readonly code: 'device_unavailable' | 'invalid_challenge' | 'auth_timeout' | 'auth_failed' | 'not_subscription' | 'model_unavailable' | 'unexpected_reply') {
    super(code);
  }
}

/** Native SDK only. No API-key fallback, credential import, token export or provider proxy. */
export async function authenticateSubscription(input: {
  client: Client; directory: string; signal: AbortSignal;
  publish: (value: { url: string; code: string; expiresAt: number }) => Promise<void>;
}) {
  const location = { directory: input.directory };
  const integrations = (await input.client.integration.list({ location }, { signal: input.signal })).data;
  const openai = integrations.find(item => item.id === 'openai');
  if (openai?.connections.length) throw new SubscriptionProbeError('not_subscription');
  const method = openai?.methods.find(item => item.type === 'oauth' && item.id === 'chatgpt-headless');
  if (!method || !('id' in method)) throw new SubscriptionProbeError('device_unavailable');
  const attempt = (await input.client.integration.oauth.connect({ integrationID: 'openai', methodID: method.id, location }, { signal: input.signal })).data;
  let completed = false;
  try {
    const code = /^Enter code: ([A-Za-z0-9-]{4,32})$/.exec(attempt.instructions)?.[1];
    if (attempt.mode !== 'auto' || attempt.url !== 'https://auth.openai.com/codex/device' || !code) throw new SubscriptionProbeError('invalid_challenge');
    const expiresAt = Math.min(attempt.time.expires, Date.now() + 10 * 60_000);
    await input.publish({ url: attempt.url, code, expiresAt });
    while (Date.now() < expiresAt) {
      input.signal.throwIfAborted();
      const status = (await input.client.integration.oauth.status({ integrationID: 'openai', attemptID: attempt.attemptID, location }, { signal: input.signal })).data;
      if (status.status === 'complete') { completed = true; break; }
      if (status.status !== 'pending') throw new SubscriptionProbeError('auth_failed');
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(input.signal.reason); };
        const timer = setTimeout(() => { input.signal.removeEventListener('abort', abort); resolve(); }, 2000);
        input.signal.addEventListener('abort', abort, { once: true });
        if (input.signal.aborted) { input.signal.removeEventListener('abort', abort); abort(); }
      });
    }
    if (!completed) throw new SubscriptionProbeError('auth_timeout');
  } finally {
    if (!completed) await input.client.integration.oauth.cancel({ integrationID: 'openai', attemptID: attempt.attemptID, location }, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}

export async function verifySubscription(input: { client: Client; directory: string; model: string; signal: AbortSignal }) {
  const location = { directory: input.directory };
  const integration = (await input.client.integration.list({ location }, { signal: input.signal })).data.find(item => item.id === 'openai');
  const connection = integration?.connections[0];
  if (!connection || !('method' in connection) || connection.method !== 'oauth') throw new SubscriptionProbeError('not_subscription');
  const models = (await input.client.model.list({ location }, { signal: input.signal })).data;
  if (!models.some(model => model.providerID === 'openai' && model.id === input.model)) throw new SubscriptionProbeError('model_unavailable');
  const session = await input.client.session.create({ location, title: 'Synthetic subscription probe', agent: 'subscription-probe', model: { providerID: 'openai', id: input.model } }, { signal: input.signal });
  const response = await input.client.session.generate({ sessionID: session.id, prompt: 'Reply with exactly CHATGPT_SUBSCRIPTION_OK. No explanation, tools or files.' }, { signal: input.signal });
  if (response.text.trim() !== 'CHATGPT_SUBSCRIPTION_OK') throw new SubscriptionProbeError('unexpected_reply');
}
