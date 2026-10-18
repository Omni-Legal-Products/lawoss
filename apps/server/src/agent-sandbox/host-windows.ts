/** Windows PowerShell started through Node/Bun otherwise inherits PowerShell
 * 7's incompatible module paths. Let it reconstruct its native defaults.
 * https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_psmodulepath#starting-windows-powershell-from-powershell-7 */
export function windowsHostEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => name.toLowerCase() !== "psmodulepath"));
}

/** The bundled native supervisor owns descendant cleanup. Keep error status
 * in the command's own scope because PowerShell resets $? after script blocks. */
export function windowsHostScript(command: string): string {
  const exitStatus = `
$succeeded = $?
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
if (-not $succeeded) { exit 1 }
`;
  // Resolve core cmdlets directly. Automatic module discovery can scan every
  // installed third-party module before finding even echo or Start-Process.
  return `Import-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Utility'), ($PSHOME + '\\Modules\\Microsoft.PowerShell.Management') -ErrorAction Stop
$ErrorActionPreference = 'Continue'
& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(command + "\n" + exitStatus).toString("base64")}'))))
${exitStatus}`;
}
