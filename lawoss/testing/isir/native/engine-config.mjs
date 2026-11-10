// LAWOSS v2: synthetic provider of the native ISIR gate in the engine 2.1.4 configuration shape.
// The native definition map (`providers`: `package`, `settings`, `models`) is what the app saves through
// `PATCH /workspace/:id/config` as `opencode.providers` (bootstrap.mjs). The key is not part of it: it goes
// to the engine credential store through `integration/<id>/connect/key`. Reasoning efforts make the engine
// build the `low`/`high` variants, which the gate selects in the native model picker.
// Engine 1.18.29 took `provider`/`npm`/`options.apiKey`/`variants`/`small_model`; 2.1.4 only migrates them.
export const SYNTHETIC_PROVIDER_ID = 'isir-native';
export const SYNTHETIC_MODEL_ID = 'synthetic';

export function syntheticNativeEngineConfig(baseURL) {
  if (typeof baseURL !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/.test(baseURL)) throw new Error('Synthetic provider must be an owned loopback endpoint');
  const providers = {
    [SYNTHETIC_PROVIDER_ID]: {
      package: '@opencode/ai/providers/openai-compatible',
      name: 'ISIR synthetic protocol',
      settings: { baseURL },
      models: {
        [SYNTHETIC_MODEL_ID]: {
          name: 'ISIR synthetic',
          limit: { context: 128000, output: 16000 },
          capabilities: { tools: true, reasoning: { supported: true, effort: ['low', 'high'] } },
        },
      },
    },
  };
  return { config: { model: `${SYNTHETIC_PROVIDER_ID}/${SYNTHETIC_MODEL_ID}`, providers }, providers };
}
