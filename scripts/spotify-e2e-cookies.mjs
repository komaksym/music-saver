import { cookieSetArgs } from "./e2e-cookies.mjs";

export function importCookies(cookies, run) {
  const commands = cookies.map((cookie) => cookieSetArgs(cookie));
  for (const args of commands) run(...args);
}
