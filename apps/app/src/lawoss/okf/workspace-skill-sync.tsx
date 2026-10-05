/** @jsxImportSource react */
/**
 * Skilly OKF pri otvorení klienta (MČ 5. 10. 2026, bod 24). Keď je OKF zapnuté a otvorený pracovný
 * priestor je OKF klient alebo vec pod zaregistrovaným klientom, doplní do priestoru klienta chýbajúce
 * skilly a obnoví zastarané cez ten istý mechanizmus ako onboarding (`refreshOkfSkills`): SKILL.md sa
 * prepíše len vtedy, keď je bajtovo niektorou skôr pribalenou verziou (`BUNDLED_OKF_SKILL_HASHES`),
 * upravený sa zachová a appka na to raz upozorní. Pribalené CLI zdroje sa obnovia, keď sa líšia.
 */
import { useEffect } from "react";
import type { Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { okfSkillPack } from "../domains/onboarding/install-pack";
import { loadOkfConnection } from "./connection";
import { resolveOpenClient, type OpenClientReader, type OpenClientWorkspace } from "./open-client";
import { refreshOkfSkills, type OkfSkillClient } from "./skill-refresh";
import { reloadAfterSkillWrites } from "./skill-availability";
import { notifyModifiedOkfSkills } from "./skill-refresh-notice";

export type OkfSkillSyncClient = OkfSkillClient & OpenClientReader & Pick<LegalworkServerClient, "onboardingStatus" | "capabilities"> & Partial<Pick<LegalworkServerClient, "reloadEngine">>;
export type OkfSkillSyncResult =
  | { status: "refreshed"; workspaceId: string; modified: string[] }
  | { status: "skipped"; reason: "okf_off" | "not_client" | "read_only" };

/** Idempotentné: druhé spustenie nad rovnakým priečinkom nič nezapíše. */
export async function syncOkfSkillsForOpenWorkspace(
  client: OkfSkillSyncClient,
  workspaces: readonly OpenClientWorkspace[],
  workspaceId: string,
  locale: Language,
): Promise<OkfSkillSyncResult> {
  const status = await client.onboardingStatus();
  if (status.profile?.okf?.enabled !== true) return { status: "skipped", reason: "okf_off" };
  const openClient = await resolveOpenClient(client, workspaces, workspaceId);
  if (!openClient) return { status: "skipped", reason: "not_client" };
  const capabilities = await client.capabilities();
  if (!capabilities.skills.write || !capabilities.skillResources?.write) return { status: "skipped", reason: "read_only" };
  // Skilly patria klientovi: vec pod ním ich zdedí, kópia vo veci by zatienila neskoršie aktualizácie.
  const { modified, written } = await refreshOkfSkills(client, openClient.workspaceId, await okfSkillPack(locale));
  await reloadAfterSkillWrites(client, openClient.workspaceId, written);
  return { status: "refreshed", workspaceId: openClient.workspaceId, modified };
}

const NOTICE_KEY = "lawoss.okf.skillNotice.";

/** Upozornenie na zachované úpravy raz pre ten istý priestor a ten istý zoznam skillov, nie pri každom štarte. */
export function shouldNotifyModified(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, workspaceId: string, modified: readonly string[]): boolean {
  const key = `${NOTICE_KEY}${workspaceId}`;
  const value = [...modified].sort().join(",");
  try {
    if (!value) { storage?.removeItem(key); return false; }
    if (storage?.getItem(key) === value) return false;
    storage?.setItem(key, value);
  } catch {
    // Bez úložiska sa upozorní; nič iné od neho nezávisí.
  }
  return true;
}

const ATTEMPTS = 8;
const RETRY_MS = 750;
/** Jeden pokus na priestor za beh appky; obnova je idempotentná, opakovanie by len zaťažilo server. */
const synced = new Set<string>();

/** Bez vzhľadu; vložené do bočného panela, ktorý je pri každom otvorenom pracovnom priestore. */
export function OkfWorkspaceSkillSync({ workspaceId }: { workspaceId: string }) {
  const locale = useLocale();
  useEffect(() => {
    const id = workspaceId.trim();
    if (!id || synced.has(id)) return;
    synced.add(id);
    let cancelled = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (left: number) => {
      void loadOkfConnection()
        .then(async (connection) => {
          // Pri štarte appky server ešte nemusí mať adresu ani zoznam priestorov (ako pri voľbe OKF).
          if (!connection.client || !connection.workspaces.some((workspace) => workspace.id === id)) throw new Error("workspace not ready");
          const result = await syncOkfSkillsForOpenWorkspace(connection.client, connection.workspaces, id, locale);
          finished = true;
          const storage = typeof window === "undefined" ? undefined : window.localStorage;
          if (!cancelled && result.status === "refreshed" && shouldNotifyModified(storage, result.workspaceId, result.modified)) notifyModifiedOkfSkills(result.modified, locale);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (left > 1) timer = setTimeout(() => attempt(left - 1), RETRY_MS);
          else {
            finished = true;
            console.warn("[lawoss] OKF skills were not refreshed for the open workspace", error);
          }
        });
    };
    attempt(ATTEMPTS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Prerušený pokus (prepnutie priestoru) sa pri ďalšom otvorení zopakuje, dokončený nie.
      if (!finished) synced.delete(id);
    };
  }, [workspaceId, locale]);
  return null;
}
