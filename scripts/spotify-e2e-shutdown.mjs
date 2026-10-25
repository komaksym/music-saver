// Best-effort signal cleanup for the live Spotify runner. SIGKILL and host
// failures cannot run handlers, so this module never promises full cleanup.
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
export const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
export const INCOMPLETE_CLEANUP_EXIT_CODE = 1;

const SIGNALS = ['SIGINT', 'SIGTERM'];
const STEPS = [
  ['extension activity', 'stopActivity'],
  ['recording', 'stopRecording'],
  ['restore', 'restore'],
];

export function installSignalShutdown({
  process,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  stopActivity,
  stopRecording,
  restore,
  exit = code => process.exit(code),
  report = message => console.error(message),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => timer?.close?.(),
} = {}) {
  if (!process?.on || !process?.removeListener) {
    throw new Error('signal shutdown requires a process event emitter');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('signal shutdown timeout must be a positive number');
  }
  const steps = STEPS.map(([label, name]) => {
    const step = { stopActivity, stopRecording, restore }[name];
    if (typeof step !== 'function') throw new Error(`signal shutdown requires ${name}`);
    return [label, step];
  });

  let started = false;
  let disposed = false;

  function handle(signal) {
    const code = SIGNAL_EXIT_CODES[signal];
    if (disposed || code === undefined) return Promise.resolve(undefined);
    if (started) {
      exit(code);
      return Promise.resolve(code);
    }
    started = true;

    let timer;
    const deadline = new Promise((_, reject) => {
      timer = schedule(() => reject(new Error(`signal cleanup exceeded ${timeoutMs} ms`)), timeoutMs);
    });
    const cleanup = (async () => {
      for (const [label, step] of steps) {
        try {
          await step();
        } catch (error) {
          report(`signal cleanup step failed (${label}): ${error?.message || error}`);
        }
      }
    })();

    return Promise.race([cleanup, deadline]).then(
      () => {
        cancel(timer);
        exit(code);
        return code;
      },
      error => {
        cancel(timer);
        report(`signal cleanup incomplete: ${error.message}`);
        exit(INCOMPLETE_CLEANUP_EXIT_CODE);
        return INCOMPLETE_CLEANUP_EXIT_CODE;
      },
    );
  }

  for (const signal of SIGNALS) process.on(signal, handle);

  return {
    handle,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const signal of SIGNALS) process.removeListener(signal, handle);
    },
  };
}
