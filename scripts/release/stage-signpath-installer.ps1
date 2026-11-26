param(
    [Parameter(Mandatory)][ValidateSet('Upload', 'Restore')][string]$Mode,
    [Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Architecture
)

$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath apps/desktop/package.json -Raw | ConvertFrom-Json).version
$name = "lawoss-win-$Architecture-$version.exe"
$dist = 'apps/desktop/dist-electron'
$installers = @(Get-ChildItem -LiteralPath $dist -File -Filter 'lawoss-win-*.exe')
if ($installers.Count -ne 1 -or $installers[0].Name -cne $name) {
    throw "Expected exactly one installer named $name."
}
if ($Mode -eq 'Upload') {
    $directory = Join-Path $env:RUNNER_TEMP 'signpath-unsigned'
    $null = New-Item -ItemType Directory -Path $directory -ErrorAction Stop
    $installer = $installers[0]
} else {
    $directory = Join-Path $env:RUNNER_TEMP 'signpath-signed'
    $returned = @(Get-ChildItem -LiteralPath $directory -File -Recurse)
    if ($returned.Count -ne 1 -or $returned[0].Name -cne 'lawoss-installer.exe') {
        throw 'Expected one signed lawoss-installer.exe from the signing request.'
    }
    $installer = $returned[0]
}
if ($installer.VersionInfo.ProductName -cne 'LAWOSS' -or $installer.VersionInfo.ProductVersion -cne $version) {
    throw "Unexpected installer product or version for $name."
}
if ($Mode -eq 'Upload') {
    Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $directory 'lawoss-installer.exe')
} else {
    Rename-Item -LiteralPath $installer.FullName -NewName $name
}
