import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function tempHome(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function runExpectScenario(script, env) {
  return spawnSync("expect", ["-c", script], {
    cwd: "/Users/williamvalenrobinson/Documents/better-availability",
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("weekly availability preview can replace existing availability without dropping out of the TUI", async () => {
  const home = await tempHome("better-availability-tui");
  const script = `
    set timeout 15
    spawn node bin/better-availability.js start
    expect "Press any key to start setup."
    send "x"
    expect "Name:"
    send "William\\r"
    expect -re {Role \\[optional\\]:}
    send "\\r"
    expect "Choose timezone"
    send "\\r"
    expect "Confirm timezone"
    send "\\033\\[A"
    after 200
    send "\\r"
    expect -re {Tags \\[optional\\]:}
    send "\\r"
    expect "Add normal availability?"
    send "\\033\\[A"
    after 200
    send "\\r"
    expect "Availability:"
    send "monday through friday 8am to 8pm\\r"
    expect "Preview weekly availability"
    send "\\r"
    expect "Better Availability"
    send "q"
    expect eof
  `;

  const result = runExpectScenario(script, { BETTER_AVAILABILITY_HOME: home });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Preview weekly availability/);
  assert.match(result.stdout, /Replace existing availability on these days/);
  assert.match(result.stdout, /Better Availability/);
});
