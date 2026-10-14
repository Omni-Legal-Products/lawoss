import { relative, resolve, isAbsolute } from "node:path";
import { beginFileEditorHandoff } from "../file-editor-handoff.js";

/** Native file tools have no execution wrapper, so pair the before/after hooks
 * and the engine's error event. Shell processes are coordinated at execution. */
export function nativeFileEdits(directory?: string, begin = beginFileEditorHandoff) {
  const active = new Map<string, { finish: () => Promise<void>; pending?: Promise<void> }>();
  const key = (sessionID: string, callID: string) => `${sessionID}:${callID}`;
  const finish = async (sessionID: string, callID: string) => {
    const id = key(sessionID, callID), operation = active.get(id);
    if (!operation) return;
    operation.pending ??= operation.finish().finally(() => active.delete(id));
    await operation.pending;
  };
  return {
    async before(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) {
      if (!["write", "edit", "multiedit", "apply_patch"].includes(input.tool)) return;
      if (!process.env.LEGALWORK_UI_CONTROL_DISCOVERY) return;
      const raw = output.args.filePath ?? output.args.path;
      let paths: string[] | undefined;
      if (typeof raw === "string" && directory) {
        const path = relative(directory, resolve(directory, raw)).replace(/\\/g, "/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path)) return;
        paths = [path];
      }
      active.set(key(input.sessionID, input.callID), { finish: await begin(input.sessionID, paths) });
    },
    after: finish,
    async event(input: { event: { type: string; properties?: unknown } }) {
      if (input.event.type !== "message.part.updated") return;
      const properties = input.event.properties;
      const part: unknown = properties && typeof properties === "object" ? Reflect.get(properties, "part") : undefined;
      if (!part || typeof part !== "object" || Reflect.get(part, "type") !== "tool") return;
      const state: unknown = Reflect.get(part, "state"), session: unknown = Reflect.get(part, "sessionID"), call: unknown = Reflect.get(part, "callID");
      if (state && typeof state === "object" && ["error", "completed"].includes(Reflect.get(state, "status")) && typeof session === "string" && typeof call === "string") await finish(session, call);
    },
  };
}
