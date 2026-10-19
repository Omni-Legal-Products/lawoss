import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {test} from "node:test";
import vm from "node:vm";
import {createNativeProtectedApprover, nativeReviewSnapshotExpression, validateSyntheticReview} from "./protected-approvals.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const source = {id: "00000000-0000-4000-8000-000000000001", hash: "a".repeat(64), text: "SYNTHETIC-CONTROLLED-SOURCE", path: "Dokumenty/source.pdf"};
const expected = {workspaceId: "ws_native_1", hostDirectory: "/owned/cases/case-01", endpoint: "http://127.0.0.1:12345/v1/chat/completions", providerId: "isir-native", modelId: "synthetic", apiKey: "synthetic-local-only", sources: [source]};
const scope = {workspaceId: expected.workspaceId, matterId: "synthetic:00000000-0000-4000-8000-000000000002", jurisdictions: ["CZ", "SK"]};
const capture = detail => ({detail, contextElements: 0, remoteElements: 0, scripts: 0, bridge: false, csp: "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'", protocol: "data:", title: "Review request", ready: true, denyFocused: true});
const initial = `Source: Host\nWorkspace: ${expected.workspaceId}\nAction: ai.documents.synthetic\nPublic/synthetic test only → ${expected.endpoint}; generated-content legal approval: false\nClassify all selected prepared content as public/synthetic test material only.\nLegal approval of generated content: false\nProject: ${expected.hostDirectory}\nScope: ${JSON.stringify(scope)}\nTarget: ${expected.endpoint}\n\nSelected source ${source.id}, SHA-256 ${source.hash}:\n${source.text}`;

test("known wholly synthetic initial source review verifies complete exact text, source hashes and owning native scope", () => {
  const result = validateSyntheticReview(capture(initial), expected);
  assert.equal(result.action, "ai.documents.synthetic"); assert.equal(result.bytes, Buffer.byteLength(initial)); assert.equal(result.contextHash, hash(initial));
});

test("unrelated scopes, truncated bodies, private targets, live HTML and real-profile actions are never classified automatically", () => {
  for (const detail of [initial.replace(expected.workspaceId, "foreign"), initial.replace(source.hash, "b".repeat(64)), initial.replace(source.text, "TRUNCATED"), initial.replaceAll(expected.endpoint, "https://external.example/v1/chat/completions"), initial.replace("ai.documents.synthetic", "ai.documents.protected")])
    assert.throws(() => validateSyntheticReview(capture(detail), expected));
  for (const mutation of [{contextElements: 1}, {remoteElements: 1}, {bridge: true}, {scripts: 1}, {denyFocused: false}]) assert.throws(() => validateSyntheticReview({...capture(initial), ...mutation}, expected));
});

test("complete final-wire review binds actual body hash, exact synthetic target/account and selected prompt canaries", () => {
  const body = JSON.stringify({model: "synthetic", messages: [{role: "system", content: "Fixed isolated guest instructions"}, {role: "user", content: `Prepare a source registry CSV and factual summary Markdown in English.\nSelected sources (JSON): ${JSON.stringify([{id: source.id, hash: source.hash, path: source.path}])}`}], tools: [{type: "function", function: {name: "lawoss_documents_read", parameters: {}}}]});
  const target = hash(JSON.stringify({endpoint: expected.endpoint, providerId: expected.providerId, modelId: expected.modelId, account: hash(expected.apiKey)}));
  const binding = {scope, bodyHash: hash(body), target, profiles: [], synthetic: true};
  const wire = `Source: Host\nWorkspace: ${expected.workspaceId}\nAction: ai.protected.synthetic\nSynthetic experiment; legal approval: false → ${expected.endpoint} — isir-native/synthetic\nCurrent scope, model account identity, policy, protected runtime and legal-profile evidence (synthetic experiments provide no legal approval):\n${JSON.stringify(binding, null, 2)}\n\nComplete serialized provider context (including system instructions and tool results):\n${body}`;
  assert.equal(validateSyntheticReview(capture(wire), expected).action, "ai.protected.synthetic");
  for (const detail of [wire.replace(hash(body), "b".repeat(64)), wire.replace(target, "c".repeat(64)), wire.replace('"synthetic": true', '"synthetic": false'), wire.replace("lawoss_documents_read", "legalwork_shell")]) assert.throws(() => validateSyntheticReview(capture(detail), expected));
});

test("the actual renderer expression reads the native inert complete context and exact workspace ID", () => {
  const rect = () => ({x: 10, y: 20, width: 100, height: 40});
  const elements = {context: {textContent: initial, childElementCount: 0}, allow: {disabled: false, getBoundingClientRect: rect}, deny: {disabled: false, getBoundingClientRect: rect}};
  const document = {getElementById: id => elements[id], activeElement: elements.deny, querySelectorAll: () => [], scripts: [], title: "Review request", querySelector: () => ({content: capture(initial).csp})};
  const actual = vm.runInNewContext(nativeReviewSnapshotExpression,{document, window: {}, location: {protocol: "data:"}});
  assert.equal(actual.workspace,expected.workspaceId);
  assert.equal(actual.detail,initial);
  assert.equal(validateSyntheticReview(actual,expected).contextHash,hash(initial));
});

test("external corpora, unrelated profiles and nonliteral provider targets cannot activate automatic native clicks", () => {
  const base = {mode: "synthetic", root: "/owned", profile: "/owned/profile", cdpOrigin: "http://127.0.0.1:12345", providerEndpoint: "http://127.0.0.1:12346/v1"};
  for (const mutation of [{mode: "external"}, {profile: "/another/profile"}, {providerEndpoint: "https://external.example/v1"}, {providerEndpoint: "http://localhost:12346/v1"}]) assert.throws(() => createNativeProtectedApprover({...base,...mutation}));
});

async function nativeInputFixture(mode, run, {register = true} = {}) {
  const {createServer} = await import("node:http");
  const {createRequire} = await import("node:module");
  const require = createRequire(new URL("../../../../apps/desktop/package.json", import.meta.url));
  const {WebSocketServer} = require("ws");
  let present = true, captures = 0, discoveries = 0; const inputs = [];
  const server = createServer((_request, response) => {discoveries++; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(present ? [{id: "owned-review", type: "page", url: "data:text/html;charset=utf-8,owned", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/owned-review`}] : []));});
  const sockets = new WebSocketServer({server});
  const body = JSON.stringify({model: "synthetic", messages: [{role: "user", content: `Prepare a source registry CSV and factual summary Markdown in English.\nSelected sources (JSON): ${JSON.stringify([{id: source.id, hash: source.hash}])}`}], tools: [{type: "function", function: {name: "lawoss_documents_read", parameters: {}}}]});
  const binding = {scope, bodyHash: hash(body), target: hash(JSON.stringify({endpoint: expected.endpoint, providerId: expected.providerId, modelId: expected.modelId, account: hash(expected.apiKey)})), profiles: [], synthetic: true};
  const wire = `Source: Host\nWorkspace: ${expected.workspaceId}\nAction: ai.protected.synthetic\nSynthetic experiment → ${expected.endpoint}\nCurrent scope, model account identity, policy, protected runtime and legal-profile evidence (synthetic experiments provide no legal approval):\n${JSON.stringify(binding)}\n\nComplete serialized provider context (including system instructions and tool results):\n${body}`;
  sockets.on("connection", socket => socket.on("message", bytes => {
    const message = JSON.parse(String(bytes));
    if (message.method === "Runtime.evaluate") {
      captures++;
      const detail = mode === "changed-context" && captures === 2 ? wire.replace('"model":"synthetic"', '"model":"foreign"') : wire;
      return socket.send(JSON.stringify({id: message.id, result: {result: {value: {...capture(detail), workspace: expected.workspaceId, point: {x: 50, y: 50}, denyPoint: {x: 10, y: 50}}}}}));
    }
    if (message.method === "Input.dispatchMouseEvent") {
      inputs.push(message.params);
      const allow = message.params.x === 50;
      if (allow && ((mode === "press-error" && message.params.type === "mousePressed") || (mode === "release-error-open" && message.params.type === "mouseReleased")))
        return socket.send(JSON.stringify({id: message.id, error: {code: -32000, message: "Controlled CDP input failure"}}));
      if (message.params.type === "mouseReleased") {present = allow && mode === "closed-but-listed"; socket.close(); return;}
      return socket.send(JSON.stringify({id: message.id, result: {}}));
    }
    throw new Error("Unexpected CDP contract");
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const driver = createNativeProtectedApprover({mode: "synthetic", root: "/owned", profile: "/owned/profile", cdpOrigin: `http://127.0.0.1:${server.address().port}`, providerEndpoint: expected.endpoint.replace("/chat/completions", "")});
  if (register) driver.expectOperation(expected);
  try {await run({driver, inputs, wire, discoveries: () => discoveries});}
  finally {await driver.close(); for (const socket of sockets.clients) socket.terminate(); await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve));}
}

test("native target discovery waits for a registered operation, then reviews the full real protocol", async () => {
  await nativeInputFixture("release-closes", async ({driver, inputs, discoveries}) => {
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(discoveries(), 0, "An unrelated renderer startup has no protected review to discover");
    assert.deepEqual(inputs, []);
    driver.check(); driver.expectOperation(expected);
    const deadline = Date.now()+1500;
    while (!driver.receipts.length && Date.now()<deadline) {await new Promise(resolve => setTimeout(resolve, 20)); driver.check();}
    assert.equal(driver.receipts.length, 1);
    assert.ok(discoveries()>0);
    assert.deepEqual(inputs.map(input => [input.type,input.x]), [["mousePressed",50],["mouseReleased",50]]);
  }, {register: false});
});

test("validated native input survives the exact reviewed target closing on mouse release without fabricating a model result", async () => {
  await nativeInputFixture("release-closes", async ({driver, inputs, wire}) => {
    const deadline = Date.now()+1500;
    while (!driver.receipts.length && Date.now()<deadline) {await new Promise(resolve => setTimeout(resolve, 20)); driver.check();}
    assert.equal(driver.receipts.length, 1, "The native window may close before CDP acknowledges the submitted release");
    assert.deepEqual(inputs.map(input => [input.type,input.x]), [["mousePressed",50],["mouseReleased",50]]);
    const {timing, ...proof} = driver.receipts[0];
    assert.deepEqual(proof, validateSyntheticReview(capture(wire), expected));
    assert.deepEqual(Object.keys(timing).sort(), ["reviewStartedAtMs", "reviewCompletedAtMs", "reviewElapsedMs", "inputStartedAtMs", "inputCompletedAtMs", "inputElapsedMs"].sort());
    for (const value of Object.values(timing)) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(timing.reviewCompletedAtMs >= timing.reviewStartedAtMs);
    assert.ok(timing.inputStartedAtMs >= timing.reviewCompletedAtMs);
    assert.ok(timing.inputCompletedAtMs >= timing.inputStartedAtMs);
  });
});

test("failed press, open-target release error, still-listed closure and changed context stay denied with descriptive errors", async () => {
  for (const mode of ["press-error", "release-error-open", "closed-but-listed", "changed-context"]) {
    await nativeInputFixture(mode, async ({driver, inputs}) => {
      let failure;
      const deadline = Date.now()+1500;
      while (!failure && Date.now()<deadline) {await new Promise(resolve => setTimeout(resolve, 20)); try {driver.check();} catch (error) {failure = error;}}
      assert.ok(failure, mode+" must fail rather than treat input as accepted");
      assert.equal(driver.receipts.length, 0, mode);
      if (mode === "changed-context") {
        assert.match(failure.message, /wire-scope-account-model-and-body-hash/);
        assert.ok(inputs.every(input => input.x === 10), "A changed review receives only Deny input");
      } else if (mode === "closed-but-listed") assert.match(failure.message, /exact reviewed target remains open/);
      else assert.match(failure.message, /CDP command failed/);
    });
  }
});
