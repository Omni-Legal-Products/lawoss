import { afterEach, expect, spyOn, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as os from "node:os";
import { join } from "node:path";
import { configuredCloudRoots, isCloudFolder, isMacCloudFolder, isWithinCloudRoot, syncClientRoots } from "./cloud-folder.js";

test("File Provider folders include their nested projects and fully local contents", () => {
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage/OneDrive-Firm/Matters", "/Users/test")).toBe(true);
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage/Dropbox/Matters", "/Users/test")).toBe(true);
  expect(isMacCloudFolder("/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Matters", "/Users/test")).toBe(true);
});

test("ordinary folders named OneDrive and sibling prefixes stay shareable", () => {
  expect(isMacCloudFolder("/Users/test/Projects/OneDrive contracts", "/Users/test")).toBe(false);
  expect(isMacCloudFolder("/Users/test/Library/CloudStorage-backup/Matters", "/Users/test")).toBe(false);
  expect(isMacCloudFolder("/Users/test/Library/Mobile Documents/com~apple~CloudDocs-backup", "/Users/test")).toBe(false);
});

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function home() {
  const path = await mkdtemp(join(tmpdir(), "cloud-folders-"));
  fixtures.push(path);
  return path;
}
async function config(path: string, value: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value);
}

test("Google Drive, Box and other macOS File Providers use the same policy", () => {
  for (const provider of ["GoogleDrive-test@example.test", "Box-Box", "Nextcloud-test", "ownCloud-test", "ProtonDrive-test"]) {
    expect(isMacCloudFolder(`/Users/test/Library/CloudStorage/${provider}/Cases/A`, "/Users/test")).toBe(true);
  }
});

test("configured roots match boundaries, Windows case, drive roots and UNC paths", () => {
  expect(isWithinCloudRoot("d:/shared/cases/", ["D:\\Shared\\"], "win32")).toBe(true);
  expect(isWithinCloudRoot("D:\\Shared-backup", ["D:\\Shared"], "win32")).toBe(false);
  expect(isWithinCloudRoot("X:\\Matters", ["X:\\"], "win32")).toBe(true);
  expect(isWithinCloudRoot("\\\\server\\share\\Cases", ["\\\\SERVER\\SHARE"], "win32")).toBe(true);
  expect(isWithinCloudRoot("/sync/../ordinary", ["/sync"], "linux")).toBe(false);
  expect(isWithinCloudRoot("/sync/cases", ["sync"], "linux")).toBe(false);
  expect(isWithinCloudRoot("/sync/cases", ["/"], "linux")).toBe(true);
});

test("Dropbox reads moved roots and both accounts without touching their documents", async () => {
  const root = await home();
  const personal = join(root, "Renamed personal storage");
  const business = join(root, "Firm storage");
  // Sync folders deliberately do not exist: detection only reads client config.
  await config(join(root, ".dropbox", "info.json"), JSON.stringify({ personal: { path: personal }, business: { path: business } }));
  const roots = await configuredCloudRoots("darwin", root, {});
  expect(roots.sort()).toEqual([personal, business].sort());
  expect(isWithinCloudRoot(join(business, "Matters", "A"), roots, "darwin")).toBe(true);
  expect(isWithinCloudRoot(join(root, "Dropbox"), roots, "darwin")).toBe(false);
});

test("Linux clients use XDG configuration and Dropbox's documented info file", async () => {
  const root = await home();
  const xdg = join(root, "configuration");
  await config(join(root, ".dropbox", "info.json"), JSON.stringify({ personal: { path: "/data/custom-dropbox" } }));
  await config(join(xdg, "Nextcloud", "nextcloud.cfg"), String.raw`[Accounts]
0\FoldersWithPlaceholders\1\localPath=/data/custom-nextcloud/
1\Folders\2\localPath="/data/second, account/"
`);
  await config(join(xdg, "ownCloud", "owncloud.cfg"), String.raw`[Accounts]
0\Folders\uuid\localPath=/data/custom-owncloud/
`);
  const roots = await configuredCloudRoots("linux", root, { XDG_CONFIG_HOME: xdg });
  expect(roots.sort()).toEqual(["/data/custom-dropbox", "/data/custom-nextcloud/", "/data/second, account/", "/data/custom-owncloud/"].sort());
  expect(isWithinCloudRoot("/data/custom-nextcloud/case", roots, "linux")).toBe(true);
});

test("macOS recognizes legacy and sandboxed Nextcloud and ownCloud configurations", async () => {
  const root = await home();
  const preferences = join(root, "Library", "Preferences");
  await config(join(preferences, "Nextcloud", "nextcloud.cfg"), String.raw`[Accounts]
0\Folders\1\localPath=/Volumes/Casework/
`);
  await config(join(root, "Library", "Containers", "com.nextcloud.desktopclient", "Data", "Library", "Preferences", "Nextcloud", "nextcloud.cfg"), String.raw`[Accounts]
0\FoldersWithPlaceholders\1\localPath=/Volumes/NewCasework/
`);
  await config(join(preferences, "ownCloud", "ownCloud.cfg"), String.raw`[Accounts]
0\Folders\1\localPath=/Volumes/FirmDocs/
`);
  expect((await configuredCloudRoots("darwin", root, {})).sort()).toEqual(["/Volumes/Casework/", "/Volumes/NewCasework/", "/Volumes/FirmDocs/"].sort());
});

test("QSettings path parsing handles Unicode, escaped separators and quoted commas", () => {
  expect(syncClientRoots(String.raw`[General]
localPath=/not-a-sync-root
[Accounts]
0\url=https://example.test
0\Folders\1\localPath="C:\\Cases, Firm\\M\xe4 tters"
1\FoldersWithPlaceholders\2\localPath=${"/Volumes/Ünicode/"}
2\Folders\3\localPath=/Volumes/T\xc3\xa4nne/
0\Folders\1\targetPath=/remote
0\Folders\1\journalPath=/not-a-root
`)).toEqual(["C:\\Cases, Firm\\Mä tters", "/Volumes/Ünicode/", "/Volumes/Tänne/"]);
});

test("missing configs and ordinary folders with provider names are not cloud folders", async () => {
  const root = await home();
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([]);
  for (const name of ["Google Drive", "Dropbox", "Box", "Nextcloud", "ownCloud", "OneDrive contracts"]) {
    const folder = join(root, name);
    await mkdir(folder);
    expect(await isCloudFolder(folder)).toBe(false);
  }
});

test("a broken optional provider config does not block an unrelated local project", async () => {
  if (process.platform === "win32") return; // Native Windows harness covers registry/config integration.
  const root = await home();
  const local = join(root, "Ordinary project");
  await mkdir(local);
  await config(join(root, ".dropbox", "info.json"), "{broken");
  const profile = spyOn(os, "homedir").mockReturnValue(root);
  try { expect(await isCloudFolder(local)).toBe(false); }
  finally { profile.mockRestore(); }
});

test("a broken provider does not hide another provider's successfully detected roots", async () => {
  const root = await home();
  await config(join(root, ".dropbox", "info.json"), "{broken");
  await config(join(root, "Library", "Preferences", "Nextcloud", "nextcloud.cfg"), String.raw`[Accounts]
0\Folders\1\localPath=/Volumes/Working cloud/
`);
  const roots = await configuredCloudRoots("darwin", root, {});
  expect(isWithinCloudRoot("/Volumes/Working cloud/Case", roots, "darwin")).toBe(true);
  expect(isWithinCloudRoot("/Volumes/Ordinary", roots, "darwin")).toBe(false);
});

test("read errors in optional settings do not abort detection", async () => {
  const root = await home();
  // A directory in place of the file produces a real filesystem read error,
  // including when CI runs as a user that can bypass chmod permissions.
  await mkdir(join(root, ".dropbox", "info.json"), { recursive: true });
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([]);
});

test("learned cloud roots survive corrupt or missing settings and refresh after recovery", async () => {
  const root = await home();
  const path = join(root, ".dropbox", "info.json");
  const first = join(root, "Moved Dropbox");
  const second = join(root, "New Dropbox");
  await config(path, JSON.stringify({ personal: { path: first } }));
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([first]);
  await writeFile(path, "{incomplete update");
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([first]);
  await rm(path);
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([first]);
  await config(path, JSON.stringify({ personal: { path: second } }));
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([second]);
  // A valid empty replacement, e.g. an unlinked account, clears old roots.
  await writeFile(path, "{}");
  expect(await configuredCloudRoots("darwin", root, {})).toEqual([]);
});

test("optional-config failures do not silently turn a known cloud folder into a local folder", async () => {
  if (process.platform === "win32") return;
  const root = await home();
  const cloud = join(root, "Renamed cloud storage");
  const local = join(root, "Ordinary");
  await mkdir(cloud);
  await mkdir(local);
  const path = join(root, ".dropbox", "info.json");
  await config(path, JSON.stringify({ personal: { path: cloud } }));
  const profile = spyOn(os, "homedir").mockReturnValue(root);
  try {
    expect(await isCloudFolder(cloud)).toBe(true);
    await writeFile(path, "{broken");
    expect(await isCloudFolder(cloud)).toBe(true);
    expect(await isCloudFolder(local)).toBe(false);
  } finally { profile.mockRestore(); }
});

test("optional-config warnings are deduplicated until the settings recover", async () => {
  const root = await home();
  const path = join(root, ".dropbox", "info.json");
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await config(path, "{private account contents must not appear in logs");
    await configuredCloudRoots("darwin", root, {});
    await configuredCloudRoots("darwin", root, {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.join(" ")).not.toContain("private account");
    await writeFile(path, "{}");
    await configuredCloudRoots("darwin", root, {});
    await writeFile(path, "{broken again");
    await configuredCloudRoots("darwin", root, {});
    expect(warn).toHaveBeenCalledTimes(2);
  } finally { warn.mockRestore(); }
});

test.skipIf(process.platform !== "darwin")("OS-known cloud folders remain blocked with a broken config on first inspection", async () => {
  const root = await home();
  const cloud = join(root, "Library", "CloudStorage", "OneDrive-Fixture", "Case");
  await mkdir(cloud, { recursive: true });
  await config(join(root, ".dropbox", "info.json"), "{broken");
  const profile = spyOn(os, "homedir").mockReturnValue(root);
  try { expect(await isCloudFolder(cloud)).toBe(true); }
  finally { profile.mockRestore(); }
});

test.skipIf(process.platform !== "darwin")("a failed native check of the target folder still reports an error", async () => {
  const root = await home();
  await config(join(root, ".dropbox", "info.json"), "{broken");
  const profile = spyOn(os, "homedir").mockReturnValue(root);
  try { await expect(isCloudFolder(join(root, "Folder removed meanwhile"))).rejects.toThrow(); }
  finally { profile.mockRestore(); }
});

const cloudStorage = join(homedir(), "Library", "CloudStorage");
const hasCloudStorage = process.platform === "darwin" && await access(cloudStorage).then(() => true, () => false);
test.skipIf(!hasCloudStorage)("resolved links into File Provider folders are detected without reading files", async () => {
  const root = await home();
  const link = join(root, "shortcut");
  await symlink(cloudStorage, link);
  expect(await isCloudFolder(link)).toBe(true);
});
