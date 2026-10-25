// Changed-line coverage gate. c8 writes coverage/lcov.info for every extension
// source file, and this module compares the lines a pull request adds with the
// lines the suite executed. Codecov reports the same numbers, but its commit
// status needs the GitHub App; this check keeps the 80% rule enforceable from
// the required gate alone. Lines that never appear in lcov are not executable,
// so comments and blank additions cost nothing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_THRESHOLD = 80;

export function repoPath(file, root = "") {
  if (!root) return file;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function parseLcov(text, root = "") {
  const files = new Map();
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = new Map();
      files.set(repoPath(line.slice(3), root), current);
    } else if (line === "end_of_record") {
      current = null;
    } else if (current && line.startsWith("DA:")) {
      const [number, hits] = line.slice(3).split(",");
      current.set(Number(number), Number(hits));
    }
  }
  return files;
}

export function parseAddedLines(diff) {
  const files = new Map();
  let current = null;
  let next = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const name = line.slice(4).trim().replace(/^b\//, "");
      current = name === "/dev/null" ? null : new Set();
      if (current) files.set(name, current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) {
      current.add(next);
      next += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\") && line.length > 0) {
      next += 1;
    }
  }
  return files;
}

export function evaluate(lcov, added, threshold = DEFAULT_THRESHOLD) {
  let executed = 0;
  let covered = 0;
  const uncovered = [];
  for (const [file, lines] of added) {
    const record = lcov.get(file);
    if (!record) continue;
    for (const line of lines) {
      if (!record.has(line)) continue;
      executed += 1;
      if (record.get(line) > 0) {
        covered += 1;
      } else {
        uncovered.push(`${file}:${line}`);
      }
    }
  }
  const ratio = executed === 0 ? 100 : (covered / executed) * 100;
  return { executed, covered, ratio, uncovered, pass: executed === 0 || ratio >= threshold };
}

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export function main(argv, env = process.env) {
  const root = flag(argv, "--root", process.cwd());
  const base = flag(argv, "--base", "");
  const lcovPath = flag(argv, "--lcov", "coverage/lcov.info");
  const threshold = Number(flag(argv, "--threshold", DEFAULT_THRESHOLD));
  if (!base) {
    console.error("patch-coverage: --base <commit> is required");
    return 2;
  }
  let lcov;
  try {
    lcov = parseLcov(readFileSync(lcovPath, "utf8"), root);
  } catch {
    console.error(`patch-coverage: cannot read ${lcovPath}; run the coverage suite first`);
    return 2;
  }
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--unified=0", "--no-color", "--no-ext-diff", `${base}...HEAD`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...env, GIT_PAGER: "cat" },
    });
  } catch {
    console.error(`patch-coverage: cannot diff ${base}...HEAD`);
    return 2;
  }
  const result = evaluate(lcov, parseAddedLines(diff), threshold);
  const percent = Math.round(result.ratio * 100) / 100;
  const counts = `${result.covered}/${result.executed} changed executable lines`;
  if (result.pass) {
    console.log(`Patch coverage ${percent}% (${counts}; ${threshold}% required)`);
    return 0;
  }
  console.error(`Patch coverage ${percent}% (${counts}) is below ${threshold}%`);
  for (const line of result.uncovered.slice(0, 20)) console.error(`  uncovered: ${line}`);
  if (result.uncovered.length > 20) console.error(`  ...and ${result.uncovered.length - 20} more`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
