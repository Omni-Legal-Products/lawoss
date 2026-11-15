// LAWOSS #415: kancelária z onboardingu appky nemá okf.config a karty klientov jurisdikciu nenesú. Engine dostane cestu
// k profilu kancelárie a CLI `okf` z neho vezme jurisdikciu nového prípadu bez otázky na advokáta.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { officeProfileEnv, officeRoot } from "./linked-folders.js";

const roots: string[] = [];
const prior = process.env.LEGALWORK_DATA_DIR;
afterEach(async () => {
  if (prior === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = prior;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

test("#415: engine dostane cestu k profilu onboardingu a CLI z neho vezme jurisdikciu kancelárie bez okf.config", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-office-profile-")));
  roots.push(root);
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa");
  await mkdir(join(practice, "Office", "memory"), { recursive: true });
  await writeFile(join(practice, "Office", "AGENTS.md"), "# Kancelária\n");
  await mkdir(client, { recursive: true });
  await writeFile(join(client, "client.md"), "---\ntype: klient\ntitle: Alfa\n---\n");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_office_profile", hostToken: "owt_office_profile_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const env = officeProfileEnv(config);
  // The same file onboarding writes (`<runtimeStorage>/lawoss-onboarding/profile.json`) and `officeRoot` reads.
  expect(env.LAWOSS_OFFICE_PROFILE).toBe(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"));
  // The bundled CLI the novy-spis skill runs, with the engine's environment: a new case without --sk/--cz.
  const cli = fileURLToPath(new URL("../../../../lawoss/okf/bundle/okf.js", import.meta.url));
  const okf = (command: "plan" | "apply", extra: Record<string, string>) => spawnSync("node", [cli, command, "spis", "--title", "Spor", "--date", "2026-11-15"],
    { cwd: client, encoding: "utf8", env: { ...process.env, LAWOSS_OFFICE_PROFILE: "", ...extra } });
  expect(okf("plan", env).status).toBe(2);
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(env.LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "sk", language: "sk" }));
  expect(await officeRoot(config)).toBe(join(practice, "Office"));
  expect(okf("plan", {}).status).toBe(2);
  expect(okf("apply", env).status).toBe(0);
  expect(await readFile(join(client, "Spisy", "2026-11 Spor", "matter.md"), "utf8")).toMatch(/^jurisdiction: "?sk"?$/m);
});
