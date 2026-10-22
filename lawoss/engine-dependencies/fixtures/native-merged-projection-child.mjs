// Controlled process-close witness only, never a synthetic all32 worker success.
import fs from "node:fs/promises";
import path from "node:path";
const [mode, workspace] = process.argv.slice(2);
const hold = setInterval(() => {}, 1000);
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await fs.writeFile(path.join(workspace, "projection-child-settled"), "settled-before-close");
  clearInterval(hold);
}
if (mode === "cancel")
  process.once("SIGTERM", () => {
    settle();
  });
await fs.writeFile(path.join(workspace, "projection-child-ready"), "ready");
console.log(JSON.stringify({ schema: 1, fixture: "emitted-before-close" }));
if (mode !== "cancel") {
  await new Promise((resolve) => setTimeout(resolve, 80));
  await settle();
}
