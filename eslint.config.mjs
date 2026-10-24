import js from "@eslint/js";

const browserGlobals = {
  chrome: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  document: "readonly",
  fetch: "readonly",
  location: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  URLSearchParams: "readonly",
};

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    ignores: ["extension/content.bundle.js"],
  },
  js.configs.recommended,
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    files: [
      "extension/content.js",
      "extension/lib/player-dom.js",
      "extension/lib/toast.js",
    ],
    rules: {
      // These files start bindings at an empty value before a try/catch
      // that may return from catch.
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals,
    },
  },
];
