param(
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or !$env:RUNNER_TEMP -or !$IsWindows) {
  throw 'Real installer probe requires a disposable GitHub-hosted Windows runner'
}
$nativeArch = (node -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $nativeArch -ne $Arch) { throw 'Native Windows target differs' }
$version = (node -p "require('./apps/desktop/package.json').version").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read source package version' }
$head = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify exact checkout' }
$asset = (Resolve-Path -LiteralPath "apps/desktop/dist-electron/lawoss-win-$Arch-$version.exe").Path
$assetHash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
$scratch = Join-Path $env:RUNNER_TEMP ('lawoss-real-nsis-' + [guid]::NewGuid().ToString('N'))
$installed = Join-Path $scratch 'installed'
if ($installed -match '["\r\n]') { throw 'Unsupported NSIS destination' }
New-Item -ItemType Directory -Path $scratch | Out-Null
$archiveTool = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
if (!(Test-Path -LiteralPath $archiveTool -PathType Leaf)) { throw 'Full 7-Zip with NSIS support is required' }
$env:ELECTRON_BUILDER_7ZIP_PATH = $archiveTool
# NSIS /D must be last and unquoted, including paths containing spaces.
# https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage
$installer = Start-Process -FilePath $asset -ArgumentList "/S /currentuser /D=$installed" -PassThru
try {
  if (!$installer.WaitForExit(180000)) { throw 'Actual NSIS installer exceeded its time budget' }
  $installer.Refresh()
  if ($installer.ExitCode -ne 0) { throw 'Actual NSIS installer failed' }
} finally {
  $installer.Dispose()
}
# The disposable runner owns registry/shortcut/cache teardown and failed process
# cleanup. This probe makes no process-closure or native journey assertion.
@'
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateBuildInfo } from './apps/desktop/electron/build-info.mjs';
import { verifyNsisInstallation } from './lawoss/testing/alpha/nsis-artifact.mjs';
const [asset, installed, arch, assetSha256, gitSha, version, output] = process.argv.slice(2);
const build = validateBuildInfo(JSON.parse(await readFile(join(installed, 'resources/build-info.json'), 'utf8')));
assert.equal(build.gitSha, gitSha);
assert.equal(build.version, version);
assert.equal(build.platform, 'win32');
assert.equal(build.arch, arch);
const installation = await verifyNsisInstallation({ asset, installedApp: join(installed, 'LAWOSS.exe'), arch, expectedSha256: assetSha256 });
await writeFile(output, JSON.stringify({
  kind: 'lawoss-real-nsis-installed-tree', status: 'verified', releaseEligible: false,
  build, installation, installerExitCode: 0, journeys: 'not-performed',
  processClosure: 'not-asserted', cleanup: 'disposable-runner-teardown',
}, null, 2) + '\n', { flag: 'wx' });
console.log('PASS real final NSIS installation and exact installed bytes; native journeys not performed');
'@ | node --input-type=module - $asset $installed $Arch $assetHash $head $version $Output
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
