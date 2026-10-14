import { defaultGraphFilter, type WikiGraphFilter } from "./wiki-graph-data";

export type WikiGraphCamera = { x: number; y: number; ratio: number; angle: number };
export type WikiGraphPosition = { id: string; x: number; y: number };
export type WikiGraphPreferences = { filter: WikiGraphFilter; camera?: WikiGraphCamera };

export function readGraphPreferences(key: string): WikiGraphPreferences {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`legalwork.wiki.graph:${key}`) ?? "null");
    if (!raw || typeof raw !== "object") return { filter: defaultGraphFilter };
    const filter = "filter" in raw ? raw.filter : null;
    const camera = "camera" in raw ? raw.camera : null;
    const result: WikiGraphPreferences = { filter: { ...defaultGraphFilter } };
    if (filter && typeof filter === "object") {
      if ("query" in filter && typeof filter.query === "string") result.filter.query = filter.query;
      if ("type" in filter && typeof filter.type === "string") result.filter.type = filter.type;
      if ("folder" in filter && typeof filter.folder === "string") result.filter.folder = filter.folder;
      if ("local" in filter && typeof filter.local === "boolean") result.filter.local = filter.local;
      if ("orphans" in filter && typeof filter.orphans === "boolean") result.filter.orphans = filter.orphans;
      if ("depth" in filter && typeof filter.depth === "number" && Number.isFinite(filter.depth)) result.filter.depth = Math.max(1, Math.min(5, filter.depth));
    }
    if (camera && typeof camera === "object" && "x" in camera && "y" in camera && "ratio" in camera && "angle" in camera
      && typeof camera.x === "number" && Number.isFinite(camera.x) && typeof camera.y === "number" && Number.isFinite(camera.y)
      && typeof camera.ratio === "number" && camera.ratio > 0 && Number.isFinite(camera.ratio) && typeof camera.angle === "number" && Number.isFinite(camera.angle)) {
      result.camera = { x: camera.x, y: camera.y, ratio: camera.ratio, angle: camera.angle };
    }
    return result;
  } catch { return { filter: defaultGraphFilter }; }
}

export function saveGraphPreferences(key: string, preferences: WikiGraphPreferences): void {
  try { localStorage.setItem(`legalwork.wiki.graph:${key}`, JSON.stringify(preferences)); } catch { /* In-memory graph remains usable when storage is unavailable. */ }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("legalwork-wiki-graph", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("positions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readGraphPositions(key: string): Promise<WikiGraphPosition[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const opened = db;
    const value: unknown = await new Promise((resolve, reject) => {
      const request = opened.transaction("positions").objectStore("positions").get(`d3-v1:${key}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => item && typeof item === "object" && "id" in item && typeof item.id === "string"
      && "x" in item && typeof item.x === "number" && Number.isFinite(item.x) && "y" in item && typeof item.y === "number" && Number.isFinite(item.y)
      ? [{ id: item.id, x: item.x, y: item.y }] : []);
  } catch { return []; }
  finally { db?.close(); }
}

export async function saveGraphPositions(key: string, positions: WikiGraphPosition[]): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const opened = db;
    await new Promise<void>((resolve, reject) => {
      const transaction = opened.transaction("positions", "readwrite");
      transaction.objectStore("positions").put(positions, `d3-v1:${key}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* Position caching must never prevent navigation. */ }
  finally { db?.close(); }
}
