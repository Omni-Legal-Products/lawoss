import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { app } from "electron";

const require = createRequire(import.meta.url);

// 🟡 LAWOSS: signál 0 proces neukončí, len overí, že ešte beží (libuv na Windows
// číta GetExitCodeProcess); pri akejkoľvek chybe sa berie, že nebeží.
function isRunning(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  const speech = require("sherpa-onnx-node");
  assert.equal(typeof speech.OfflineRecognizer.createAsync, "function");
  assert.equal(typeof speech.Vad, "function");
  console.log(`PASS: local speech addon loads on ${process.platform}/${process.arch}`);

  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE smoke (value TEXT NOT NULL)");
    db.prepare("INSERT INTO smoke VALUES (?)").run("native-sqlite-ok");
    assert.equal(db.prepare("SELECT value FROM smoke").get().value, "native-sqlite-ok");
  } finally {
    db.close();
  }
  console.log(`PASS: SQLite opens and queries under Electron ${process.versions.electron}`);

  const pty = require("node-pty");
  await new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const terminal = pty.spawn(windows ? (process.env.ComSpec || "cmd.exe") : process.execPath,
      windows ? ["/d", "/s", "/c", "echo native-pty-ok & set /p legalwork_test_input="] : ["-e", "process.stdout.write('native-pty-ok')"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let output = "";
    let resend;
    let sent = 0;
    const timeout = setTimeout(() => {
      clearInterval(resend);
      terminal.kill();
      reject(new Error(`Native PTY did not exit within 10 seconds; output: ${JSON.stringify(output)}`));
    }, 10_000);
    let released = false;
    terminal.onData((data) => {
      output += data;
      // Electron.exe is a GUI-subsystem executable on Windows, so test the
      // actual console shell there and wait for output before asking it to exit.
      // Read a buffered line: PAUSE can discard input sent before it starts.
      if (windows && !released && output.includes("native-pty-ok")) {
        released = true;
        terminal.write("done\r");
        sent = 1;
        // 🟡 LAWOSS: na windows-11-arm cmd.exe raz čakal v `set /p` až do timeoutu,
        // hoci riadok už bol odoslaný (beh 39816882781). Kým cmd.exe beží, riadok sa
        // opakuje; `cmd /c` prečíta jeden a zvyšok zanikne s konzolou. Po skončení
        // cmd.exe sa už nepíše: onExit príde až ~1 s po ňom, takže bez kontroly by
        // bežný beh poslal druhý riadok a vypísal NOTE.
        resend = setInterval(() => {
          if (!isRunning(terminal.pid)) return;
          terminal.write("done\r");
          sent += 1;
        }, 1_000);
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      clearInterval(resend);
      try {
        assert.equal(exitCode, 0);
        assert.match(output, /native-pty-ok/);
        if (sent > 1) console.log(`NOTE: Windows PTY sent ${sent} input lines before cmd.exe exited`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  console.log("PASS: native PTY starts a process and receives its output");
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
