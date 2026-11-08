// LAWOSS: brána migrácie histórie chatov (ADR 0016, brána F) bez GUI, len so syntetickými údajmi.
// Databáza enginu v1 (OpenCode 1.18.29) → konzistentná záloha s hashom → podporovaná migrácia
// enginom v2 (`/api/experimental/migration/v1`, upstream V1Migration; interné tabuľky sa needitujú)
// → kontrola, že chaty, správy a ich ID ostali → návrat: obnovená záloha má rovnaký hash a engine v1
// ju otvorí s pôvodnými chatmi. Voliteľný test (ako ostatné testy so skutočným enginom):
//   LAWOSS_TEST_OPENCODE_V1_BIN=<engine 1.18.29> LEGALWORK_TEST_OPENCODE_BIN=<engine 2.1.4-legalwork…> \
//     pnpm --filter legalwork-server exec bun test src/lawoss/engine-v2-history-migration.integration.test.ts
// Syntetický obsah chatov (správy v1) vkladá fixture priamo do databázy v1, ktorú pripravil engine v1;
// databázu enginu v2 test len číta cez jeho verejné API.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const v1Bin = process.env.LAWOSS_TEST_OPENCODE_V1_BIN;
const v2Bin = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const engineTest = test.skipIf(!v1Bin || !v2Bin || process.platform === "win32");

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

const sha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

/** Synthetic HOME/XDG only: the engine never sees the user's profile, credentials or catalog. */
function isolatedEnv(root: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_SHARE: "1", OPENCODE_DISABLE_FFF: "true", OPENCODE_CONFIG_PROJECT_DISABLE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", ...extra };
}

async function startEngine(bin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(bin, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  };
  cleanup.push(stop);
  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`engine did not listen: ${output.slice(-2000)}`)), 60_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/);
      if (match?.[1]) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout?.on("data", read); child.stderr?.on("data", read);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`engine exited ${code}: ${output.slice(-2000)}`)); });
  });
  Object.assign(child, { lawossStop: stop });
  return { url, child };
}

async function stopEngine(engine: { child: ChildProcess }) {
  const stop: unknown = Reflect.get(engine.child, "lawossStop");
  if (typeof stop === "function") await stop();
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function ascendingId(prefix: "msg" | "prt", timestamp: number, counter: number): string {
  const value = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const bytes = Buffer.alloc(6);
  for (let index = 0; index < 6; index += 1) bytes[index] = Number((value >> BigInt(40 - 8 * index)) & 0xffn);
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return `${prefix}_${bytes.toString("hex")}${[...randomBytes(14)].map(byte => alphabet[byte % 62]).join("")}`;
}

/** Synthetic v1 history: user and assistant text in the v1 row format (as LAWOSS v1 seeded templates). */
function seedV1Messages(dbPath: string, sessionID: string, directory: string, texts: string[]): string[] {
  const db = new Database(dbPath);
  try {
    const ids: string[] = [];
    let lastUser = "";
    db.transaction(() => {
      texts.forEach((text, index) => {
        const at = 1_760_000_000_000 + index * 1000, user = index % 2 === 0;
        const id = ascendingId("msg", at, index * 2 + 1), part = ascendingId("prt", at, index * 2 + 2);
        const data = user
          ? { role: "user", time: { created: at }, summary: { diffs: [] }, agent: "build", model: { providerID: "synthetic", modelID: "synthetic-model" } }
          : { role: "assistant", time: { created: at, completed: at + 10 }, parentID: lastUser, modelID: "synthetic-model", providerID: "synthetic", mode: "build", agent: "build",
            path: { cwd: directory, root: directory }, cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } };
        db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(id, sessionID, at, at, JSON.stringify(data));
        db.query("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(part, id, sessionID, at, at, JSON.stringify({ type: "text", text }));
        if (user) lastUser = id;
        ids.push(id);
      });
    })();
    return ids;
  } finally { db.close(); }
}

/** A consistent single-file copy (WAL folded in), as the LAWOSS backup before a migration. */
function consistentBackup(dbPath: string, backupPath: string) {
  const db = new Database(dbPath);
  try { db.run("PRAGMA wal_checkpoint(TRUNCATE)"); db.run(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`); }
  finally { db.close(); }
}

const textOf = (message: unknown): string => JSON.stringify(message);

engineTest("história chatov v1 prejde migráciou v2 s pôvodnými ID a správami; obnovená záloha sa zhoduje hashom a otvorí ju engine v1", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-history-migration-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const client = join(root, "prax", "Klient_A");
  await mkdir(client, { recursive: true });
  for (const folder of ["home", "config", "data", "state", "cache", "db"]) await mkdir(join(root, folder), { recursive: true });
  const dbPath = join(root, "db", "opencode.db");
  const v1Password = randomBytes(12).toString("hex");
  const v1Env = isolatedEnv(root, { OPENCODE_DB: dbPath, OPENCODE_SERVER_USERNAME: "lawoss", OPENCODE_SERVER_PASSWORD: v1Password });

  // 1. Engine v1 vytvorí databázu a dva chaty klienta (ID pridelí engine).
  let v1 = await startEngine(v1Bin!, client, v1Env);
  const v1Headers = { authorization: basic("lawoss", v1Password), "content-type": "application/json" };
  const sessions: Array<{ id: string; texts: string[]; messages: string[] }> = [];
  for (const title of ["Syntetický chat 1", "Syntetický chat 2"]) {
    const response = await fetch(new URL(`/session?directory=${encodeURIComponent(client)}`, v1.url), { method: "POST", headers: v1Headers, body: JSON.stringify({ title }) });
    expect(response.status).toBe(200);
    const created: unknown = await response.json();
    const id = created !== null && typeof created === "object" && "id" in created && typeof created.id === "string" ? created.id : "";
    expect(id).toStartWith("ses_");
    sessions.push({ id, texts: [`${title}: otázka SYNT-${id.slice(-6)}`, `${title}: odpoveď SYNT-${id.slice(-6)}`, `${title}: doplnenie`], messages: [] });
  }
  await stopEngine(v1);
  for (const session of sessions) session.messages = seedV1Messages(dbPath, session.id, client, session.texts);

  // 2. Konzistentná záloha pred migráciou a jej hash.
  const backup = join(root, "db", "opencode.v1-backup.db");
  consistentBackup(dbPath, backup);
  const backupHash = await sha256(backup);
  const v1Rows = (path: string) => {
    const db = new Database(path, { readonly: true });
    try { return { sessions: db.query("select id from session order by id").all(), messages: db.query("select id, session_id from message order by id").all() }; }
    finally { db.close(); }
  };
  const before = v1Rows(backup);
  expect(before.sessions).toHaveLength(2);
  expect(before.messages).toHaveLength(6);

  // 3. Engine v2 nad tou istou databázou: podporovaná migrácia, nič sa nezapisuje priamo do jeho tabuliek.
  const v2Password = randomBytes(12).toString("hex");
  const v2 = await startEngine(v2Bin!, join(root, "home"), isolatedEnv(root, { OPENCODE_DB: dbPath, OPENCODE_PASSWORD: v2Password }));
  const v2Headers = { authorization: basic("opencode", v2Password) };
  const deadline = Date.now() + 120_000;
  let status = "";
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/experimental/migration/v1", v2.url), { headers: v2Headers });
    const body: unknown = await response.json().catch(() => null);
    status = body !== null && typeof body === "object" && "status" in body && typeof body.status === "string" ? body.status : "";
    if (status === "completed" || status === "idle" || status === "error") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  expect(status).not.toBe("error");
  for (const session of sessions) {
    const info = await fetch(new URL(`/api/session/${session.id}`, v2.url), { headers: v2Headers });
    expect([session.id, info.status]).toEqual([session.id, 200]);
    const migrated: unknown = await info.json();
    expect(migrated).toMatchObject({ data: { id: session.id, location: { directory: client } } });
    const messages = await fetch(new URL(`/api/session/${session.id}/message`, v2.url), { headers: v2Headers });
    expect(messages.status).toBe(200);
    const body = textOf(await messages.json());
    for (const text of session.texts) expect(body).toContain(text);
    for (const id of session.messages) expect(body).toContain(id);
  }
  await stopEngine(v2);
  // Pôvodné riadky v1 v migrovanej databáze ostali (upstream V1Migration ich nemaže).
  expect(v1Rows(dbPath)).toEqual(before);

  // 4. Návrat k 1.x: obnova zálohy, rovnaký hash, engine v1 ju otvorí s pôvodnými chatmi a správami.
  const restored = join(root, "db", "opencode.restored.db");
  await copyFile(backup, restored);
  expect(await sha256(restored)).toBe(backupHash);
  v1 = await startEngine(v1Bin!, client, { ...v1Env, OPENCODE_DB: restored });
  for (const session of sessions) {
    const messages = await fetch(new URL(`/session/${session.id}/message?directory=${encodeURIComponent(client)}`, v1.url), { headers: v1Headers });
    expect(messages.status).toBe(200);
    const body = textOf(await messages.json());
    for (const text of session.texts) expect(body).toContain(text);
    for (const id of session.messages) expect(body).toContain(id);
  }
  await stopEngine(v1);
  // Záloha sama sa návratom nezmenila.
  expect(await sha256(backup)).toBe(backupHash);
}, 300_000);
