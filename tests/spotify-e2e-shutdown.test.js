import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  SIGNAL_EXIT_CODES,
  installSignalShutdown,
} from "../scripts/spotify-e2e-shutdown.mjs";

class FakeProcess {
  listeners = new Map();

  on(signal, listener) {
    const listeners = this.listeners.get(signal) ?? [];
    listeners.push(listener);
    this.listeners.set(signal, listeners);
    return this;
  }

  removeListener(signal, listener) {
    this.listeners.set(signal, (this.listeners.get(signal) ?? []).filter(candidate => candidate !== listener));
    return this;
  }

  emit(signal) {
    for (const listener of [...(this.listeners.get(signal) ?? [])]) listener(signal);
  }

  listenerCount(signal) {
    return (this.listeners.get(signal) ?? []).length;
  }
}

class FakeClock {
  timers = [];
  now = 0;

  schedule(callback, delay) {
    const timer = { callback, delay, cancelled: false };
    this.timers.push(timer);
    return timer;
  }

  cancel(timer) {
    if (timer) timer.cancelled = true;
  }

  advance(ms) {
    this.now += ms;
    for (const timer of this.timers) {
      if (!timer.cancelled && timer.delay <= this.now) {
        timer.cancelled = true;
        timer.callback();
      }
    }
  }
}

function setup({ clock = new FakeClock(), ...overrides } = {}) {
  const calls = [];
  const exits = [];
  const reports = [];
  const process = new FakeProcess();
  let settleExit;
  const exited = new Promise(resolve => { settleExit = resolve; });
  const shutdown = installSignalShutdown({
    process,
    timeoutMs: 1000,
    stopActivity: async () => { calls.push("stopActivity"); },
    stopRecording: async () => { calls.push("stopRecording"); },
    restore: async () => { calls.push("restore"); },
    exit: code => { exits.push(code); settleExit(code); },
    report: message => { reports.push(message); },
    schedule: (callback, delay) => clock.schedule(callback, delay),
    cancel: timer => clock.cancel(timer),
    ...overrides,
  });
  return { process, shutdown, clock, calls, exits, reports, exited };
}

test("uses a ten-second cleanup bound and conventional signal exit codes", () => {
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 10_000);
  assert.deepEqual(SIGNAL_EXIT_CODES, { SIGINT: 130, SIGTERM: 143 });
});

test("first SIGINT stops activity, stops recording, restores, then exits 130", async () => {
  const harness = setup();
  harness.process.emit("SIGINT");
  assert.equal(await harness.exited, 130);
  assert.deepEqual(harness.calls, ["stopActivity", "stopRecording", "restore"]);
  assert.deepEqual(harness.exits, [130]);
  assert.deepEqual(harness.reports, []);
  harness.shutdown.dispose();
});

test("first SIGTERM runs the same cleanup and exits 143", async () => {
  const harness = setup();
  harness.process.emit("SIGTERM");
  assert.equal(await harness.exited, 143);
  assert.deepEqual(harness.calls, ["stopActivity", "stopRecording", "restore"]);
  assert.deepEqual(harness.exits, [143]);
  harness.shutdown.dispose();
});

test("a second signal exits immediately without restarting cleanup", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const harness = setup({
    stopActivity: async () => { calls.push("stopActivity"); await gate; },
    stopRecording: async () => { calls.push("stopRecording"); },
    restore: async () => { calls.push("restore"); },
  });

  harness.process.emit("SIGINT");
  assert.deepEqual(calls, ["stopActivity"]);
  harness.process.emit("SIGINT");
  assert.deepEqual(harness.exits, [130]);

  release();
  assert.equal(await harness.exited, 130);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["stopActivity", "stopRecording", "restore"]);
  harness.shutdown.dispose();
});

test("a hung cleanup exits nonzero after the bound and reports incomplete cleanup", async () => {
  let release;
  const hung = new Promise(resolve => { release = resolve; });
  const harness = setup({
    timeoutMs: 25,
    stopActivity: () => hung,
    stopRecording: async () => { throw new Error("unreachable recording step"); },
  });
  harness.process.emit("SIGTERM");
  harness.clock.advance(24);
  assert.deepEqual(harness.exits, [], "cleanup has not timed out before the bound");
  harness.clock.advance(1);
  assert.equal(await harness.exited, 1);
  assert.deepEqual(harness.exits, [1]);
  assert.match(harness.reports.join("\n"), /cleanup incomplete/i);
  assert.match(harness.reports.join("\n"), /25 ms/);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(harness.exits, [1], "the timed-out cleanup does not exit twice");
  harness.shutdown.dispose();
});

test("the bound covers a hung restore after the earlier steps finish", async () => {
  let release;
  const hung = new Promise(resolve => { release = resolve; });
  const harness = setup({
    timeoutMs: 25,
    restore: () => hung,
  });
  harness.process.emit("SIGINT");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(harness.calls, ["stopActivity", "stopRecording"]);
  harness.clock.advance(24);
  assert.deepEqual(harness.exits, []);
  harness.clock.advance(1);
  assert.equal(await harness.exited, 1);
  assert.deepEqual(harness.exits, [1]);
  assert.match(harness.reports.join("\n"), /cleanup incomplete/i);
  release();
  await new Promise(resolve => setImmediate(resolve));
  harness.shutdown.dispose();
});

test("a failed cleanup step is reported and later steps still run", async () => {
  const harness = setup({
    stopActivity: async () => { throw new Error("storage unavailable"); },
  });
  harness.process.emit("SIGINT");
  assert.equal(await harness.exited, 130);
  assert.deepEqual(harness.calls, ["stopRecording", "restore"]);
  assert.match(harness.reports.join("\n"), /extension activity.*storage unavailable/);
  harness.shutdown.dispose();
});

test("dispose removes both signal listeners", () => {
  const harness = setup();
  assert.equal(harness.process.listenerCount("SIGINT"), 1);
  assert.equal(harness.process.listenerCount("SIGTERM"), 1);
  harness.shutdown.dispose();
  assert.equal(harness.process.listenerCount("SIGINT"), 0);
  assert.equal(harness.process.listenerCount("SIGTERM"), 0);
});

test("an isolated child exits 143 after a real SIGTERM", { skip: process.platform === "win32" }, async t => {
  const moduleUrl = new URL("../scripts/spotify-e2e-shutdown.mjs", import.meta.url).href;
  const script = `
import { installSignalShutdown } from ${JSON.stringify(moduleUrl)};
const calls = [];
installSignalShutdown({
  process,
  stopActivity: async () => { calls.push("stopActivity"); },
  stopRecording: async () => { calls.push("stopRecording"); },
  restore: async () => { calls.push("restore"); },
  exit: code => { process.stdout.write(JSON.stringify({ code, calls }) + "\\n", () => process.exit(code)); },
  report: message => process.stderr.write(message + "\\n"),
});
process.stdout.write("ready\\n");
setInterval(() => {}, 1000);
`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child did not become ready: ${stderr}`)), 5000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("ready\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (!stdout.includes("ready\n")) {
        clearTimeout(timer);
        reject(new Error(`child exited ${code} before ready: ${stderr}`));
      }
    });
  });

  await ready;
  assert.equal(child.kill("SIGTERM"), true);
  assert.equal(await exited, 143, stderr);
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.deepEqual(result, { code: 143, calls: ["stopActivity", "stopRecording", "restore"] });
});
