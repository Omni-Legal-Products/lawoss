import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { syntheticNativeEngineConfig } from './engine-config.mjs';

// The engine's own configuration schema (2.1.4) and its effect runtime, as the server package installs them.
const serverModules = new URL('../../../../apps/server/node_modules/', import.meta.url);
const schema = async name => import(new URL(`@opencode/schema/dist/${name}.js`, serverModules).href);
const { Schema } = await import(new URL('effect/dist/index.js', serverModules).href);

test('synthetic provider is a native v2 definition the engine schema decodes strictly, without v1 keys or a key', async () => {
  const { config, providers } = syntheticNativeEngineConfig('http://127.0.0.1:43123/v1');
  assert.deepEqual(Object.keys(config).sort(), ['model', 'providers']);
  assert.equal(config.providers, providers);
  const { Config } = await schema('config');
  const decoded = Schema.decodeUnknownSync(Config.Info)(config, { onExcessProperty: 'error' });
  assert.deepEqual(decoded.model, { providerID: 'isir-native', model: 'synthetic' });
  const provider = providers['isir-native'];
  assert.equal(provider.package, '@opencode/ai/providers/openai-compatible');
  assert.deepEqual(provider.settings, { baseURL: 'http://127.0.0.1:43123/v1' });
  assert.deepEqual(provider.models.synthetic.capabilities.reasoning, { supported: true, effort: ['low', 'high'] });
  const text = JSON.stringify(config);
  for (const v1 of ['"provider"', '"npm"', '"options"', '"apiKey"', '"small_model"', '"tool_call"', '"reasoningEffort"', 'synthetic-local-only']) assert.equal(text.includes(v1), false, `v1 shape ${v1}`);
  assert.throws(() => syntheticNativeEngineConfig('https://example.invalid/v1'), /owned loopback/);
});

test('native driver builds its engine configuration only from the v2 module', async () => {
  const driver = await readFile(new URL('../../../../scripts/test-isir-native.mjs', import.meta.url), 'utf8');
  assert.match(driver, /import \{ syntheticNativeEngineConfig \} from "\.\.\/lawoss\/testing\/isir\/native\/engine-config\.mjs";/);
  assert.match(driver, /configureNativeProvider\(\{[^}]*providerConfig:syntheticEngine\.providers\}\)/);
  for (const v1 of ['OPENCODE_CONFIG_CONTENT:', 'env.OPENCODE_CONFIG_CONTENT', 'small_model', '@ai-sdk/openai-compatible', 'tool_call:', 'reasoningEffort']) assert.equal(driver.includes(v1), false, `driver still sends v1 ${v1}`);
});
