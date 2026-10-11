import assert from "node:assert/strict";
import test from "node:test";
import { desktopEntrySupportsMime, getApplicationsForFile } from "./file-applications.mjs";

test("suggests only visible applications registered for the file's exact MIME type", () => {
  const entry = "[Desktop Entry]\nType=Application\nName=Editor\nExec=editor %f\nMimeType=text/plain;application/pdf;\n";
  assert.equal(desktopEntrySupportsMime(entry, "text/plain"), true);
  assert.equal(desktopEntrySupportsMime(entry, "application/pdf"), true);
  assert.equal(desktopEntrySupportsMime(entry, "application/msword"), false);
  assert.equal(desktopEntrySupportsMime(entry, "text"), false);
  assert.equal(desktopEntrySupportsMime(entry + "Hidden=true\n", "text/plain"), false);
  assert.equal(desktopEntrySupportsMime(entry + "NoDisplay=true\n", "text/plain"), false);
  assert.equal(desktopEntrySupportsMime(entry.replace("Type=Application", "Type=Link"), "text/plain"), false);
  assert.equal(desktopEntrySupportsMime("[Desktop Entry]\nType=Application\n[Desktop Action View]\nMimeType=text/plain;", "text/plain"), false);
});

test("keeps the app list empty when no file or supported discovery platform exists", async () => {
  assert.deepEqual(await getApplicationsForFile(""), []);
  assert.deepEqual(await getApplicationsForFile("report.docx", "win32"), []);
});
