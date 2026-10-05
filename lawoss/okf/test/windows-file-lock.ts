import { spawn } from "node:child_process";

/**
 * Windows: podrží súbor otvorený v samostatnom PowerShelli tak, ako ho drží iný program.
 * `None` = bez zdieľania (Outlook, antivírus), `Read` = ostatní smú čítať, nie zapisovať
 * ani mazať (Word s otvoreným dokumentom). Vráti funkciu, ktorá zámok uvoľní.
 * Studený štart powershell.exe na windows-2022 trvá aj niekoľko sekúnd: test, ktorý zámok
 * drží, potrebuje vlastný timeout (60 s), predvolených 5 s z bun test nestačí.
 */
export async function holdWindowsFileLock(path: string, share: "None" | "Read" = "None"): Promise<() => Promise<void>> {
  // `Stop`: výnimka z [IO.File]::Open ukončí skript; inak by PowerShell pokračoval a vypísal `locked` bez zámku.
  const script = `$ErrorActionPreference = 'Stop'; $f = [IO.File]::Open('${path.replace(/'/g, "''")}', 'Open', 'ReadWrite', '${share}'); [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Seconds 120`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    let out = "", err = "";
    // Bez zámku do 30 s PowerShell ukonči, inak by bežal ďalej až do konca Start-Sleep.
    const timer = setTimeout(() => { child.kill(); reject(new Error(`PowerShell did not lock ${path}: ${err}`)); }, 30_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", chunk => { out += String(chunk); if (out.includes("locked")) { clearTimeout(timer); resolve(); } });
    child.stderr.on("data", chunk => { err += String(chunk); });
    void exited.then(() => { clearTimeout(timer); reject(new Error(`PowerShell exited before locking ${path}: ${err}`)); });
  });
  return async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; };
}
