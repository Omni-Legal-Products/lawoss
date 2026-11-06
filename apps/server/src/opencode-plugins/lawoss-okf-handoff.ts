// Only the plugin entry point is exported: OpenCode invokes each module export.
import { LawossOkfHandoff as createPlugin } from "../../../../lawoss/okf-handoff/plugin.mjs";
import { acquireWikiAgentSecret } from "./wiki-agent-secret.js";
await acquireWikiAgentSecret();
export const LawossOkfHandoff = (input: { directory: string }) => createPlugin(input, { mode: "native" });
