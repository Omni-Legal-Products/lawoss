/**
 * Meno klienta pri registrácii z onboardingu (alfa2 B3, N-22): keď volajúci poslal len meno priečinka a priečinok
 * má kartu klienta (`client.md`/`klient.md`) s `title`, registrácia dostane názov z karty. Meno zadané používateľom
 * (iné než meno priečinka) ostáva. Existujúce registrácie sa nepremenúvajú (rozhoduje volajúci cez `prior`).
 */
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

const CLIENT_CARDS = ["client.md", "klient.md"];
/** Karta je krátky Markdown; väčší súbor sa nečíta (meno ostane z priečinka). */
const MAX_CARD_BYTES = 64 * 1024;

/** `title` z YAML frontmatteru karty; reťazec v úvodzovkách sa odkóduje, prázdny alebo chýbajúci = `undefined`. */
export function cardTitleFromMarkdown(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.replace(/^﻿/, ""));
  if (!match) return undefined;
  const line = match[1].split(/\r?\n/).find((l) => /^title\s*:/.test(l));
  if (!line) return undefined;
  const raw = line.replace(/^title\s*:\s*/, "").trim();
  // Viacriadkový reťazec, zoznam, mapa, kotva, odkaz alebo značka YAML sa nedá prečítať riadkom: meno ostane z priečinka.
  if (/^[>|[{&*!]/.test(raw)) return undefined;
  let value = raw;
  if (raw.startsWith("\"") && raw.endsWith("\"") && raw.length >= 2) {
    try { value = String(JSON.parse(raw)); } catch { value = raw.slice(1, -1); }
  } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) value = raw.slice(1, -1).replace(/''/g, "'");
  // Riadiace znaky (aj z `\u0007` v úvodzovkách) by appka pri obnove sprievodcu odmietla; nahradia sa medzerou.
  const title = value.replace(/[\s\p{Cc}]+/gu, " ").trim();
  return title && title.length <= 200 ? title : undefined;
}

/** Rovnaké meno bez ohľadu na Unicode tvar (NFC/NFD) a veľkosť písmen (ako priečinky na macOS a Windows). */
const sameName = (a: string, b: string): boolean => a.trim().normalize("NFC").toLocaleLowerCase() === b.trim().normalize("NFC").toLocaleLowerCase();

/** Názov z karty klienta (`client.md`, potom `klient.md`) priamo v `root`; bez karty, symlinku alebo názvu `undefined`. */
export async function clientCardTitle(root: string): Promise<string | undefined> {
  for (const name of CLIENT_CARDS) {
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_CARD_BYTES) continue;
      const title = cardTitleFromMarkdown(await readFile(path, "utf8"));
      if (title) return title;
    } catch { /* bez karty = meno priečinka */ }
  }
  return undefined;
}

/** Názov z karty klienta v `root`, ak `requested` je len meno priečinka; inak `requested`. */
export async function registrationName(root: string, requested: string): Promise<string> {
  if (!sameName(requested, basename(root))) return requested;
  return await clientCardTitle(root) ?? requested;
}

type Named = { path: string; name: string };
/** Koľko kariet sa číta naraz (prax s tisíckou klientov, pomalý NAS). */
const CARD_READS_AT_ONCE = 8;

/**
 * N-A4-2 (test 23. 10. 2026): návrh onboardingu menuje klientov tak ako bočný panel, teda názvom z karty klienta,
 * nie menom priečinka (`C001-syn-tatran-automatika-s-r-o`). Čítajú sa len karty priamo v priečinku klienta, v koreni
 * (`rootTitle`) a v klientovi, ku ktorému sa koreň pripojí ako prípad (`matterClientTitle`); iné cesty mimo koreňa
 * sa nečítajú. Bez karty ostane meno priečinka (`title` chýba).
 */
export async function withClientCardTitles<S extends { root: string; clients: readonly Named[]; practiceCandidates: readonly Named[] }>(suggestion: S): Promise<S & { clients: (Named & { title?: string })[]; practiceCandidates: (Named & { title?: string })[]; rootTitle?: string; matterClientTitle?: string }> {
  const paths = [...new Set([...suggestion.clients, ...suggestion.practiceCandidates].map((client) => client.path))].filter(insideRoot);
  const titles = new Map<string, string>();
  for (let index = 0; index < paths.length; index += CARD_READS_AT_ONCE) {
    await Promise.all(paths.slice(index, index + CARD_READS_AT_ONCE).map(async (path) => {
      const title = await clientCardTitle(join(suggestion.root, path));
      if (title) titles.set(path, title);
    }));
  }
  const titled = (client: Named) => { const title = titles.get(client.path); return title ? { ...client, title } : { ...client }; };
  const rootTitle = await clientCardTitle(suggestion.root);
  const matterClientTitle = await clientCardTitle(matterClientRoot(suggestion.root));
  return { ...suggestion, clients: suggestion.clients.map(titled), practiceCandidates: suggestion.practiceCandidates.map(titled), ...(rootTitle ? { rootTitle } : {}), ...(matterClientTitle ? { matterClientTitle } : {}) };
}

/** Klient, ku ktorému sa pripojí priečinok zvolený ako prípad: rodič, pri `Spisy/` jeho rodič (`matterClientPath` v appke). */
const matterClientRoot = (root: string): string => basename(dirname(root)).toLowerCase() === "spisy" ? dirname(dirname(root)) : dirname(root);

/** Relatívna cesta z prieskumu bez `..` a bez absolútneho začiatku; iná sa nečíta. */
const insideRoot = (path: string): boolean => path !== "" && !isAbsolute(path) && !path.split(/[\\/]+/).includes("..");
