// Only the plugin entry point is exported: OpenCode invokes each module export.
import { LawossOkfHandoff as createPlugin } from "../../../../lawoss/okf-handoff/plugin.mjs";
export const LawossOkfHandoff = (input: { directory: string }) => createPlugin(input, { mode: "native" });
