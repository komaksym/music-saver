import { cookieSetArgs } from "./e2e-cookies.mjs";

export function importCookies(cookies, run) {
  for (const cookie of cookies) run(...cookieSetArgs(cookie));
}
