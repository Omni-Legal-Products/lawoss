# Windows code signing for LAWOSS

The public Windows alpha uses Authenticode with a timestamp and the publisher **the Software s.r.o.** The signing request covers the final x64 or ARM64 NSIS installer. The workflow regenerates its blockmap, updater metadata and checksums after signing.

## Set up the SignPath project

1. In the company SignPath organization, open **Projects** and create a project named **LAWOSS**. Set the slug to `lawoss` and the repository URL to `https://github.com/Omni-Legal-Products/lawoss`.
2. In the project form, replace the entire artifact XML with the [installer XML](../scripts/release/signpath-windows-installer.xml) and choose **Create (add signing policy later)**. Keep the resulting artifact configuration slug for GitHub. Each job uploads one ZIP containing `lawoss-installer.exe`. This configuration needs no SignPath parameters. The Windows runner checks the matrix filename and PE product name and version before upload and restores the release filename after checking the returned EXE.
3. Link **GitHub.com** as a trusted build system. For GitHub audit verification, grant the official SignPath GitHub App access to the LAWOSS repository. [GitHub integration](https://docs.signpath.io/trusted-build-systems/github)
4. In **Certificates**, check that the organization has a publicly trusted Windows code-signing certificate identifying **the Software s.r.o.** If it needs to be issued or imported, complete that with the organization's administrator or certificate provider.
5. In **Signing policies**, configure `release-signing` for release signing with that certificate. Select the authorized approver and give the CI user submitter access. [Project and policy setup](https://docs.signpath.io/projects)

## Connect GitHub Actions

Once the release certificate and policy are ready, store the CI user's token in the repository Actions secret `SIGNPATH_API_TOKEN`. Set the following Actions variables to the values from the company project. Configure the project and artifact slugs last, before dispatching the build.

| Variable | Value |
| --- | --- |
| `SIGNPATH_ORGANIZATION_ID` | ID of the company organization containing LAWOSS |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Actual artifact configuration slug from SignPath |
| `SIGNPATH_PROJECT_SLUG` | `lawoss` |

Use the manual Windows alpha workflow in draft mode to verify signing. On Windows, verify each final installer with the repository checker.

```powershell
./scripts/release/verify-windows-signature.ps1 -ArtifactDirectory <signed-artifact-directory> -ExpectedPublisher "the Software s.r.o."
```

Complete the [native release acceptance](release-evidence.md) before publishing. Private unsigned builds for testers use the explicit internal draft option.
