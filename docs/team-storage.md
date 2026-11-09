# Team file storage

Admins can add a connection for the firm in Settings → Integrations → File storage, promote an existing personal connection with **Make available to team**, or manage the same catalog in the platform's File storage page. Members receive the connections automatically; no installation is required. All seven providers use the same catalog and existing agent tools.

The platform owns configuration, credentials, permissions and revisions. LegalWork holds team credentials in memory, renews authorization on a 30-second lease and discards them after a failed sync, sign-out or firm switch. Enabled roots refresh every 30 seconds while the view is open. Credential updates, pauses, read-only changes and removals propagate through the same feed. Previously downloaded workspace copies remain local.

Files travel directly between the member's app and the connected storage. Internal network shares still require the member's device to have network/VPN access. Personal connections remain local and independent.

## Rollout

Deploy the platform storage API and database migration first. It requires the platform's existing versioned `HUB_SECRET_ENC_KEY` key ring. Team storage is gated by the `admin_hub` entitlement, and only current firm admins can change the catalog. Team synchronization ships with the file storage integrations.

## Verification

- `pnpm --filter legalwork-server test`: 607 passed, 17 optional tests skipped.
- `pnpm --filter @legalwork/app test`: 413 passed.
- Server/app type checks and builds, and `pnpm --filter @legalwork/app test:i18n`: passed.
- Platform integration suite plus `scripts/storage-fixtures/team-sync-check.ts`: real PostgreSQL migrations, encrypted storage, desktop tokens, two LegalWork workspace identities and a disposable MinIO bucket. Verified admin configuration, member auto-sync, agent list/search/read/write, read-only propagation and removal. Clerk's external membership service is substituted in this isolated test.

Run the cross-project test from the platform checkout with `TEST_DATABASE_URL`, `LEGALWORK_TEAM_SYNC_CHECK` pointing to this checkout's `scripts/storage-fixtures/team-sync-check.ts`, and optionally `LEGALWORK_BUN_BIN`; then `pnpm --filter platform test:integration`. MinIO defaults to the storage fixture on port 19290. Override it using `STORAGE_TEST_S3_ENDPOINT`, `STORAGE_TEST_S3_ACCESS_KEY` and `STORAGE_TEST_S3_SECRET_KEY`.

UI checks use synthetic catalog responses; the cross-project test exercises the actual APIs. Visual evidence is kept outside the source changes.

## Google and Microsoft team storage

Google Drive, OneDrive for work or school, OneDrive Personal and SharePoint offer two modes per
team entry. **Each member signs in** shares the location and policy; LegalWork
reuses the member's single connector account, including own-app OAuth. **Use a
shared team account** explicitly delegates the connected account to the firm.
Admins can authorize a new managed account on the platform, or share an existing
managed account/folder from LegalWork. Own-app accounts support member sign-in;
shared-account delegation requires Nango-managed authentication.

The platform stores the Nango connection reference and its verified authorizing
user inside the existing encrypted storage record. References never appear in
catalog or desktop-sync responses. Only a current, entitled firm's desktop can
request a short-lived provider token from `POST /api/storage-connections/:id/token`.
The endpoint verifies the entry's enabled state and revision, verifies Nango's
ownership/provider tags, and checks the revision again after fetching credentials.
Browser sessions cannot retrieve tokens. Admins alone can create, change or
reconnect a shared account. Removing a share does not disconnect an account that
may still be used personally or by another folder view.

The desktop uses the same native adapters, Memory Drive sidebar and agent tools.
Member mode never falls back to an admin's account; shared-account mode never
looks up the member's personal account. Multiple locations reuse one account.
Write operations require the team entry's permission, the desktop's per-provider
write switch, and the provider's granted permission. Folder IDs and Microsoft
library/drive IDs identify the selected location consistently across members.
Google folder links are also accepted. Optional and automatic installations use
the existing team installation policy. Personal account isolation is retained.

Files travel directly between the device and Google/Microsoft. Nango and the
platform handle authorization only. Folder/read-only restrictions apply inside
LegalWork, not to a provider bearer token used outside it. Use a dedicated company
account with appropriate provider permissions for shared-account mode. Existing
access tokens can remain valid until provider expiry after unsharing; the platform
stops issuing further tokens, and LegalWork renews its team authorization lease
within 30 seconds. Previously downloaded local copies remain local.

Deploy model-api before shipping the desktop changes. No database migration or
new Nango API-key permission is needed. Updated desktops send
`X-LegalWork-Storage-Capabilities: native-cloud-sharing-v1`; older desktops do not
receive these entries, so adding a cloud share cannot break their storage feed.
No account enumeration, background Nango discovery, content proxy or sync is added.

Verification uses synthetic provider responses and disposable PostgreSQL firms;
no real account was delegated. Screenshots are kept outside the repositories.
