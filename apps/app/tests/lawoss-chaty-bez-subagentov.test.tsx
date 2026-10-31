// N-A8-4: zoznam chatov klienta neukazuje chaty subagentov (podriadené chaty enginu s `parentID`).
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceSessionGroup } from "../src/app/types";
import { setLocale } from "../src/i18n";
import { isListedClientChat } from "../src/lawoss/chat/listed-chats";
import { ProjectSessionsPage } from "../src/react-app/domains/workspace/project-sessions-page";

const group: WorkspaceSessionGroup = {
  workspace: { id: "ws-c901", name: "C901 SYN Klient", path: "/tmp/kancelaria/C901", preset: "project", workspaceType: "local" },
  status: "ready",
  sessions: [
    { id: "ses_rodic", title: "Roztriediť doručenú poštu", time: { updated: 3 } },
    { id: "ses_sub", title: "Prečítať textové súbory M901 (@general subagent)", parentID: "ses_rodic", time: { updated: 4 } },
    { id: "ses_fork", title: "Roztriediť doručenú poštu (fork #1)", time: { updated: 2 } },
  ],
};

const render = () => renderToStaticMarkup(<ProjectSessionsPage workspaceId="ws-c901" group={group} statuses={{ ses_sub: "busy" }} onOpen={() => {}} onNew={() => {}} newDisabled={false} />);

afterEach(() => setLocale("en"));

describe("chaty klienta bez subagentov (N-A8-4)", () => {
  test("rozlíši chat subagenta od rozvetveného chatu podľa parentID", () => {
    expect(group.sessions.map(isListedClientChat)).toEqual([true, false, true]);
    expect(isListedClientChat({ parentID: "  " })).toBe(true);
  });

  test("stránka Chaty ukáže rodičovský aj rozvetvený chat, chat subagenta nie", () => {
    setLocale("sk");
    const html = render();
    expect(html).toContain("Roztriediť doručenú poštu");
    expect(html).toContain("Roztriediť doručenú poštu (fork #1)");
    expect(html).not.toContain("@general subagent");
    expect(html).not.toContain("Vetva");
  });
});
