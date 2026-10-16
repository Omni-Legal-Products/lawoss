import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FirmHubItem } from "@legalwork/types/firm-hub";
import type { McpStatus } from "../src/app/types";
import { FirmConnectorAccessSettings } from "../src/react-app/domains/settings/pages/firm-connectors";

const item: FirmHubItem = {
  id: "linear", kind: "mcp", name: "linear", description: "Manage your team's issues",
  installation: "automatic", added: false,
  connector: { serverName: "linear", url: "https://example.invalid/mcp", access: "oauth", keyName: null, hasOwnKey: false },
};
const noop = () => {};
function render(entry = item, status?: McpStatus, busy = false) {
  return renderToStaticMarkup(<FirmConnectorAccessSettings item={entry} status={status} busy={busy} onAddedChange={noop} onSignIn={noop} onManageKey={noop} />);
}

test("automatic OAuth access explains the required account without offering firm-managed switches", () => {
  const html = render();
  expect(html).not.toContain("Enable connector");
  expect(html).not.toContain("Use in chats");
  expect(html).toContain("Sign in with your Linear account");
  expect(html).toContain(">Sign in</button>");
  expect(html).not.toContain('role="switch"');
});

test("optional connectors require membership before any account action", () => {
  const optional = { ...item, installation: "optional" } satisfies FirmHubItem;
  const offered = render(optional);
  expect(offered).toContain("Enable connector");
  expect(offered).toContain('role="switch"');
  expect(offered).toContain('aria-checked="false"');
  expect(offered).not.toContain("Account access");
  expect(offered).not.toContain(">Sign in</button>");
  const added = render({ ...optional, added: true });
  expect(added).toContain('aria-checked="true"');
  expect(added).toContain(">Sign in</button>");
});

test("connected accounts and missing sign-in addresses do not offer misleading sign-in actions", () => {
  const connected = render(item, { status: "connected" });
  expect(connected).toContain("Signed in");
  expect(connected).not.toContain(">Sign in</button>");
  const unavailable = render({ ...item, connector: { ...item.connector!, url: null } });
  expect(unavailable).toContain("Your firm needs to provide a sign-in address");
  expect(unavailable).not.toContain(">Sign in</button>");
});

test("personal keys have distinct add and change actions, never an account sign-in", () => {
  const personalKey: FirmHubItem = { ...item, connector: { ...item.connector!, access: "member" } };
  const missing = render(personalKey);
  expect(missing).toContain("Add your personal API key");
  expect(missing).toContain(">Add your key</button>");
  expect(missing).not.toContain(">Sign in</button>");
  const saved = render({ ...personalKey, connector: { ...personalKey.connector!, hasOwnKey: true } });
  expect(saved).toContain("Your personal access key is saved.");
  expect(saved).toContain(">Change your key</button>");
});

test("firm-provided and open access never ask members for credentials", () => {
  const shared = render({ ...item, connector: { ...item.connector!, access: "firm" } });
  expect(shared).toContain("Your firm provides access");
  expect(shared).not.toContain("<button");
  const open = render({ ...item, connector: { ...item.connector!, access: "none" } });
  expect(open).toContain("No personal sign-in is required.");
  expect(open).not.toContain("<button");
});

test("connection and registration failures keep their explanation visible", () => {
  const failed = render(item, { status: "failed", error: "Service unavailable" });
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Issue");
  expect(failed).toContain("Service unavailable");
  const registration = render(item, { status: "needs_client_registration", error: "Client registration required" });
  expect(registration).toContain("Sign-in setup is incomplete");
  expect(registration).toContain("Client registration required");
});

test("pending changes disable membership and account actions and show progress", () => {
  const html = render({ ...item, installation: "optional", added: true }, undefined, true);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
  expect(html).toContain("animate-spin");
});
