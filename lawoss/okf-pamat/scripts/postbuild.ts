import { readFileSync, writeFileSync } from "node:fs";

const file = "bundle/okf-memory.js";
const body = readFileSync(file, "utf8").replace(/^#!.*\n/, "");
writeFileSync(
  file,
  "#!/usr/bin/env node\n// @lawoss/okf-pamat — vygenerované z bin/okf-memory.ts cez `bun run build`. Needitovať ručne.\n" + body,
  "utf8",
);
console.log("postbuild ok");
