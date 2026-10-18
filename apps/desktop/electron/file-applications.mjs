import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_APPLICATIONS = 3;

// Ask Launch Services for this file's handlers, in the system's suitability order.
const MAC_APPLICATIONS_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  var urls = $.NSWorkspace.sharedWorkspace.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0]));
  var apps = [];
  var seen = Object.create(null);
  for (var i = 0; i < urls.count && apps.length < ${MAX_APPLICATIONS}; i++) {
    var url = urls.objectAtIndex(i);
    var bundle = $.NSBundle.bundleWithURL(url);
    var appPath = ObjC.unwrap(url.path);
    var id = ObjC.unwrap(bundle.bundleIdentifier) || appPath;
    if (seen[id]) continue;
    seen[id] = true;
    apps.push({ name: ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(appPath)).replace(/\\.app$/i, ""), appPath: appPath });
  }
  return JSON.stringify(apps);
}`;

export function desktopEntrySupportsMime(content, mimeType) {
  const entry = content.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0];
  if (!entry || !/^Type=Application\s*$/m.test(entry) || /^(Hidden|NoDisplay)=true\s*$/m.test(entry)) return false;
  return (entry.match(/^MimeType=(.*)$/m)?.[1] ?? "").trim().split(";").includes(mimeType);
}

export async function getApplicationsForFile(target, platform = process.platform) {
  if (!target) return [];
  try {
    if (platform === "darwin") {
      const { stdout } = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_APPLICATIONS_SCRIPT, target], { timeout: 5000 });
      return JSON.parse(stdout);
    }
    if (platform === "linux") {
      const { stdout } = await run("xdg-mime", ["query", "filetype", target], { timeout: 3000 });
      const mimeType = stdout.trim();
      if (!mimeType) return [];
      const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share");
      const dataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
      const results = [];
      const seen = new Set();
      for (const dir of [dataHome, ...dataDirs].map((dir) => path.join(dir, "applications"))) {
        const entries = await readdir(dir).catch(() => []);
        for (const entry of entries) {
          if (!entry.endsWith(".desktop") || seen.has(entry)) continue;
          seen.add(entry);
          const appPath = path.join(dir, entry);
          const content = await readFile(appPath, "utf8").catch(() => "");
          if (!desktopEntrySupportsMime(content, mimeType)) continue;
          const name = content.match(/^Name=(.+)$/m)?.[1].trim();
          if (!name || !/^Exec=.+$/m.test(content)) continue;
          results.push({ name, appPath });
          if (results.length === MAX_APPLICATIONS) return results;
        }
      }
      return results;
    }
  } catch {
    // Keep the default opener available when handler discovery is unavailable.
  }
  return [];
}
