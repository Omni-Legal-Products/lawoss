// Explicit test-only input provisioning. This entry is never the shipped main.
// It changes chooser inputs only; production IPC/auth/copy/runtime remain real.
import { app, dialog, ipcMain } from "electron";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

const root = process.env.LAWOSS_ISIR_NATIVE_ROOT;
if (!root || !path.isAbsolute(root) || process.env.LEGALWORK_DEV_MODE !== "1" || app.isPackaged) {
  throw new Error("ISIR native entry requires an isolated development profile");
}
const profile = process.env.LEGALWORK_ELECTRON_USERDATA;
const outside = (value) => !value || !path.isAbsolute(value) || path.relative(root,value).startsWith("..") || path.isAbsolute(path.relative(root,value));
if (outside(profile)) throw new Error("ISIR native entry requires a profile inside the owned test root");
// safeStorage probes during production boot otherwise enter the host login
// keychain and can block CI's main thread before any renderer exists.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");
app.setPath("appData", path.join(root,"appdata"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setPath("home", path.join(root, "home"));
app.setPath("documents", path.join(root, "documents"));
dialog.showOpenDialog = async (...args) => {
  const choice = JSON.parse(await readFile(path.join(root, "chooser.json"), "utf8"));
  const options = args.at(-1);
  if (!Array.isArray(choice.paths) || choice.paths.some(outside)) throw new Error("Invalid native chooser fixture");
  await appendFile(path.join(root, "chooser-receipts.jsonl"), JSON.stringify({ properties: options.properties, paths: choice.paths }) + "\n");
  return { canceled: false, filePaths: choice.paths };
};
// Observation only: the actual production dispatcher, auth, preload and copy
// handler run unchanged. No result is fabricated or replaced.
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => register(channel, channel !== "legalwork:desktop" ? handler : async (event, command, ...args) => {
  if (command !== "workspaceCopyFiles") return handler(event,command,...args);
  const receipt={workspaceId:args[0]?.workspaceId,folder:args[0]?.folder,paths:args[0]?.paths};
  try {
    const result=await handler(event,command,...args);
    await appendFile(path.join(root,"copy-receipts.jsonl"),JSON.stringify({...receipt,result})+"\n").catch(e=>process.stderr.write(`ISIR copy audit: ${e}\n`));
    return result;
  } catch(error) {
    await appendFile(path.join(root,"copy-receipts.jsonl"),JSON.stringify({...receipt,error:String(error)})+"\n").catch(e=>process.stderr.write(`ISIR copy audit: ${e}\n`));
    throw error;
  }
});
await import("../electron/main.mjs");
