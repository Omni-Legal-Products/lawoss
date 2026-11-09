/**
 * 🟡 LAWOSS (MČ 8. 11. 2026): the Office installation key from the manifest
 * fragment lives only in sessionStorage, never in localStorage. The pane
 * exchanges it for an office_ token (collaborator scope) and never holds the
 * desktop host token.
 */
export const OFFICE_LAUNCH_KEY = "legalwork.office.launch";
const LAUNCH_PATTERN = /^[A-Za-z0-9_-]{64}$/;

type LaunchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(read: () => LaunchStorage): LaunchStorage | null {
  try { return read(); } catch { return null; }
}

/** Consume the fragment before HashRouter interprets it. */
export function captureOfficeLaunch(input: {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState">;
  session: () => LaunchStorage;
  local: () => LaunchStorage;
}): string {
  const fromHash = new URLSearchParams(input.location.hash.slice(1)).get("office_launch") ?? "";
  if (input.location.hash.includes("office_launch=")) {
    input.history.replaceState(null, "", input.location.pathname + input.location.search);
  }
  const session = storage(input.session), local = storage(input.local);
  let legacy = "";
  try {
    // An upstream shell kept the key in localStorage. Move it once and delete it.
    legacy = local?.getItem(OFFICE_LAUNCH_KEY) ?? "";
    local?.removeItem(OFFICE_LAUNCH_KEY);
  } catch { /* storage unavailable */ }
  let launch = [fromHash, legacy].find(value => LAUNCH_PATTERN.test(value)) ?? "";
  try {
    if (launch) session?.setItem(OFFICE_LAUNCH_KEY, launch);
    else launch = session?.getItem(OFFICE_LAUNCH_KEY) ?? "";
  } catch { /* the in-memory key still connects this pane */ }
  return LAUNCH_PATTERN.test(launch) ? launch : "";
}

/** Only office_ credentials may be stored by the pane; host tokens never are. */
export function officeServerSettings(origin: string, token: string): { urlOverride: string; token: string; hostToken: undefined } {
  if (!token.startsWith("office_")) throw new Error("Office pane accepts only an office_ token");
  return { urlOverride: origin, token, hostToken: undefined };
}
