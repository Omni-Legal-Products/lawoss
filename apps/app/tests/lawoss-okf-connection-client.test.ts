import { describe, expect, test } from "bun:test";
import { okfConnectionClient } from "../src/lawoss/okf/connection";
import { fileContentCacheFor } from "../src/lawoss/okf/file-content-cache";

describe("klient pripojenia OKF (#367, akceptácia 8. 11.)", () => {
  test("rovnaké pripojenie dostane toho istého klienta, takže cache obsahu prežije obnovu", () => {
    const a = okfConnectionClient("http://127.0.0.1:1", "t1");
    const b = okfConnectionClient("http://127.0.0.1:1", "t1");
    expect(b).toBe(a);
    expect(fileContentCacheFor(b)).toBe(fileContentCacheFor(a));
  });
  test("iný token, server alebo token hostiteľa dostane nového klienta a novú cache", () => {
    const a = okfConnectionClient("http://127.0.0.1:1", "t1");
    for (const other of [okfConnectionClient("http://127.0.0.1:1", "t2"), okfConnectionClient("http://127.0.0.1:2", "t1"), okfConnectionClient("http://127.0.0.1:1", "t1", "h")]) {
      expect(other).not.toBe(a);
      expect(fileContentCacheFor(other)).not.toBe(fileContentCacheFor(a));
    }
  });
});
