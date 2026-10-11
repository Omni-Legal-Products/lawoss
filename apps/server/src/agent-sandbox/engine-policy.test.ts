import { expect, test } from "bun:test";
import { managedNetworkGuard, managedPermissionRules, sandboxEngineAgents, sandboxEnginePermissions } from "./engine-policy.js";

test("the protected tool keeps shell permissions while the host shell stays denied", () => {
  expect(sandboxEnginePermissions({ "*": "allow", bash: "ask", edit: "deny" }))
    .toEqual({ "*": "allow", edit: "deny", legalwork_shell: "ask", bash: "deny", webfetch: "deny", websearch: "deny" });
});

test("custom and built-in agents cannot restore the host shell", () => {
  const agents = sandboxEngineAgents({ custom: { permission: { "*": "allow", bash: "allow" } } });
  for (const agent of Object.values(agents)) expect(agent.permission).toHaveProperty("bash", "deny");
  expect(agents.custom.permission).toHaveProperty("legalwork_shell", "allow");
  expect(agents.plan).toBeDefined();
});

test("managed web tools retain permission rules while built-in network routes stay denied", () => {
  expect(sandboxEnginePermissions({ webfetch: { "*": "ask", "https://private/*": "deny" }, websearch: "deny" }))
    .toMatchObject({ webfetch: "deny", websearch: "deny", legalwork_webfetch: { "*": "ask", "https://private/*": "deny" }, legalwork_websearch: "deny" });
});

test("existing chat web restrictions survive the managed tool migration", () => {
  const agent = [{ permission: "webfetch", pattern: "*", action: "deny" }, { permission: "legalwork_webfetch", pattern: "*", action: "allow" }];
  const old = [{ permission: "webfetch", pattern: "https://private/*", action: "deny" }];
  expect(managedPermissionRules(agent, old)).toEqual([{ permission: "webfetch", pattern: "*", action: "allow" }, ...old]);
  const guarded = [{ permission: "legalwork_webfetch", pattern: "https://private/*", action: "deny" },
    { permission: "webfetch", pattern: "*", action: "deny" }, { permission: managedNetworkGuard, pattern: "*", action: "deny" }];
  expect(managedPermissionRules(agent, guarded)).toEqual(managedPermissionRules(agent, old));
});

test("legacy shell restrictions survive migration, including scoped and ask rules", () => {
  const agent = [{ permission: "bash", pattern: "*", action: "deny" }, { permission: "legalwork_shell", pattern: "*", action: "allow" }];
  for (const action of ["deny", "ask"]) {
    const legacy = [{ permission: "bash", pattern: "*", action }];
    expect(managedPermissionRules(agent, legacy)).toEqual([{ permission: "bash", pattern: "*", action: "allow" }, ...legacy]);
  }
  const scoped = { permission: "bash", pattern: "rm *", action: "deny" };
  expect(managedPermissionRules(agent, [scoped, { permission: managedNetworkGuard, pattern: "*", action: "deny" }])).toContainEqual(scoped);
  expect(managedPermissionRules(agent, [
    { permission: "legalwork_shell", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: managedNetworkGuard, pattern: "*", action: "deny" },
  ])).toEqual([{ permission: "bash", pattern: "*", action: "allow" }, { permission: "bash", pattern: "*", action: "deny" }]);
});
