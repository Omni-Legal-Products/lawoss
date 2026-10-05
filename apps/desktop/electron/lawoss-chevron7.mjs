// LAWOSS: presence check for Chevron7 (github.com/originalmagneto/chevron7),
// a separate native macOS signing app by the same author. The Integrations
// card only shows "installed" from this. Nothing here launches, opens, signs
// with or otherwise calls Chevron7: it reads `Contents/Info.plist` of the app
// bundles in the given folders and compares the bundle identifier.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const CHEVRON7_BUNDLE_ID = "app.slovensko.chevron7";

const XML_BUNDLE_ID = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<\s]+)\s*<\/string>/;

/**
 * True when an Info.plist declares the Chevron7 bundle identifier. XML plists
 * are matched on the `CFBundleIdentifier` key. Binary plists (bplist00) store
 * an ASCII string of 15 or more bytes as 0x5F, an int marker 0x10, a one-byte
 * length and the bytes, so that exact object is matched instead of running
 * `plutil`; a longer identifier with the same prefix has a different length.
 */
const BPLIST_BUNDLE_ID = Buffer.concat([
  Buffer.from([0x5f, 0x10, CHEVRON7_BUNDLE_ID.length]),
  Buffer.from(CHEVRON7_BUNDLE_ID, "latin1"),
]);

export function plistDeclaresChevron7(buffer) {
  if (buffer.subarray(0, 6).toString("latin1") === "bplist") {
    return buffer.includes(BPLIST_BUNDLE_ID);
  }
  const match = XML_BUNDLE_ID.exec(buffer.toString("utf8"));
  return match?.[1] === CHEVRON7_BUNDLE_ID;
}

async function listAppBundles(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map((entry) => path.join(root, entry.name))
      // The usual bundle name first, then any renamed copy.
      .sort((a, b) => Number(path.basename(b) === "Chevron7.app") - Number(path.basename(a) === "Chevron7.app"));
  } catch {
    return [];
  }
}

/** Scans the top level of `roots` for an app bundle with the Chevron7 bundle id. */
export async function findChevron7App({ platform, roots }) {
  if (platform !== "darwin") return { installed: false };
  for (const root of roots) {
    for (const bundle of await listAppBundles(root)) {
      try {
        if (plistDeclaresChevron7(await readFile(path.join(bundle, "Contents", "Info.plist")))) {
          return { installed: true };
        }
      } catch {
        // Unreadable or missing Info.plist: not Chevron7, keep looking.
      }
    }
  }
  return { installed: false };
}
