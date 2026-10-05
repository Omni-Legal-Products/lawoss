import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Skutočný Windows PowerShell 5.1 (`powershell.exe`, nie `pwsh`) — práve ten
 * zapisuje „UTF-8 s BOM“ a UTF-16LE. Testy s ním bežia iba na Windows.
 */
export const hasWindowsPowerShell = process.platform === "win32";

/**
 * Časový limit testu s `powershell.exe`. Bun má predvolene 5 s aj pre synchrónny
 * test a proces po ňom zabije; studený štart PowerShellu 5.1 na windows-2022
 * trvá sekundy a test ho spúšťa viackrát. `node:test` limit nemá.
 */
export const WINDOWS_POWERSHELL_TIMEOUT_MS = 60_000;

/** Reťazec ako literál PowerShellu v jednoduchých úvodzovkách. */
export const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** `-EncodedCommand` je UTF-16LE, takže diakritika ani úvodzovky neprejdú cez kódovú stránku konzoly. */
export function runWindowsPowerShell(script: string): string {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, "utf16le").toString("base64"),
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`powershell.exe skončil kódom ${result.status}: ${result.stderr}`);
  return result.stdout;
}

/** Ako súbor zapíše advokát alebo agent v PowerShelli 5.1; `Set-Content` bez -Encoding píše ANSI. */
export type PowerShellWrite = "Set-Content -Encoding UTF8" | "Set-Content" | "Out-File" | ">";

/** Zapíše riadky zvoleným spôsobom a vráti bajty, ktoré naozaj vznikli. */
export function writeWithWindowsPowerShell(path: string, lines: readonly string[], how: PowerShellWrite): Buffer {
  const value = `@(${lines.map(psQuote).join(", ")})`;
  const target = psQuote(path);
  runWindowsPowerShell(
    how === ">" ? `${value} > ${target}`
      : how === "Out-File" ? `${value} | Out-File -FilePath ${target}`
        : `Set-Content -LiteralPath ${target} -Value ${value}${how === "Set-Content" ? "" : " -Encoding UTF8"}`,
  );
  return readFileSync(path);
}
