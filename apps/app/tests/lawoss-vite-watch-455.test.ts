import { expect, test } from "bun:test";
import config from "../vite.config";

test("#455: Vite nesleduje výstup buildu Word add-inu", () => {
  const ignored = config.server?.watch?.ignored;
  expect(Array.isArray(ignored)).toBe(true);
  const patterns = (Array.isArray(ignored) ? ignored : []).filter((value): value is string => typeof value === "string");
  const matches = (path: string) => patterns.some(pattern => new Bun.Glob(pattern).match(path));
  expect(matches("/repo/apps/app/dist-word-addin/third-party/office-editors/mtx-decompressor-source/tsconfig.json")).toBe(true);
  expect(matches("/repo/apps/app/dist-word-addin/taskpane.html")).toBe(true);
  expect(matches("/repo/apps/app/src/main.tsx")).toBe(false);
});
