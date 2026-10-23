#!/usr/bin/env bash
# Guard: agent-browser is the only supported E2E stack in this repo.
# Fails when Playwright, Puppeteer, Selenium, Cypress, or WebDriver appear.
set -euo pipefail
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
bad=0
scan() {
  if grep -rniIE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=e2e-profile --exclude-dir=e2e-auth-state --exclude-dir=e2e-artifacts --exclude='*.png' -e "$1" . 2>/dev/null | grep -v check-browser-stack.sh | grep -viE 'agent-browser|never add playwright' | head -n 10; then
    echo "FORBIDDEN: pattern $1 found above; use scripts/e2e-agent-browser.sh" >&2
    bad=1
  fi
}
scan 'playwright'
scan 'puppeteer'
scan 'selenium'
scan 'cypress'
scan 'webdriver'
if grep -rniE --include='*.sh' -e 'state (save|load)|--state ' scripts/ 2>/dev/null | grep -v check-browser-stack.sh | head -n 10; then
  echo "FORBIDDEN: storage state files cannot combine with extensions; use --profile in scripts/e2e-agent-browser.sh" >&2
  bad=1
fi
if [ "$bad" -ne 0 ]; then exit 1; fi
echo 'browser stack ok: agent-browser only'
