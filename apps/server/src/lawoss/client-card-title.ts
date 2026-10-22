/**
 * Meno klienta pri registrácii z onboardingu (alfa2 B3, N-22): keď volajúci poslal len meno priečinka a priečinok
 * má kartu klienta (`client.md`/`klient.md`) s `title`, registrácia dostane názov z karty. Meno zadané používateľom
 * (iné než meno priečinka) ostáva. Existujúce registrácie sa nepremenúvajú (rozhoduje volajúci cez `prior`).
 */
import { lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

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
  let value = raw;
  if (raw.startsWith("\"") && raw.endsWith("\"") && raw.length >= 2) {
    try { value = String(JSON.parse(raw)); } catch { value = raw.slice(1, -1); }
  } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) value = raw.slice(1, -1).replace(/''/g, "'");
  const title = value.replace(/\s+/g, " ").trim();
  return title && title.length <= 200 ? title : undefined;
}

/** Názov z karty klienta v `root`, ak `requested` je len meno priečinka; inak `requested`. */
export async function registrationName(root: string, requested: string): Promise<string> {
  if (requested.trim() !== basename(root)) return requested;
  for (const name of CLIENT_CARDS) {
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_CARD_BYTES) continue;
      const title = cardTitleFromMarkdown(await readFile(path, "utf8"));
      if (title) return title;
    } catch { /* bez karty = meno priečinka */ }
  }
  return requested;
}
