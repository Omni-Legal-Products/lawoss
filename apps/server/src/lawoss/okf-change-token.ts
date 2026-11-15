/**
 * LAWOSS #460: lacná kontrola zmeny pre tichú obnovu prehľadu OKF. Appka pošle cesty, ktoré pri poslednom úplnom
 * čítaní klienta vypísala alebo prečítala, a server vráti odtlačok ich `stat` (druh, veľkosť súboru, čas zmeny).
 * Priečinok zmení čas zmeny pri pridaní, odstránení aj premenovaní položky, súbor pri zmene obsahu. Nezmenený
 * odtlačok znamená, že úplné čítanie by dalo ten istý prehľad, a appka ho preskočí.
 *
 * Hranica ako pri `files/list` a `files/content`: rola žiadateľa a vnorený klient (#264). Cesta mimo hranice nevráti
 * chybu, len stály stav `unreadable`, takže odtlačok nič o nej neprezradí.
 */
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { normalizeWorkspaceRelativePath } from "../routes/files.js";
import { addRoute, type Route } from "../routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { resolveReadableWorkspaceFilePath } from "./filesystem-boundary.js";
import { nestedClientFileGuard } from "./nested-client-files.js";

export const OKF_CHANGE_TOKEN_MAX_PATHS = 20_000;
const BODY_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 16;
const body = z.strictObject({ paths: z.array(z.string().max(4096)).max(OKF_CHANGE_TOKEN_MAX_PATHS) });

type PathState = readonly ["dir", number] | readonly ["file", number, number] | readonly ["other", number] | readonly ["missing"] | readonly ["unreadable"];

export function registerOkfChangeTokenRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}) {
  const { routes, config, jsonResponse } = options;
  const nestedClients = nestedClientFileGuard(config);
  addRoute(routes, "POST", "/workspace/:id/lawoss/okf/change-token", "client", async (ctx) => {
    const workspace = await options.resolveWorkspace(config, ctx.params.id);
    const parsed = body.safeParse(await options.readJsonBodyLimited(ctx.request, BODY_BYTES));
    if (!parsed.success) throw new ApiError(400, "invalid_paths", `Expected at most ${OKF_CHANGE_TOKEN_MAX_PATHS} paths.`);
    const { paths } = parsed.data;
    const scope = ctx.actor?.scope ?? (ctx.actor?.type === "host" ? "owner" : "viewer");
    const pathState = async (path: string): Promise<PathState> => {
      try {
        const relative = path ? normalizeWorkspaceRelativePath(path, { allowSubdirs: true }) : ".";
        const absolute = await resolveReadableWorkspaceFilePath(workspace.path, relative, scope, { allowRoot: !path });
        await nestedClients.assert(workspace.path, absolute);
        const info = await stat(absolute);
        if (info.isDirectory()) return ["dir", info.mtimeMs];
        if (info.isFile()) return ["file", info.size, info.mtimeMs];
        return ["other", info.mtimeMs];
      } catch (error) {
        return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? ["missing"] : ["unreadable"];
      }
    };
    const states: PathState[] = new Array(paths.length);
    let next = 0;
    const worker = async () => { while (next < paths.length) { const i = next++; states[i] = await pathState(paths[i]!); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
    // Najnovší čas zmeny: appka podľa neho nedôveruje odtlačku, ktorý mohol vzniknúť počas úplného čítania.
    const newest = Math.max(0, ...states.map((state) => state[0] === "file" ? state[2] : state[0] === "dir" || state[0] === "other" ? state[1] : 0));
    const token = createHash("sha256").update(JSON.stringify(paths.map((path, i) => [path, states[i]]))).digest("hex");
    return jsonResponse({ token, newest });
  });
}
