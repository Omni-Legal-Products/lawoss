# OneDrive startup downloads — 19 October 2026

Confirmed with the real Microsoft OneDrive client and a signed-in test account containing only synthetic documents. LegalWork 0.2.10 downloaded all ten documents in a project when its initial document-sharing scan ran. An unregistered control folder stayed online-only. No agent prompt or document open was needed.

## Cause and policy

Project sharing starts background document sync shortly after server startup. New files and files with changed metadata are opened to calculate SHA-256. Reading an online-only OneDrive placeholder downloads it. A saved, matching baseline avoids that read; evicting already-agreed files and restarting did not reproduce another download in this test.

The product policy for this fix is: **document sharing cannot be enabled for cloud-backed local project folders; link a Cloud Folder instead.** This applies regardless of whether the documents are currently downloaded. Opening a cloud document later does not opt it into Eigenwelt document sharing.

The restriction applies to existing projects whose saved settings still enable documents. Their effective local Documents setting is off, the sharing dialog explains why, and the API rejects enabling it. Existing local files and previously uploaded remote copies are not deleted. Notes, recordings, review results, tasks, calendar entries and project details retain their separate sharing choices. Reviews and calendar attachments cannot pull ordinary project documents back into file sharing. Notes and recordings remain file-backed app content; the guard does not disable those separate scopes.

The earlier per-file deferral experiment has been replaced by this folder policy. There is no per-placeholder availability helper or online-only pending queue in the final change.

## Detection and enforcement

On Windows, `isCloudFolder` first reads the current user’s [registered provider roots](https://learn.microsoft.com/en-us/windows/win32/shell/integrate-cloud-storage), then calls [CfGetSyncRootInfoByPath](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfgetsyncrootinfobypath) for basic sync-root metadata. This identifies registered cloud roots and nested project folders without enumerating documents or relying on folder names or hydration flags. OneDrive's root and two nested folders returned success; ordinary local folders returned `ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT`. Failures in the native target-folder probe still stop that attempt. Supplemental provider-settings failures are isolated so an unrelated broken configuration does not stop ordinary sync; [follow-up details](cloud-folder-detection-errors.md). A volume that reports CFAPI as unsupported is not itself evidence of cloud storage; registered roots and known client configuration are checked first. This also lets ordinary local folders work on clean Windows installations without a cloud filter attached.

The same policy now uses client metadata for other common providers. It never searches for provider names in project paths and never reads project documents to classify a folder. Configured roots and their nested projects remain blocked even when fully downloaded. Directory links are resolved; boundary checks keep similarly named siblings shareable.

| Provider | Windows detection | macOS detection | Linux detection |
| --- | --- | --- | --- |
| OneDrive / SharePoint | Registered Windows cloud root | File Provider root | — |
| Google Drive | Live DriveFS mount registrations; configured policy/user/machine mount | File Provider root; legacy `dfsfuse_DFS` filesystem | — |
| Dropbox | Registered cloud root; both documented `info.json` locations, including moved personal/work roots | File Provider root; `~/.dropbox/info.json` | `~/.dropbox/info.json` |
| Box Drive | Installed-client metadata plus default/custom Box root; registered cloud root | File Provider root | — |
| iCloud Drive | Registered Windows cloud root | File Provider root or standard iCloud Drive root | — |
| Nextcloud / ownCloud | Configured sync roots; registered cloud root | Configured sync roots, including sandboxed Nextcloud; File Provider root | Configured sync roots, respecting XDG config location |
| Other providers | Any registered Windows provider/CFAPI cloud root | Any provider in standard `Library/CloudStorage` | — |

Dropbox root discovery follows its [documented `info.json` interface](https://help.dropbox.com/installs/locate-dropbox-folder). Google’s [mount configuration](https://knowledge.workspace.google.com/admin/drive/advanced-drive-for-desktop-configuration) includes custom paths and drive letters; policy overrides user and machine defaults. Its live `DriveFS/Share` registrations are also inspected for actual/account mounts, but that internal interface is not guaranteed by Google. Legacy macOS filesystem identification follows [Chromium’s Google Drive classification](https://chromium.googlesource.com/experimental/chromium/src/+/refs/tags/78.0.3896.3/chrome/browser/chrome_browser_main_mac.mm). Box’s custom parent follows its [documented registry setting](https://support.box.com/hc/en-us/articles/360043697454-Configuring-the-Default-Box-Drive-Folder-Location-Windows-Only). Nextcloud and ownCloud roots are read from their documented user INI files, using only account folder `localPath` values: [Nextcloud locations](https://docs.nextcloud.com/server/latest/user_manual/ar/desktop/configfile.html), [ownCloud locations](https://doc.owncloud.com/desktop/6.0/advanced_usage/configuration_file.html).

This is not universal detection of every sync client or arbitrary backup job. In particular, fully local Google Drive mirrored/backup folders without an OS or mount registration, legacy Box Sync, third-party Linux cloud mounts and unsupported client layouts remain outside automatic detection. Google’s internal live registration needs verification against current signed-in clients; synthetic registry fixtures alone do not establish that every current client writes it. These limits must not be presented as tested provider coverage.

`projectSyncStatus` returns the effective Documents setting and `fileSharingDisabledReason: "cloud_folder"`. The UI locks the Documents switch off, shows “File sharing cannot be enabled for cloud folders. Link a Cloud Folder instead.”, and labels reviews without promising included documents. Saving settings through the API with Documents enabled returns HTTP 409 / `project_sync_cloud_folder`.

The background round independently enforces the policy, including old stored settings. If no note or recording files are in scope, the file engine exits before scanning. Otherwise only those file-backed scopes are eligible; reviewed documents and calendar attachments do not broaden them. Access-revocation checks apply the same document restriction. The remote reconciliation checkpoint is not advanced while cloud document sharing is blocked, so moving the project to an ordinary local folder does not miss changes that arrived meanwhile.

## Real OneDrive verification

Environment: isolated GCloud Windows Server 2022 VM; Microsoft OneDrive **26.178.0913.0007**; Electron **43.7.5 / Node 24.21.0**. The reported customer OS was Windows 11 and was not tested directly.

The signed-in OneDrive account had 21 synthetic originals: ten in the registered Corporate project and eleven in an unregistered Litigation control. Availability was checked through metadata-only Windows Offline/RecallOnDataAccess attributes. The actual LegalWork desktop app and managed OpenCode engine ran in the interactive session. OneDrive's client and cloud were real; the Eigenwelt project-sharing endpoint was a **local synthetic HTTP service**, not production.

| Operation | Original documents downloaded | File-sharing requests |
| --- | ---: | --- |
| Released, unshared startup and restart | 0 / 21 | None |
| Released, initial shared startup | **10 / 21**, all in the registered project | 10 file commits |
| Released, evict and restart with saved baseline | 0 / 21 | No further file commits |
| Folder-policy fix, existing saved Documents=true | **0 / 21** | No file listing or commits |
| Folder-policy fix, warm restart | **0 / 21** | No file listing or commits |
| Folder-policy fix, explicitly read one document | **1 / 21**, only the deliberately read file | Still no file listing or commits |

This real-cloud run used folder-policy revision `4bead9f8`, before the broader provider detection extension. The subsequent provider extension was tested with configuration fixtures and native Windows calls as described below.

The fixed desktop API returned Documents=false and the cloud-folder reason; attempts to enable it returned 409. Pending changes remained zero. The deliberately read file was not uploaded afterward, unlike the abandoned per-file deferral experiment.

The released shared startup began at 17:17:04 UTC; first hydration was observed at 17:17:17 UTC. No agent message was sent. Unshared startup also created 27 support files, about 3.4 MB, which OneDrive can upload; that is distinct from downloading original documents.

For the fixed Windows test, the compiled server modules were inserted into the release ASAR, using the official development Electron executable of the same version because the release executable validates its archive hash. This does not validate a newly packaged production installer. The sharing UI was exercised separately in a local browser fixture rendering the actual product component with cloud/local status responses: cloud Documents was disabled and off; ordinary local Documents remained enabled; Notes could still be changed. The fixture made no production sharing changes.

See [`evidence/onedrive`](../../evidence/onedrive) for machine-readable observations and the sharing-dialog screenshot. All fixture data and identifiers are synthetic.

### Repeat with a test account

1. Register one OneDrive folder as a LegalWork project; keep a second folder unregistered as a control. Use an isolated profile and a test sharing service/account.
2. Choose OneDrive's **Free up space**. Wait for the Offline/RecallOnDataAccess attributes; removing the pinned flag alone does not prove eviction is complete.
3. On 0.2.10, enable document sharing with an empty baseline and restart. Observe downloads without sending a prompt.
4. With the fix, restart with the old saved Documents=true setting. Expect no original downloads, file listing, uploads or deferred backlog.
5. Open sharing settings: Documents must be disabled/off with the Cloud Folder explanation. A direct API request enabling Documents must return 409.
6. Restart, then explicitly open one document. Only that file should download; it must remain excluded from Eigenwelt document sharing.
7. Check an ordinary local project: document sharing remains available. Check notes and review-result sharing separately; review source documents must stay excluded on a cloud project.

## Other-provider detection verification

The extension passed **25 native Windows checks** on a fresh isolated Windows Server 2022 VM using the compiled detector and actual PowerShell, registry and CFAPI calls. Client registrations/configuration were synthetic; no Google Drive, Dropbox, Box, Nextcloud or ownCloud account was signed in. Cases cover multi-account/moved roots, drive letters, nested custom mount paths, configuration precedence, environment expansion, stopped clients, ordinary local folders, sibling-prefix exclusions, literal PowerShell characters and corrupt configuration. See [`provider-detection-results.json`](../../evidence/onedrive/provider-detection-results.json), including tested source hashes.

A clean Windows volume returned `ERROR_INVALID_FUNCTION` from CFAPI even with the cloud service installed: no cloud filter was attached there. The detector handles that unsupported-volume result after checking registered provider roots and client metadata; it does not disable sharing for every ordinary local project. Native target-probe failures still report errors. Optional provider-settings failures no longer abort other checks; [follow-up details](cloud-folder-detection-errors.md).

To repeat on an **isolated Windows test machine as administrator**, build the server with `pnpm --filter legalwork-server build`, then run `node scripts/diagnostics/cloud-folder-providers-windows.mjs`. The harness refuses pre-existing Google/Box settings, creates synthetic roots/configuration, and removes its own registry entries and temporary files in `finally`. Do not run it in a signed-in production user profile. macOS/Linux configuration fixtures and path-boundary tests run in `cloud-folder.test.ts`. The existing project-sharing tests independently check that a detected cloud folder locks Documents off, rejects API re-enablement and blocks background document copying.

The additional asynchronous inspection also exposed a scheduling race in the existing “keep projects apart” action: its immediate background round could start before the action returned status. Status is now awaited before scheduling; the regression forces a slow detector and checks the caller can run the intended round successfully.

## Checks and remaining limits

- `pnpm exec bun test apps/server/src/cloud-folder.test.ts apps/server/src/project-file-sync.test.ts apps/server/src/project-sync.test.ts apps/server/src/project-review-sync.test.ts apps/server/src/file-storage/project-folders.test.ts` — 76 passed, 353 assertions (including the follow-up settings-error regressions).
- `pnpm --filter legalwork-server build` — passed.
- `pnpm --filter @legalwork/app typecheck` — passed.
- `pnpm --filter @legalwork/app test:i18n` — passed, 6832 keys in both shipped languages.
- `git diff --check` — passed.

The affected user's exact local project paths were not recorded in the production project records, so the reproduction confirms this mechanism rather than identifying every affected folder on his computer. Uploaded-row counts do not measure how many files were scanned or read. This path cannot explain unrelated folders downloading outside configured project roots. Only OneDrive was integration-tested with a signed-in provider. Other-provider root detection uses configuration fixtures; see the coverage matrix and limits above.

The restriction is local to the cloud-backed computer; it does not rewrite the shared project’s global remote scope. Other members using ordinary local copies can still sync previously shared documents. No project-wide migration is introduced.

The separate FFF-disable change does not affect this sharing scan. [OpenCode v1.18.29 already disables FFF by default on Windows](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/flag/flag.ts#L34).
