/**
 * Ohraničené čítanie súborov pamäte (review P3a, 23. 10. 2026).
 *
 * Pamäť číta aj server aplikácie (nástroj `lawoss_memory`), nie len CLI v shelli. Súbor v spise preto
 * nesmie viesť inam: symbolický odkaz (`VSTUPY.md` → spis iného klienta), pomenovaná rúra (čítanie by
 * navždy čakalo) ani zariadenie či obrovský súbor (`/dev/zero`, gigabajty) sa nečítajú. Číta sa len
 * bežný súbor pomenovaný priamo, do limitu; inak chyba, ktorú volajúci ohlási ako nečitateľný súbor.
 * Rodičovské priečinky rieši volajúci (spis môže byť alias, napr. Dropbox).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { decodeText } from "./text-decode.ts";

/** Jeden súbor pamäte alebo kontextu (záznam, karta, `VSTUPY.md`, `okf.config`). */
export const FILE_BYTE_LIMIT = 2 * 1024 * 1024;
/** Všetky záznamy jedného adresára `memory/` spolu; nad ním je čítanie neúplné, nie nekonečné. */
export const STORE_BYTE_LIMIT = 16 * 1024 * 1024;
/** Súborov `*.md` v jednom adresári `memory/`; nad ním je čítanie neúplné (aj prázdne súbory stoja čas a riadky hlásení). */
export const STORE_FILE_LIMIT = 2000;

/** Bajty bežného súboru, bez nasledovania odkazu a bez blokovania; chýbajúci súbor hodí ENOENT. */
export function readRegularFile(path: string, limit = FILE_BYTE_LIMIT): Buffer {
  const named = lstatSync(path);
  if (named.isSymbolicLink()) throw new Error(`Symbolický odkaz nie je povolený: ${path}`);
  if (!named.isFile()) throw new Error(`Nie je bežný súbor: ${path}`);
  // O_NONBLOCK: rúra podstrčená po kontrole neblokuje otvorenie; O_NOFOLLOW: ani podstrčený odkaz.
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino) throw new Error(`Súbor sa zmenil počas čítania: ${path}`);
    if (opened.size > limit) throw new Error(`Súbor prekračuje limit ${limit} bajtov: ${path}`);
    // Ohraničené aj vtedy, keď súbor počas čítania rastie.
    const buffer = Buffer.alloc(Math.min(opened.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (read === 0) break;
      count += read;
    }
    if (count > limit) throw new Error(`Súbor prekračuje limit ${limit} bajtov: ${path}`);
    return buffer.subarray(0, count);
  } finally { closeSync(fd); }
}

/** Text súboru napísaného človekom (UTF-8, UTF-16 s BOM), ohraničene ako `readRegularFile`. */
export function readTextFile(path: string, limit = FILE_BYTE_LIMIT): string {
  return decodeText(readRegularFile(path, limit));
}
