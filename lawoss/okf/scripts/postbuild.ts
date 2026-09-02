// Doplní hlavičku do bundle/okf.js po `bun build`. Spúšťa sa cez bun, nie node.
import { readFileSync, writeFileSync } from "node:fs";
const file = "bundle/okf.js";
const body = readFileSync(file, "utf8").replace(/^#!.*\n/, "");
writeFileSync(
  file,
  "#!/usr/bin/env node\n// @lawoss/okf — vygenerované z src/ cez `bun run build`. Needitovať ručne.\n" + body,
  "utf8",
);
console.log("postbuild ok");
