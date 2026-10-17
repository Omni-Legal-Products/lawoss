import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
// Server cwd is essential: its preload keeps tests off the installed profile.
for (const [command, args, cwd] of [
  [process.execPath, ["--test", "lawoss/testing/isir/corpus.test.mjs", "lawoss/testing/isir/native/corpus.test.mjs", "lawoss/testing/isir/native/provider.test.mjs", "lawoss/testing/isir/native/engine-identity.test.mjs", "lawoss/testing/isir/native/engine-client.test.mjs", "lawoss/testing/isir/native/native-entry.test.mjs", "lawoss/testing/isir/native/cdp.test.mjs", "lawoss/testing/isir/native/diagnostics.test.mjs", "lawoss/testing/isir/native/owned-process.test.mjs"], root],
  ["bun", ["test", "src/isir-case-attachments.e2e.test.ts"], `${root}/apps/server`],
  [process.execPath, ["--test", "apps/desktop/electron/isir-case-files.test.mjs"], root],
  ["bun", ["test", "tests/workspace-attachment.test.ts", "tests/home-submission.test.ts"], `${root}/apps/app`],
]) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
