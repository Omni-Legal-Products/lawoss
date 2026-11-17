/** @jsxImportSource react */
/**
 * #495: priečinok prípadu premenovaný alebo presunutý vo Finderi. Odkaz `?vec=<stará cesta>` nenájde prípad a stránka
 * bola prázdna (len odkaz „Klienti a prípady“). Teraz karta povie, že sa priečinok prípadu nenašiel, a ponúkne prípad
 * s rovnakým číslom v tom istom priečinku (`M003-…` → `M003-…-PREMENOVANE`) a prípady klienta. Nič sa nemení na disku.
 */
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import type { OkfClient } from "../okf/read-model";
import { clientOverviewLink, LITE_CLIENTS_PATH, liteMatterLink } from "./links";

const parentOf = (path: string): string => path.split("/").slice(0, -1).join("/");
const folderOf = (path: string): string => path.split("/").pop() ?? path;
/** Číslo prípadu na začiatku mena priečinka (`M003-…`, `2024-015 …`); bez neho sa premenovaný prípad nehľadá. */
const matterCode = (folder: string): string | null => /^([A-Za-z]*\d+)[-_ ]/.exec(folder)?.[1]?.toLowerCase() ?? null;

export type MissingMatter = {
  folder: string;
  /** Jediný prípad s rovnakým číslom v tom istom priečinku (napr. `Spisy`), ak existuje. */
  renamed?: Pick<MatterOverview, "path" | "title">;
  /** Klient, do ktorého priečinka prípad patril. */
  client?: { key: string; name: string };
};

export function missingMatter(path: string, matters: readonly Pick<MatterOverview, "path" | "title">[], clients: readonly Pick<OkfClient, "path" | "title">[] = []): MissingMatter {
  const folder = folderOf(path);
  const code = matterCode(folder);
  const candidates = code ? matters.filter((m) => m.path !== path && parentOf(m.path) === parentOf(path) && matterCode(folderOf(m.path)) === code) : [];
  const owner = clients.filter((c) => c.path && path.startsWith(`${c.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  return {
    folder,
    ...(candidates.length === 1 && candidates[0] ? { renamed: candidates[0] } : {}),
    ...(owner ? { client: { key: `client:${owner.path}`, name: owner.title?.trim() || folderOf(owner.path) } } : {}),
  };
}

export function MissingMatterView({ notice, locale }: { notice: MissingMatter; locale: Language }) {
  return <div className="lw-status warn grid gap-2" role="alert" data-lawoss-missing-matter="">
    <p>{t("lawoss.lite.matter_missing", locale, { folder: notice.folder })}</p>
    {notice.renamed ? <p>{t("lawoss.lite.matter_missing_renamed", locale, { folder: folderOf(notice.renamed.path) })}</p> : null}
    <div className="flex flex-wrap gap-2">
      {notice.renamed ? <Link className="lw-btn gold" to={liteMatterLink(notice.renamed.path)}>{t("lawoss.lite.matter_missing_open", locale, { title: notice.renamed.title })}</Link> : null}
      {notice.client
        ? <Link className={notice.renamed ? "lw-btn" : "lw-btn gold"} to={clientOverviewLink(notice.client.key)}>{t("lawoss.lite.matter_missing_client", locale, { name: notice.client.name })}</Link>
        : <Link className={notice.renamed ? "lw-btn" : "lw-btn gold"} to={LITE_CLIENTS_PATH}>{t("lawoss.lite.clients_title", locale)}</Link>}
    </div>
  </div>;
}
