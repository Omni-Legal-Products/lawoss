import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BrowserPasswordStore, browserPasswordOrigin } from "./browser-passwords.js";
import { OAuthVault } from "./file-storage/oauth/vault.js";

test("browser passwords share the encrypted vault without replacing OAuth entries, exposing values or losing concurrent edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-passwords-"));
  try {
    const vault = new OAuthVault(join(root, "test.vault")), store = new BrowserPasswordStore(vault);
    await vault.set("existing-oauth", { accessToken: "access", refreshToken: "refresh", expiresAt: 999 });
    const first = await store.save({ label: "Research", origin: "https://login.example.org/path", username: "lawyer", password: "fixture-secret-123" });
    expect(first.origin).toBe("https://login.example.org");
    expect(JSON.stringify(first)).not.toContain("fixture-secret-123");
    expect(JSON.stringify(await store.list())).not.toContain("password");
    expect((await readFile(vault.path)).includes(Buffer.from("fixture-secret-123"))).toBe(false);
    await Promise.all([
      store.save({ ...first, label: "Renamed", password: "" }),
      store.save({ label: "Other account", origin: first.origin, username: "other", password: "other-secret" }),
      vault.setEntry("other-consumer", z.object({ token: z.string() }), { token: "connector-token" }),
    ]);
    expect(await store.list(first.origin)).toHaveLength(2);
    expect(await store.list("https://example.org")).toHaveLength(2);
    expect(await store.list("https://auth.example.org/login")).toHaveLength(2);
    expect(await store.list("https://different.example.net")).toEqual([]);
    expect(await store.list("")).toEqual([]);
    expect((await store.get(first.id)).password).toBe("fixture-secret-123");
    expect((await store.get(first.id)).label).toBe("Renamed");
    expect(await vault.get("existing-oauth")).toEqual({ accessToken: "access", refreshToken: "refresh", expiresAt: 999 });
    expect(await vault.getEntry("other-consumer", z.object({ token: z.string() }))).toEqual({ token: "connector-token" });
    await store.save({ ...first, origin: "https://other.example.org", password: "" });
    expect((await store.get(first.id)).password).toBe("fixture-secret-123");
    await expect(store.save({ ...first, origin: "https://different.example.net", password: "" })).rejects.toThrow("Enter a password");
    await store.save({ ...first, password: "replacement" });
    expect((await new BrowserPasswordStore(new OAuthVault(vault.path)).get(first.id)).password).toBe("replacement");
    await store.delete(first.id);
    await expect(store.get(first.id)).rejects.toThrow("no longer exists");
    expect(await store.list()).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("website addresses reject unsafe URLs and preserve scheme and port", () => {
  for (const url of ["file:///tmp/password", "javascript:alert(1)", "http://example.org", "example.org"]) {
    expect(() => browserPasswordOrigin(url)).toThrow();
  }
  const authenticated = new URL("https://example.org");
  authenticated.username = "fixture-user";
  authenticated.password = "fixture-only-password";
  expect(() => browserPasswordOrigin(authenticated.href)).toThrow();
  expect(browserPasswordOrigin("https://LOGIN.Example.org:443/path?q=1")).toBe("https://login.example.org");
  expect(browserPasswordOrigin("http://127.0.0.1:8123/login")).toBe("http://127.0.0.1:8123");
});

test("website matching shares main domains and subdomains while separating unrelated sites and private tenants", () => {
  const store = new BrowserPasswordStore(new OAuthVault("unused-fixture.vault"));
  for (const [saved, current] of [
    ["https://www.deepl.com", "https://deepl.com/login"],
    ["https://www.deepl.com", "https://auth.deepl.com/login"],
    ["https://auth.deepl.com", "https://www.deepl.com"],
    ["https://login.firm.co.uk", "https://firm.co.uk"],
    ["https://login.firm.co.uk", "https://accounts.firm.co.uk"],
    ["https://a.github.io", "https://login.a.github.io"],
    ["https://bücher.de", "https://login.xn--bcher-kva.de"],
    ["http://127.0.0.1:8123", "http://127.0.0.1:8123/form"],
  ]) expect(store.matchesWebsite(saved, current)).toBe(true);
  for (const [saved, current] of [
    ["https://deepl.com", "https://notdeepl.com"],
    ["https://deepl.com", "https://deepl.com.evil.net"],
    ["https://firm.co.uk", "https://other.co.uk"],
    ["https://a.github.io", "https://b.github.io"],
    ["https://co.uk", "https://firm.co.uk"],
    ["https://deepl.com", "https://auth.deepl.com:444"],
    ["https://deepl.com", "http://auth.deepl.com"],
    ["http://127.0.0.1:8123", "http://127.0.0.1:8124"],
    ["https://127.0.0.1", "https://127.0.0.2"],
    ["https://deepl.com", "about:blank"],
  ]) expect(store.matchesWebsite(saved, current)).toBe(false);
});

test("one vault login retains multiple destinations across edits without expanding password domains", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-connections-"));
  try {
    const store = new BrowserPasswordStore(new OAuthVault(join(root, "test.vault")));
    const login = await store.save({ label: "SSO account", origin: "https://auth.example.com/login", websiteUrl: "https://research.example.org/?code=private#session", username: "fixture", password: "fixture-secret" });
    expect(login.websites).toEqual([{ name: "SSO account", url: "https://research.example.org/" }]);
    await Promise.all([
      store.connect(login.id, login.origin, { name: "Second product", url: "https://second.example.org/search", providerId: "second" }),
      store.save({ id: login.id, label: "Renamed", origin: login.origin, username: "fixture" }),
    ]);
    const connected = (await store.list())[0]!;
    expect(connected.websites).toHaveLength(2);
    expect(connected.label).toBe("Renamed");
    expect(await store.list("https://second.example.org")).toEqual([]);
    await store.connect(login.id, login.origin, { name: "Second product", url: "https://second.example.org/search", providerId: "second" });
    expect((await store.list())[0]!.websites).toHaveLength(2);
    await expect(store.connect(login.id, "https://unrelated.example", { name: "No", url: "https://another.example" })).rejects.toThrow();
    const changed = await store.save({ id: login.id, label: "New account", origin: "https://different.example", username: "fixture", password: "new-fixture" });
    expect(changed.websites).toEqual([{ name: "New account", url: "https://different.example" }]);
    expect((await store.get(login.id)).password).toBe("new-fixture");
  } finally { await rm(root, { recursive: true, force: true }); }
});
