import { expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireClientWorkspaceBoundary } from "./agent-client-boundary.js";
import { syntheticHostConfig } from "./test-support/host-config.js";
import type { WorkspaceInfo } from "../types.js";

test("missing configured host scope is unknown, never an implicit client grant", async () => {
  const {root, config} = await syntheticHostConfig();
  try {
    const directory = join(root, "lawoss-onboarding"); await mkdir(directory);
    for (const key of ["officeRoot", "clientRoot"]) {
      await writeFile(join(directory, "profile.json"), JSON.stringify({[key]: join(root, "missing")}));
      await expect(requireClientWorkspaceBoundary(config, root)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_scope_unknown"});
    }
  } finally {await rm(root, {recursive: true});}
});

// N-A3-1 (V10c): starý profil ukazuje na priečinok vnútri zaregistrovaného klienta; ten klient nesmie prísť o nástroje.
async function boundaryFixture(profile: (paths: {practice: string; outer: string; nested: string}) => Record<string, string>) {
  const {root, config} = await syntheticHostConfig();
  const base = await realpath(root), practice = join(base, "prax"), outer = join(practice, "C002 SYN Beta"), nested = join(outer, "C099 SYN Vnoreny");
  await mkdir(nested, {recursive: true});
  const directory = join(root, "lawoss-onboarding"); await mkdir(directory);
  await writeFile(join(directory, "profile.json"), JSON.stringify(profile({practice, outer, nested})));
  const workspace = (id: string, path: string): WorkspaceInfo => ({id, name: id, path, preset: "starter", workspaceType: "local"});
  return {root, config, practice, outer, nested, workspace};
}

test("registrovaný klient so starým vnoreným priečinkom v profile ostáva dostupný, kým v ňom nie je iný zaregistrovaný klient (N-A3-1)", async () => {
  const {root, config, outer, nested, workspace} = await boundaryFixture(({practice, nested}) => ({officeRoot: practice, clientRoot: nested}));
  try {
    // Stav V10c: C099 zaregistrovaný vnútri C002. Chat a shell C002 by videli iného zaregistrovaného klienta, preto 403.
    config.workspaces = [workspace("ws_c002", outer), workspace("ws_c099", nested)];
    await expect(requireClientWorkspaceBoundary(config, outer)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
    await expect(requireClientWorkspaceBoundary(config, nested)).resolves.toBeUndefined();
    // Po odstránení C099 z bočného panela (profil naň stále ukazuje) C002 opäť číta.
    config.workspaces = [workspace("ws_c002", outer)];
    await expect(requireClientWorkspaceBoundary(config, outer)).resolves.toBeUndefined();
  } finally {await rm(root, {recursive: true});}
});

// Kontrola VŘ k PR #225: zaregistrovaný kontajner vnútri praxe nie je klient, aj keď leží v praxi.
test("zaregistrovaný kontajner vnútri praxe s vybraným a ďalším klientom ostáva bez nástrojov agenta (N-A3-1)", async () => {
  const {root, config, practice, workspace} = await boundaryFixture(({practice}) => ({officeRoot: practice, clientRoot: join(practice, "Klienti", "Novak")}));
  try {
    const container = join(practice, "Klienti"), novak = join(container, "Novak"), hron = join(container, "Hron");
    await mkdir(novak, {recursive: true}); await mkdir(hron, {recursive: true});
    config.workspaces = [workspace("ws_klienti", container), workspace("ws_novak", novak), workspace("ws_hron", hron)];
    await expect(requireClientWorkspaceBoundary(config, container)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
    await expect(requireClientWorkspaceBoundary(config, novak)).resolves.toBeUndefined();
  } finally {await rm(root, {recursive: true});}
});

test("koreň praxe a neregistrovaný nadradený priečinok vybraného klienta ostávajú bez nástrojov agenta (N-A3-1)", async () => {
  const {root, config, practice, outer, workspace} = await boundaryFixture(({practice, outer}) => ({officeRoot: practice, clientRoot: outer}));
  try {
    config.workspaces = [workspace("ws_prax", practice), workspace("ws_c002", outer)];
    await expect(requireClientWorkspaceBoundary(config, practice)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
    await expect(requireClientWorkspaceBoundary(config, outer)).resolves.toBeUndefined();
    // Priečinok nad vybraným klientom, ktorý sám nie je zaregistrovaný klient (bez praxe v profile), stále nie.
    await writeFile(join(root, "lawoss-onboarding", "profile.json"), JSON.stringify({clientRoot: outer}));
    config.workspaces = [workspace("ws_c002", outer)];
    await expect(requireClientWorkspaceBoundary(config, practice)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
  } finally {await rm(root, {recursive: true});}
});

// Bezpečnostná kontrola bb025062: bez praxe v profile nie je zaregistrovaný široký priečinok (napr. Dokumenty)
// klient, ktorý by smel vybraného klienta vo vnútri čítať nástrojmi agenta (dokumenty, shell).
test("zaregistrovaný priečinok s vybraným klientom bez praxe v profile ostáva bez nástrojov agenta (N-A3-1)", async () => {
  const {root, config} = await syntheticHostConfig();
  try {
    const base = await realpath(root), documents = join(base, "Dokumenty"), client = join(documents, "C001 Novak");
    await mkdir(client, {recursive: true}); await writeFile(join(client, "secret.txt"), "syntetické");
    const directory = join(root, "lawoss-onboarding"); await mkdir(directory);
    await writeFile(join(directory, "profile.json"), JSON.stringify({clientRoot: client}));
    const workspace = (id: string, path: string): WorkspaceInfo => ({id, name: id, path, preset: "starter", workspaceType: "local"});
    config.workspaces = [workspace("ws_c001", client), workspace("ws_docs", documents)];
    await expect(requireClientWorkspaceBoundary(config, documents)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
    await expect(requireClientWorkspaceBoundary(config, client)).resolves.toBeUndefined();
    // Klient odstránený z bočného panela, profil naň stále ukazuje: priečinok nad ním tiež nie.
    config.workspaces = [workspace("ws_docs", documents)];
    await expect(requireClientWorkspaceBoundary(config, documents)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
  } finally {await rm(root, {recursive: true});}
});

test("vnorený priečinok v profile bez praxe vonkajšieho klienta neodomkne (hranica ostáva prísna) (N-A3-1)", async () => {
  const {root, config, outer, nested, workspace} = await boundaryFixture(({nested}) => ({clientRoot: nested}));
  try {
    config.workspaces = [workspace("ws_c002", outer), workspace("ws_c099", nested)];
    await expect(requireClientWorkspaceBoundary(config, outer)).rejects.toMatchObject({status: 403, code: "wiki_agent_client_workspace_required"});
  } finally {await rm(root, {recursive: true});}
});
