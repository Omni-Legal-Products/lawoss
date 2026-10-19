import {createHash} from "node:crypto";
import path from "node:path";

const hash = value => createHash("sha256").update(value).digest("hex");
const tools = new Set(["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"]);
const maximum = 4 * 1024 * 1024 + 128 * 1024;
const refuse = (reason = "context-invalid") => {throw Object.assign(new Error(`Native synthetic review refused: ${reason}`), {code: "NATIVE_SYNTHETIC_REVIEW_REFUSED"});};
const parse = value => {try {return JSON.parse(value);} catch {refuse();}};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function currentScope(scope, expected) {
  return scope?.workspaceId === expected.workspaceId && /^synthetic:[a-f0-9-]{36}$/.test(scope.matterId ?? "") && same(scope.jurisdictions, ["CZ", "SK"]);
}

/** Test-only classification of a pinned wholly synthetic office. This function
 * grants nothing: the driver must click the real isolated native review UI. */
export function validateSyntheticReview(capture, expected) {
  const endpoint = new URL(expected.endpoint);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname) || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/v1/chat/completions") refuse("provider-endpoint");
  if (capture.protocol !== "data:" || capture.title !== "Review request" || !capture.ready || !capture.denyFocused || capture.contextElements || capture.remoteElements || capture.scripts || capture.bridge || !capture.csp?.includes("default-src 'none'; script-src 'none'")) refuse("native-window-boundary");
  const detail = capture.detail;
  if (typeof detail !== "string" || Buffer.byteLength(detail) > maximum || !detail.startsWith(`Source: Host\nWorkspace: ${expected.workspaceId}\nAction: `)) refuse("complete-context-owner");
  const action = detail.match(/^Action: ([^\n]+)$/m)?.[1];
  if (!["ai.documents.synthetic", "ai.protected.synthetic"].includes(action) || !detail.includes(expected.endpoint)) refuse("synthetic-action-and-target");
  if (!expected.sources.length || expected.sources.some(source => !/^[a-f0-9]{64}$/.test(source.hash) || !source.text?.includes("SYNTHETIC"))) refuse("known-source-canaries");
  if (action === "ai.documents.synthetic") {
    const scope = parse(detail.match(/^Scope: ([^\n]+)$/m)?.[1] ?? "null");
    const completeSources = expected.sources.map(source => `\nSelected source ${source.id}, SHA-256 ${source.hash}:\n${source.text}`).join("");
    if (!currentScope(scope, expected) || !detail.includes(`\nProject: ${expected.hostDirectory}\n`) || !detail.includes(`\nTarget: ${expected.endpoint}\n`) || !detail.includes("Legal approval of generated content: false") || !detail.includes("Classify all selected prepared content as public/synthetic test material only.") || !detail.endsWith(completeSources)) refuse("initial-scope-and-complete-sources");
  } else {
    const marker = "\n\nComplete serialized provider context (including system instructions and tool results):\n";
    const bodyStart = detail.indexOf(marker);
    const bindingStart = detail.indexOf("\n", detail.indexOf("Current scope, model account identity, policy, protected runtime and legal-profile evidence"));
    if (bodyStart < 0 || bindingStart < 0 || bindingStart >= bodyStart) refuse("complete-wire-framing");
    const binding = parse(detail.slice(bindingStart + 1, bodyStart));
    const serialized = detail.slice(bodyStart + marker.length), body = parse(serialized);
    const target = hash(JSON.stringify({endpoint: expected.endpoint, providerId: expected.providerId, modelId: expected.modelId, account: hash(expected.apiKey)}));
    if (!currentScope(binding.scope, expected) || binding.synthetic !== true || !same(binding.profiles, []) || binding.target !== target || binding.bodyHash !== hash(serialized) || body.model !== expected.modelId) refuse("wire-scope-account-model-and-body-hash");
    if (!Array.isArray(body.messages) || !Array.isArray(body.tools) || !body.tools.length || body.tools.some(tool => !tools.has(tool.function?.name))) refuse("wire-document-tool-allowlist");
    const texts = body.messages.filter(message => message.role === "user").map(message => typeof message.content === "string" ? message.content : (message.content ?? []).map(part => part.text ?? "").join("\n"));
    const selection = texts.map(text => text.match(/Selected sources \(JSON\): (\[[^\n]*\])/)).find(Boolean);
    if (!selection || !texts.some(text => text.startsWith("Prepare a source registry CSV and factual summary Markdown"))) refuse("selected-generation-prompt");
    const selected = parse(selection[1]);
    const identities = sources => sources.map(source => [source.id, source.hash]).sort((left, right) => left[0].localeCompare(right[0]));
    if (!same(identities(selected), identities(expected.sources))) refuse("selected-source-identities");
    for (const message of body.messages) for (const call of message.tool_calls ?? []) if (!tools.has(call.function?.name)) refuse("tool-call-allowlist");
  }
  return {action, contextHash: hash(detail), bytes: Buffer.byteLength(detail)};
}

const captureExpression = `(()=>{const context=document.getElementById('context'),allow=document.getElementById('allow'),deny=document.getElementById('deny');if(!context||!allow||!deny)return null;const detail=context.textContent??'';return {detail:detail.length<=${maximum}?detail:null,ready:!allow.disabled&&!deny.disabled,denyFocused:document.activeElement===deny,contextElements:context.childElementCount,remoteElements:document.querySelectorAll('iframe,frame,img,object,embed,form,link').length,scripts:document.scripts.length,bridge:typeof window.__LEGALWORK_ELECTRON__!=='undefined'||typeof window.__legalworkControl!=='undefined'||typeof window.require!=='undefined',protocol:location.protocol,title:document.title,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,workspace:detail.split(String.fromCharCode(10)).find(line=>line.startsWith("Workspace: "))?.slice(11),point:{x:allow.getBoundingClientRect().x+allow.getBoundingClientRect().width/2,y:allow.getBoundingClientRect().y+allow.getBoundingClientRect().height/2},denyPoint:{x:deny.getBoundingClientRect().x+deny.getBoundingClientRect().width/2,y:deny.getBoundingClientRect().y+deny.getBoundingClientRect().height/2}}})()`;

export const nativeReviewSnapshotExpression = captureExpression;

async function connectTarget(target, cdpOrigin) {
  const url = new URL(target.webSocketDebuggerUrl), origin = new URL(cdpOrigin);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || url.port !== origin.port) refuse();
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {socket.close(); reject(new Error("Native review CDP connection expired"));}, 5000);
    socket.addEventListener("open", () => {clearTimeout(timer); resolve();}, {once: true});
    socket.addEventListener("error", () => {clearTimeout(timer); reject(new Error("Native review CDP connection failed"));}, {once: true});
  });
  let sequence = 0;
  const pending = new Map();
  const disconnect = () => {
    for (const entry of pending.values()) {clearTimeout(entry.timer); entry.reject(Object.assign(new Error("Native review target closed before CDP acknowledgement"), {code: "NATIVE_REVIEW_TARGET_CLOSED"}));}
    pending.clear();
  };
  socket.addEventListener("close", disconnect);
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error("Native review CDP command failed")); else entry.resolve(message.result);
  });
  return {send: (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); reject(new Error("Native review CDP command expired"));}, 5000);
    if (socket.readyState !== WebSocket.OPEN) {clearTimeout(timer); reject(new Error("Native review CDP input was not dispatched: target unavailable")); return;}
    pending.set(id, {resolve, reject, timer});
    try {socket.send(JSON.stringify({id, method, params}));} catch {pending.delete(id); clearTimeout(timer); reject(new Error("Native review CDP input was not dispatched"));}
  }), close: () => {socket.close(); for (const entry of pending.values()) {clearTimeout(entry.timer); entry.reject(new Error("Native review closed"));} pending.clear();}};
}

/** CDP input only. No approval service, callback, host-token route or preload
 * substitution is used. Unexpected review requests are clicked Deny. */
export function createNativeProtectedApprover({mode, root, profile, cdpOrigin, providerEndpoint, request = fetch}) {
  if (mode !== "synthetic" || !path.isAbsolute(root) || !path.isAbsolute(profile) || path.relative(root, profile).startsWith("..") || path.isAbsolute(path.relative(root, profile))) refuse();
  const origin = new URL(cdpOrigin), provider = new URL(providerEndpoint);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port || provider.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(provider.hostname) || !provider.port) refuse();
  const expected = new Map(), completed = new Set(), connections = new Set(), receipts = [];
  let failure, active, stopped = false;
  const click = async (connection, point, targetId, allowReleasedClosure = false) => {
    await connection.send("Input.dispatchMouseEvent", {type: "mousePressed", button: "left", clickCount: 1, ...point});
    try {await connection.send("Input.dispatchMouseEvent", {type: "mouseReleased", button: "left", clickCount: 1, ...point});}
    catch (error) {
      // The real isolated preload sends its decision on click; the host then
      // destroys this disposable window synchronously. A dispatched release
      // can therefore lose its CDP acknowledgement. This records input only;
      // actual protected receiver/tool/output results remain the acceptance oracle.
      if (!allowReleasedClosure || error?.code !== "NATIVE_REVIEW_TARGET_CLOSED") throw error;
      const current = await (await request(cdpOrigin + "/json/list", {signal: AbortSignal.timeout(5000)})).json();
      if (!Array.isArray(current) || current.some(target => target.id === targetId)) throw new Error("Native review release failed while the exact reviewed target remains open");
    }
  };
  const poll = async () => {
    const targets = await (await request(cdpOrigin + "/json/list", {signal: AbortSignal.timeout(5000)})).json();
    for (const target of targets.filter(target => target.type === "page" && target.url?.startsWith("data:text/html;charset=utf-8,") && !completed.has(target.id))) {
      const reviewStartedAtMs = Date.now(), reviewStarted = performance.now();
      const connection = await connectTarget(target, cdpOrigin); connections.add(connection);
      try {
        const value = await connection.send("Runtime.evaluate", {expression: captureExpression, returnByValue: true});
        const capture = value.result?.value;
        if (!capture || !capture.ready) continue;
        try {
          const scope = expected.get(capture.workspace);
          if (!scope || receipts.length >= 1000) refuse();
          const receipt = validateSyntheticReview(capture, scope);
          // Re-read complete native text immediately before actual input.
          const latest = await connection.send("Runtime.evaluate", {expression: captureExpression, returnByValue: true});
          if (!same(validateSyntheticReview(latest.result?.value, scope), receipt)) refuse();
          const reviewCompletedAtMs = Date.now(), reviewElapsedMs = performance.now() - reviewStarted;
          const inputStartedAtMs = Date.now(), inputStarted = performance.now();
          await click(connection, latest.result.value.point, target.id, true);
          const inputCompletedAtMs = Date.now(), inputElapsedMs = performance.now() - inputStarted;
          receipts.push({...receipt, timing: {reviewStartedAtMs, reviewCompletedAtMs, reviewElapsedMs, inputStartedAtMs, inputCompletedAtMs, inputElapsedMs}}); completed.add(target.id);
        } catch (error) {await click(connection, capture.denyPoint, target.id).catch(() => {}); throw error;}
      } finally {connection.close(); connections.delete(connection);}
    }
  };
  // Discovery belongs to a registered synthetic operation. Startup has no
  // eligible review and must not inherit an unrelated CDP discovery failure.
  const timer = setInterval(() => {if (stopped || active || failure || expected.size === 0) return; active = poll().catch(error => {failure = error;}).finally(() => {active = undefined;});}, 100);
  timer.unref?.();
  return {receipts,
    expectOperation(input) {
      if (!/^ws_native_(?:[1-9]|10)$/.test(input.workspaceId) || !path.isAbsolute(input.hostDirectory) || path.relative(root, input.hostDirectory).startsWith("..") || path.isAbsolute(path.relative(root, input.hostDirectory))) refuse();
      expected.set(input.workspaceId, {...input, endpoint: providerEndpoint.replace(/\/+$/, "") + "/chat/completions", providerId: "isir-native", modelId: "synthetic", apiKey: "synthetic-local-only"});
    },
    check() {if (failure) throw failure;},
    async close() {stopped = true; clearInterval(timer); for (const connection of connections) connection.close(); await active;},
  };
}
