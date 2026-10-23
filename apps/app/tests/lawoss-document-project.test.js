// LAWOSS: projekt úlohy pre editory dokumentov nájde aj chat prípadu (N-A2-1, 23. 10. 2026).
// Pred opravou schválené premenovanie v chate prípadu skončilo 500 „The task's project is unavailable“,
// lebo priečinok chatu (…/Spisy/M001) sa porovnával presne s koreňom klienta.
import { expect, test } from "bun:test";
import { findDocumentProject } from "../src/react-app/domains/session/artifacts/document-project";

const sessions = {
  ses_case: "/prax/C001 Tatran/Spisy/M001 Úhrada",
  ses_client: "/prax/C001 Tatran",
  ses_outside: "/prax/C0011 Iny/Spisy/M009",
};

function office(remote = []) {
  const workspaces = [
    { id: "ws_c001", path: "/prax/C001 Tatran" },
    { id: "ws_c017", path: "/prax/C017 Šimková" },
    { id: "ws_c0011", path: "/prax/C0011 Iny" },
  ];
  const endpointFor = workspace => ({
    workspaceId: workspace.id, isRemote: remote.includes(workspace.id),
    client: { baseUrl: "http://server", getSession: async (workspaceId, sessionId) => {
      const directory = sessions[sessionId];
      // Server: rozhovor patrí priestoru, ktorého koreň obsahuje jeho priečinok (session-ownership.ts).
      if (!directory || !(directory === workspace.path || directory.startsWith(`${workspace.path}/`))) throw new Error(`404 session_not_found ${workspaceId}`);
      return { item: { id: sessionId, directory } };
    } },
  });
  return { workspaces, endpointFor };
}

test("chat prípadu v podpriečinku klienta patrí klientovi", async () => {
  const { workspaces, endpointFor } = office();
  expect(await findDocumentProject("ses_case", workspaces, endpointFor)).toMatchObject({ projectId: "ws_c001", workspaceId: "ws_c001", workspaceRoot: "/prax/C001 Tatran", isRemoteWorkspace: false });
  expect((await findDocumentProject("ses_client", workspaces, endpointFor)).projectId).toBe("ws_c001");
});

test("priečinok, ktorý len začína rovnako ako koreň klienta, nepatrí klientovi", async () => {
  const { workspaces, endpointFor } = office();
  // Priestor C001 nie je predponou C0011: cudzí rozhovor nesmie skončiť pri C001.
  expect((await findDocumentProject("ses_outside", workspaces, endpointFor)).projectId).toBe("ws_c0011");
  const lying = workspace => ({ ...endpointFor(workspace), client: { baseUrl: "http://server", getSession: async () => ({ item: { id: "ses_x", directory: "/prax/C001 Tatran/../C017 Šimková" } }) } });
  await expect(findDocumentProject("ses_x", workspaces.slice(0, 1), lying)).rejects.toThrow("The task's project is unavailable");
});

test("neznámy chat ostáva nedostupný", async () => {
  const { workspaces, endpointFor } = office();
  await expect(findDocumentProject("ses_none", workspaces, endpointFor)).rejects.toThrow("The task's project is unavailable");
});
