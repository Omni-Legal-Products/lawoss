// LAWOSS: interný domovský priestor (spec 2026-10-08, P8). Bez lokálneho priečinka sa nespustí
// server ani engine, takže sa nedá nastaviť AI. Prázdny priečinok v userData bez klientskych dát
// dá natívnym stránkam (krok AI, Poskytovatelia AI) engine; appka ho skrýva (lawoss/home-workspace.ts).
import { realpath } from "node:fs/promises";
import path from "node:path";

export const LAWOSS_HOME_DIR_NAME = "lawoss-domov";

export function lawossHomeWorkspacePath(userData) {
  return path.join(userData, LAWOSS_HOME_DIR_NAME);
}

/** Zaregistruje domovský priestor, len ak nie je žiadny lokálny priečinok. Vráti, či ho práve zaregistroval. */
export async function ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }) {
  const state = await workspaceStore.readWorkspaceState();
  const local = state.workspaces.filter((entry) => entry?.workspaceType !== "remote" && String(entry?.path ?? "").trim());
  const folderPath = lawossHomeWorkspacePath(userData);
  const isHome = (entry) => path.basename(String(entry?.path ?? "").trim()) === LAWOSS_HOME_DIR_NAME;
  const real = local.filter((entry) => !isHome(entry));
  if (real.length) {
    // Obrana do hĺbky: výber nesmie ostať na domove, keď existuje skutočný priečinok.
    const home = local.find(isHome);
    if (home) {
      await mkdir(folderPath, { recursive: true });
      const target = real[0].id;
      if (state.selectedId === home.id || state.activeId === home.id) await workspaceStore.setSelectedWorkspace(target);
      if (state.watchedId === home.id) await workspaceStore.setRuntimeActiveWorkspace(target);
    }
    return false;
  }
  // Priečinok sa vytvára vždy, aj keď je domov už zaregistrovaný (mohol byť zmazaný na disku).
  await mkdir(folderPath, { recursive: true });
  if (local.length) return false;
  // registerExisting vyžaduje kanonickú cestu (macOS /var -> /private/var).
  const canonical = await realpath(folderPath);
  await workspaceStore.createWorkspace({ folderPath: canonical, registerExisting: true, appFiles: "outside", name: "LAWOSS" });
  return true;
}
