import http from "node:http";
import { createRequire } from "node:module";
const { z } = createRequire(new URL("../../../../apps/server/package.json", import.meta.url))("zod");

export function decodeNativeToolOutput(content) {
  const text=typeof content === 'string' ? content : content.map(part=>part.text??'').join('\n');
  // app-state-reminders.ts appends complete, named reminder frames to plugin
  // JSON. Strip only that exact trailing envelope; all other suffixes fail.
  const reminders=/(?:\n\n<system-reminder topic="[a-z][a-z0-9-]*">\n(?:(?!\n<\/system-reminder>)[\s\S])*\n<\/system-reminder>)+$/;
  return JSON.parse(text.replace(reminders,''));
}

// Only the remote completion protocol is fake. Tool execution is never called
// here: the real OpenCode loop executes the advertised production tool names.
export async function startProvider() {
  const receipts = [];
  const errors = [];
  let requestOrdinal = 0;
  const server = http.createServer(async (req, res) => {
    const ordinal = ++requestOrdinal, receivedAtMs = Date.now();
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const messages = body.messages ?? [];
      const userText = m => typeof m.content === "string" ? m.content : (m.content ?? []).map(p => p.text ?? "").join("\n");
      const lastUser = messages.findLastIndex(m => m.role === "user");
      const recoveryTurn = lastUser >= 0 && userText(messages[lastUser]).includes("NATIVE_RECOVERED_CWD_PROOF");
      const prompt = messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content : (m.content ?? []).map(p => p.text ?? "").join("\n")).join("\n");
      const marker = prompt.match(/Selected sources \(JSON\): (\[[^\n]*\])/);
      const sources = marker && body.tools?.length ? JSON.parse(marker[1]) : [];
      const language = prompt.match(/outputLanguage=\\?"(cs|sk|en)/)?.[1] ?? "en";
      const toolResults = messages.filter(m => m.role === "tool");
      const calls = messages.flatMap(m => m.tool_calls ?? []);
      const decoded = call => {
        const result = toolResults.find(r => r.tool_call_id === call.id);
        if (!result) return null;
        return decodeNativeToolOutput(result.content);
      };
      const previous = (name, matches = () => true) => calls.filter(c => c.function.name === name && matches(JSON.parse(c.function.arguments))).at(-1);
      const originalIds = sources.filter(s => !s.parentId).map(s => s.id);
      let call;
      const readCalls = [];
      if (recoveryTurn && sources.length) {
        const freshCalls = messages.slice(lastUser + 1).flatMap(m => m.tool_calls ?? []);
        const freshRead = freshCalls.filter(c => c.function.name === "lawoss_documents_read").at(-1);
        if (!freshRead) call = {name:"lawoss_documents_read",args:{id:sources[0].id,limit:16000}};
        else if (decoded(freshRead)?.nextOffset != null) call = {name:"lawoss_documents_read",args:{id:sources[0].id,limit:16000,offset:decoded(freshRead).nextOffset}};
      } else if (sources.length && !toolResults.some(r => String(r.content).includes('"error"'))) {
        // A completion may batch independent reads, but it cannot advance past
        // any issued call without that exact call's actual tool result.
        for (const issued of calls) if (["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"].includes(issued.function.name)) {
          if (toolResults.filter(result => result.tool_call_id === issued.id).length !== 1) throw new Error("A matching tool result is required before advancing the native protocol");
        }
        const listCall = previous("lawoss_documents_list");
        if (!listCall) call = {name:"lawoss_documents_list",args:{limit:50}};
        else if (decoded(listCall)?.nextOffset != null) call = {name:"lawoss_documents_list",args:{limit:50,offset:decoded(listCall).nextOffset}};
        else {
          for (const source of sources) {
            const last = previous("lawoss_documents_read", args => args.id === source.id);
            const result = last ? decoded(last) : null;
            if (last && (!result || result.id !== source.id || result.hash !== source.hash || result.offset !== (JSON.parse(last.function.arguments).offset ?? 0) || typeof result.text !== "string")) throw new Error("The actual source read identity, hash, offset and text must match its selected request");
            if (last && (!result || !Object.hasOwn(result, "nextOffset") || (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= (JSON.parse(last.function.arguments).offset ?? 0))))) throw new Error("The actual source read must supply its complete next cursor");
            if (readCalls.length < 8 && (!last || result.nextOffset !== null)) readCalls.push({name:"lawoss_documents_read",args:{id:source.id,limit:16000,...(result?.nextOffset == null ? {} : {offset:result.nextOffset})}});
          }
          if (!readCalls.length && !call && !previous("lawoss_documents_export", args => args.kind === "registry")) call = {name:"lawoss_documents_export",args:{path:"native-registry.csv",expectedHash:"",kind:"registry",outputLanguage:language,documentIds:originalIds,entries:originalIds.map(documentId=>({documentId,summary:'Synthetic; "quoted" protocol evidence\nsecond line'}))}};
          if (!readCalls.length && !call && !previous("lawoss_documents_export", args => args.kind === "summary")) call = {name:"lawoss_documents_export",args:{path:"native-summary.md",kind:"summary",outputLanguage:language,documentIds:originalIds,entries:[]}};
          if (!readCalls.length && !call && !previous("lawoss_documents_validate")) call = {name:"lawoss_documents_validate",args:{paths:["native-registry.csv","native-summary.md"],outputLanguage:language,documentIds:originalIds}};
        }
      }
      const names = (body.tools ?? []).map(t => t.function?.name);
      const plannedCalls = readCalls.length ? readCalls : call ? [call] : [];
      for (const planned of plannedCalls) if (!names.includes(planned.name)) throw new Error(`Real engine did not advertise ${planned.name}`);
      let exportSchemaVerified, exportWireAcceptance;
      if (call?.name === "lawoss_documents_export") {
        // Validate the real engine-advertised JSON schema, independently of its
        // combinator encoding; no successful export is fabricated here.
        const advertised = body.tools.find(t => t.function?.name === call.name);
        const schema = z.fromJSONSchema(advertised.function.parameters);
        const { expectedHash, ...input } = call.args;
        if (!schema.safeParse(call.args).success || !schema.safeParse(input).success) throw new Error("Real engine export schema rejects create-only arguments");
        // The pinned engine drops the regex in its wire schema. Record that
        // broader advertisement; strict rejection belongs to plugin execute
        // and HTTP, not to the provider serializer's unsupported constraint.
        exportWireAcceptance = { missing: schema.safeParse(input).success };
        for (const [variant, hash, expectedAccepted] of [["empty", "", true], ["valid", "a".repeat(64), true], ["null", null, false], ["whitespace", " ", false], ["invalid", "invalid", false], ["uppercase", "A".repeat(64), false]]) {
          const actualAccepted = schema.safeParse({ ...input, expectedHash: hash }).success;
          exportWireAcceptance[variant] = actualAccepted;
          if (expectedAccepted && !actualAccepted) {
            // Finite projection of this one schema field, never raw requests,
            // descriptions, property names, values, paths, auth or source text.
            const project = (field, depth = 0) => {
              if (!field || typeof field !== "object" || depth > 3) return { truncated: true };
              const types = ["string", "null", "object", "array", "number", "integer", "boolean"];
              const type = Array.isArray(field.type) ? field.type.filter(t => types.includes(t)).slice(0, 7) : types.includes(field.type) ? field.type : undefined;
              const literal = value => value === "" ? "empty" : value === null ? "null" : "other";
              return { ...(type === undefined ? {} : { type }),
                ...(Object.hasOwn(field, "const") ? { literal: literal(field.const) } : {}),
                ...(Array.isArray(field.enum) ? { literals: field.enum.slice(0, 8).map(literal) } : {}),
                ...(Object.hasOwn(field, "pattern") ? { pattern: field.pattern === "^[a-f0-9]{64}$" ? "lowercase-sha256" : "other" } : {}),
                ...Object.fromEntries(["anyOf", "oneOf", "allOf"].filter(key => Array.isArray(field[key])).map(key => [key, field[key].slice(0, 8).map(value => project(value, depth + 1))])) };
            };
            throw new Error("Real engine export schema hash contract mismatch " + JSON.stringify({ variant, expectedAccepted, actualAccepted, required: advertised.function.parameters.required?.includes("expectedHash") === true, field: project(advertised.function.parameters.properties?.expectedHash) }));
          }
        }
        if (!receipts.some(receipt => receipt.exportSchemaVerified)) console.log("Native export wire acceptance", JSON.stringify(exportWireAcceptance));
        exportSchemaVerified = true;
      }
      receipts.push({ ordinal, receivedAtMs, model: body.model, path: req.url, sources: sources.map(s => ({ id: s.id, hash: s.hash })), call: plannedCalls[0], calls: plannedCalls, toolResults, ...(exportSchemaVerified ? { exportSchemaVerified, exportWireAcceptance } : {}) });
      const id = `chatcmpl-native-${receipts.length}`;
      const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
      await new Promise(resolve=>setTimeout(resolve,sources.length&&toolResults.length===0?250:25));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
      emit({ ...base, choices: [{ index: 0, delta: { role: "assistant", ...(plannedCalls.length ? { tool_calls: plannedCalls.map((planned,index) => ({ index, id: `call_native_${ordinal}_${index}`, type: "function", function: { name: planned.name, arguments: JSON.stringify(planned.args) } })) } : { content: "Synthetic transport finished. Saved-file validation determines status." }) }, finish_reason: null }] });
      emit({ ...base, choices: [{ index: 0, delta: {}, finish_reason: plannedCalls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
      res.end("data: [DONE]\n\n");
    } catch (e) { errors.push({path:req.url,error:String(e)}); res.writeHead(500); res.end(JSON.stringify({ error: { message: String(e) } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, receipts, errors, close: () => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}) };
}
