/**
 * LAWOSS #264 (rozhodnutie MČ 23. 10. 2026): súborové trasy upstream `/workspace/:id/files/*` (čítanie, zoznam, katalóg,
 * zápis, kópia, import, presun) nesiahajú do priečinka iného klienta zaregistrovaného vnútri tohto klienta
 * (`foreignNestedClientRoots`, ako vlastníctvo chatov). Vnorený priečinok bez karty pod kartou nadradeného je spis toho
 * istého klienta a ostáva prístupný. V zozname a katalógu taký priečinok vypadne, priame čítanie či zápis odmietne 403.
 *
 * Korene sa počítajú z registrovaných priečinkov a kariet klientov (I/O), preto sa na krátko pamätajú pre koreň klienta;
 * zmena zoznamu klientov pamäť hneď zahodí. Pamäť má najviac jednu položku na registrovaný priečinok.
 */
import { isAbsolute, join } from "node:path";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import { foreignNestedClientRoots } from "./linked-folders.js";
import { canonicalPath } from "./linked-folders-rules.js";
import { foldedPath, isPathWithin } from "./path-within.js";

const CACHE_MS = 2000;

export const nestedClientFolderError = () => new ApiError(403, "nested_client_folder", "This folder belongs to another client registered inside this client. Open it from that client.");

export function nestedClientFileGuard(config: ServerConfig) {
  const cache = new Map<string, { at: number; key: string; roots: Promise<string[]> }>();
  const rootsFor = (root: string): Promise<string[]> => {
    const workspace = config.workspaces.find((entry) => entry.path === root);
    if (!workspace || workspace.preset === "wiki") return Promise.resolve([]);
    const key = config.workspaces.map((entry) => `${entry.id}\0${entry.path}\0${entry.preset ?? ""}`).join("\n");
    const cached = cache.get(root);
    if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.roots;
    const roots = foreignNestedClientRoots(config, workspace).then((found) => found.map((root) => foldedPath(root)), () => []);
    for (const stale of cache.keys()) if (!config.workspaces.some((entry) => entry.path === stale)) cache.delete(stale);
    cache.set(root, { at: Date.now(), key, roots });
    return roots;
  };
  /** Leží cesta (absolútna alebo relatívna ku koreňu klienta) v priečinku vnoreného iného klienta? */
  const inside = async (root: string, path: string): Promise<boolean> => {
    const roots = await rootsFor(root);
    if (!roots.length) return false;
    const target = foldedPath(await canonicalPath(isAbsolute(path) ? path : join(root, path)));
    return roots.some((nested) => isPathWithin(nested, target));
  };
  return {
    inside,
    /** Odmietne cestu v priečinku vnoreného iného klienta. */
    assert: async (root: string, path: string): Promise<void> => { if (await inside(root, path)) throw nestedClientFolderError(); },
  };
}
