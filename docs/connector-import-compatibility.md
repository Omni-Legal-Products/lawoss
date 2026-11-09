# Connector import compatibility

Updated against the current ChatGPT/Codex and Claude formats on 19 October 2026 and LegalWork's bundled OpenCode 1.18.29 engine.

Importing a definition does not transfer the original application's provider identity, account session, network access or administrator approvals. ChatGPT's registered apps are distinct from portable MCP definitions; their availability and account authorization are controlled by the ChatGPT workspace. [ChatGPT connected apps](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt).

## Decisions before installation

The import review checks each connector on the LegalWork server, then shows **Can import**, **Setup required**, or **Cannot import**, with an actionable reason. A standalone unavailable connector cannot be installed. A mixed plugin offers **Import supported items**; excluded connectors are absent from active configuration and remain listed with their reasons inside plugin details and the import report. Instructions that refer to excluded connectors may still require adapting or a separately configured alternative.

The server enforces the reviewed result rather than accepting a client-supplied compatibility claim. Preparation expires after 15 minutes and is bound to the source digest, workspace, scope and existing owned connector setup. Changed source/setup, server restart or cache eviction requires another review. Recheck repeats the checks while retaining a successfully registered client; concurrent previews share preparation. Network work, connector count and retained preparation size are bounded.

## Format and authentication matrix

| Source requirement | Import decision |
| --- | --- |
| HTTP / Streamable HTTP / SSE | Check the exact declared endpoint and its authentication metadata. A JSON/HTML success page does not count as an HTTP MCP handshake. OAuth on a legacy SSE-only endpoint is blocked because the engine's sign-in flow requires Streamable HTTP. |
| Local stdio program | Check for an executable on the LegalWork server or in the preserved package. Never execute it during review. Missing programs block import until installed; script dependencies still need configuration. |
| WebSocket, SDK host or remote executor | Block. These require a runtime LegalWork cannot reproduce. |
| Bearer, Basic or custom-header API key | Preserve the header scheme and collect missing values in the existing masked setup form. Import review uses anonymous discovery and does not transmit source credentials. |
| Automatic OAuth / DCR | Check discovery and actually register LegalWork. Provider refusal blocks import. Retain the resulting identity on the server and install it with the checked callback, so connecting does not register a second client. |
| Provided OAuth client | Preserve identity, secret and callback. Public clients and `client_secret_post` are representable. Collect a missing required secret; account approval and registered callback acceptance still require sign-in. |
| CIMD / client metadata identity | Prefer verified operator-owned metadata (`LEGALWORK_MCP_CLIENT_METADATA_URL`) when the provider supports it. Require the exact client ID and callback and public-client authentication. Otherwise use checked DCR where supported; CIMD-only providers without a configured LegalWork identity stay blocked. Foreign app identities are never reused. |
| Custom discovery/endpoints, OIDC overrides, JWT or explicit `client_secret_basic` | Block instead of silently dropping the requirement. These settings are not expressible in the shipped engine configuration. |
| Claude pinned `oauth.scopes` | Block. The real engine regression demonstrates that provider-advertised scopes can replace the configured scope. Other scope exports that differ from advertised permissions also block. |
| Dynamic credential scripts / ChatGPT session authentication | Block. Original-app scripts and sessions are not available in LegalWork. |
| Environment variables, URL templates, user configuration placeholders | Preserve missing values for setup; do not read another app's environment or keychain. Platform runtime substitutions that LegalWork cannot provide are blocked. |

OpenAI's portable auth declaration distinguishes API keys, provided clients, DCR and CIMD. Codex also supports environment-backed headers and registration/callback settings. [OpenAI plugin format](https://developers.openai.com/plugins/build/plugins), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Claude distinguishes public/confidential clients, metadata overrides, pinned scopes, dynamic header scripts and local/remote transports. Its client secrets can be stored separately from the exported definition. [Claude MCP configuration](https://code.claude.com/docs/en/mcp), [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

The runtime contract was checked against its [OAuth provider](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/mcp/oauth-provider.ts), [connection implementation](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/mcp/index.ts) and [callback listener](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/mcp/oauth-callback.ts). Loopback callbacks retain their host/path; Codex portless IPv4 callbacks use the configured/default local listener port. Claude provided-client callback ports retain its localhost `/callback` convention. External callbacks are blocked.

## Provider and network restrictions

**Figma hosted MCP:** Figma requires an approved client. LegalWork/OpenCode is not currently listed in its catalog. Automatic hosted imports are therefore blocked with a provider documentation link. A supplied or previously configured client can proceed to a qualified sign-in check; its actual approval cannot be proved without authorization. The separately configured desktop connector is an alternative, not an automatic URL replacement. [Remote installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), [approved client catalog](https://www.figma.com/mcp-catalog/).

**GitHub:** a bare hosted definition receives GitHub's documented PAT setup when it does not declare its own OAuth application. Explicit OAuth or credential settings remain authoritative. The review explains token approval and server IP requirements. It does not reuse Claude's or ChatGPT's GitHub session. [GitHub host authentication](https://github.com/github/github-mcp-server#install-in-other-mcp-hosts).

**Context7:** automatic registration retains the localhost callback required by its authorization implementation. [Context7 OAuth implementation](https://upstash.com/blog/mcp-oauth-implementation).

Reachability and access checks run from the actual LegalWork server, which may have a different outbound IP from ChatGPT or Claude. An unchallenged 403 is an access refusal, not automatically a missing password or proof of an IP block. Registration errors naming allowlists receive that explanation; temporary errors offer recheck. Credential-protected services cannot have account-specific restrictions verified anonymously, and review says so. For example, GitHub filters authenticated API access through enterprise IP policy. [GitHub enterprise IP restrictions](https://docs.github.com/en/enterprise-cloud%40latest/admin/configuring-settings/hardening-security-for-your-enterprise/restricting-network-traffic-to-your-enterprise-with-an-ip-allow-list).

Import review validates transport and setup feasibility. Account permissions, subscription/seat requirements, credential validity, authenticated network restrictions and individual tool behavior still require a successful connection. It does not claim every provider has been tested with a real account.

See [the import lifecycle](plugin-import-lifecycle.md) for versioned portable schema checks, dependency requirements and source/update tracking.

## Evidence

The regression suite covers both source formats, blocked transports/auth, remote refusal and retry, DCR reuse, CIMD fallback, scope expansion, missing programs, credential confidentiality, source/setup changes, forged review IDs, partial import persistence and rollback. A real OpenCode OAuth regression completes PKCE and token exchange using import-prepared registration without a second DCR. Native Electron verified the blocked Figma review, qualified registered-client review, GitHub token requirements and the mixed-plugin action.
