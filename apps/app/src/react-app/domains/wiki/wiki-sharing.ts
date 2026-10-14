import type { WikiSharingInput, WikiTeamOverview, WikiVault } from "@legalwork/types/wiki";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

export function wikiSharingError(error: unknown): string {
  if (error instanceof LegalworkServerError) {
    if (error.status === 404 || /update_required|unsupported/.test(error.code)) return t("wiki.sharing_update_required");
    if (error.status === 401 || /not_connected|disconnected|sign_in_required/.test(error.code)) return t("wiki.sharing_sign_in");
  }
  return error instanceof Error ? error.message : String(error);
}

export function wikiSharingInput(record?: WikiSharingInput | null): WikiSharingInput {
  return { access: record?.access ?? "org", memberIds: record?.memberIds ?? [] };
}

export function wikiSharingValid(input: WikiSharingInput, team: WikiTeamOverview | undefined) {
  return Boolean(team && (input.access === "org" || input.memberIds.some((id) => team.members.some((member) => member.userId === id && id !== team.userId))));
}

export function joinedTeamWikiIds(wikis: WikiVault[]): Set<string> {
  return new Set(wikis.flatMap((wiki) => wiki.sharing ? [wiki.sharing.id] : wiki.sync && "kind" in wiki.sync && wiki.sync.kind === "team" ? [wiki.sync.wikiId] : []));
}
