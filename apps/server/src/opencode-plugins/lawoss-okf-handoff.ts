// LAWOSS: OKF memory handoff in OpenCode 2. The portable hooks stay in lawoss/okf-handoff/plugin.mjs
// (also usable outside LAWOSS); this entry point maps them to the native session hooks of engine 2.
import { Plugin } from "@opencode/plugin";
import { LawossOkfHandoff as createHandoffHooks } from "../../../../lawoss/okf-handoff/plugin.mjs";
import { acquireWikiAgentSecret } from "./wiki-agent-secret.js";
import { registerPrimaryContext } from "./native-review-worker.js";
import { nativeEvents } from "./native-events.js";

await acquireWikiAgentSecret();

type Hooks = Awaited<ReturnType<typeof createHandoffHooks>>;
/** One hook set per client folder; a native plugin instance can serve chats of several folders. */
const DIRECTORY_LIMIT = 32;

export default Plugin.define({
  id: "lawoss.okf-handoff",
  async setup(ctx) {
    const byDirectory = new Map<string, Promise<Hooks>>();
    const hooksFor = async (sessionID: string): Promise<Hooks> => {
      const directory = (await ctx.session.get({ sessionID })).location.directory;
      let hooks = byDirectory.get(directory);
      if (!hooks) {
        hooks = createHandoffHooks({ directory }, { mode: "native" });
        byDirectory.set(directory, hooks);
        const oldest = byDirectory.size > DIRECTORY_LIMIT ? byDirectory.keys().next() : null;
        if (oldest && !oldest.done) byDirectory.delete(oldest.value);
      }
      return hooks;
    };
    const turn = await registerPrimaryContext(ctx, async (event) => {
      const output = { system: [] as string[] };
      await (await hooksFor(event.sessionID))["experimental.chat.system.transform"]?.({ sessionID: event.sessionID }, output);
      for (const text of output.system) event.system.push({ type: "text", text });
    });
    const compaction = await ctx.session.hook("compaction", async (event) => {
      const output = { context: [] as string[] };
      await (await hooksFor(event.sessionID))["experimental.session.compacting"]?.({ sessionID: event.sessionID }, output);
      for (const text of output.context) event.system.push({ type: "text", text });
    });
    const events = nativeEvents(ctx, async (event) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.data.sessionID;
      try { await (await hooksFor(sessionID)).event?.({ event: { type: "session.idle", properties: { sessionID } } }); }
      catch { /* A failed checkpoint is reported on the next turn. */ }
    });
    return async () => { events(); await Promise.all([turn.dispose(), compaction.dispose()]); };
  },
});
