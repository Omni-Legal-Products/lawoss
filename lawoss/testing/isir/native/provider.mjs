import http from "node:http";

// Only the remote completion protocol is fake. Tool execution is never called
// here: the real OpenCode loop executes the advertised production tool names.
export async function startProvider() {
  const receipts = [];
  const errors = [];
  const server = http.createServer(async (req, res) => {
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
        const content = typeof result.content === "string" ? result.content : (result.content ?? []).map(p => p.text ?? "").join("\n");
        return JSON.parse(content);
      };
      const previous = (name, matches = () => true) => calls.filter(c => c.function.name === name && matches(JSON.parse(c.function.arguments))).at(-1);
      const originalIds = sources.filter(s => !s.parentId).map(s => s.id);
      let call;
      if (recoveryTurn && sources.length) {
        const freshCalls = messages.slice(lastUser + 1).flatMap(m => m.tool_calls ?? []);
        if (!freshCalls.some(c => c.function.name === "lawoss_documents_read")) call = {name:"lawoss_documents_read",args:{id:sources[0].id,limit:16000}};
        else if (!freshCalls.some(c => c.function.name === "bash")) call = {name:"bash",args:{command:process.platform === "win32" ? 'node -p "process.cwd()"' : "pwd",description:"Report the recovered session current working directory"}};
      } else if (sources.length && !toolResults.some(r => String(r.content).includes('"error"'))) {
        const listCall = previous("lawoss_documents_list");
        if (!listCall) call = {name:"lawoss_documents_list",args:{limit:50}};
        else if (decoded(listCall)?.nextOffset != null) call = {name:"lawoss_documents_list",args:{limit:50,offset:decoded(listCall).nextOffset}};
        else {
          for (const source of sources) {
            const last = previous("lawoss_documents_read", args => args.id === source.id);
            const result = last ? decoded(last) : null;
            if (!result || result.nextOffset != null) { call = {name:"lawoss_documents_read",args:{id:source.id,limit:16000,...(result?.nextOffset == null ? {} : {offset:result.nextOffset})}}; break; }
          }
          if (!call && !previous("lawoss_documents_export", args => args.kind === "registry")) call = {name:"lawoss_documents_export",args:{path:"native-registry.csv",kind:"registry",outputLanguage:language,documentIds:originalIds,entries:originalIds.map(documentId=>({documentId,summary:'Synthetic; "quoted" protocol evidence\nsecond line'}))}};
          if (!call && !previous("lawoss_documents_export", args => args.kind === "summary")) call = {name:"lawoss_documents_export",args:{path:"native-summary.md",kind:"summary",outputLanguage:language,documentIds:originalIds,entries:[]}};
          if (!call && !previous("lawoss_documents_validate")) call = {name:"lawoss_documents_validate",args:{paths:["native-registry.csv","native-summary.md"],outputLanguage:language,documentIds:originalIds}};
        }
      }
      const names = (body.tools ?? []).map(t => t.function?.name);
      if (call && !names.includes(call.name)) throw new Error(`Real engine did not advertise ${call.name}`);
      receipts.push({ model: body.model, path: req.url, sources: sources.map(s => ({ id: s.id, hash: s.hash })), call, toolResults });
      const id = `chatcmpl-native-${receipts.length}`;
      const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
      await new Promise(resolve=>setTimeout(resolve,sources.length&&toolResults.length===0?250:25));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
      emit({ ...base, choices: [{ index: 0, delta: { role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: `call_native_${receipts.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: "Synthetic transport finished. Saved-file validation determines status." }) }, finish_reason: null }] });
      emit({ ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
      res.end("data: [DONE]\n\n");
    } catch (e) { errors.push({path:req.url,error:String(e)}); res.writeHead(500); res.end(JSON.stringify({ error: { message: String(e) } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, receipts, errors, close: () => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}) };
}
