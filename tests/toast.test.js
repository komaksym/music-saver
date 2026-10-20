import test from "node:test";
import assert from "node:assert/strict";
import { UndoToast } from "../extension/lib/toast.js";

function makeButton() {
  const listeners = new Map();
  return {
    textContent: "",
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    click() {
      const fn = listeners.get("click");
      if (fn) fn();
    },
  };
}

function makeEl() {
  return {
    children: [],
    textContent: "",
    removed: false,
    attrs: {},
    style: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {
      this.removed = true;
    },
  };
}

function fakeRoot() {
  const root = {
    appended: null,
    buttons: [],
    els: [],
    body: {
      appendChild(c) {
        root.appended = c;
        return c;
      },
    },
    createElement(tag) {
      const made = tag === "button" ? makeButton() : makeEl();
      if (tag === "button") root.buttons.push(made);
      else root.els.push(made);
      return made;
    },
  };
  return root;
}

const TRACK = { title: "Immune to Danger", artist: "Hippie Sabotage" };

test("show renders the toast and Undo fires exactly once", () => {
  const root = fakeRoot();
  const toast = new UndoToast(root, { timeoutMs: 50 });
  let calls = 0;
  toast.show(TRACK, () => {
    calls += 1;
  });
  const el = root.els[0];
  const btn = root.buttons[0];
  assert.equal(root.appended, el);
  assert.equal(btn.textContent, "Undo");
  assert.equal(btn.attrs["data-testid"], "music-saver-undo");
  assert.equal(el.attrs["role"], "status");
  assert.ok(String(el.style.cssText).includes("position:fixed"));
  assert.ok(String(el.style.cssText).includes("z-index:2147483647"));
  assert.ok(el.textContent.includes("Immune to Danger"));
  btn.click();
  btn.click();
  assert.equal(calls, 1);
  assert.equal(el.removed, true);
});

test("a new save replaces the visible toast", () => {
  const root = fakeRoot();
  const toast = new UndoToast(root, { timeoutMs: 50 });
  toast.show(TRACK, () => {});
  const first = root.els[0];
  toast.show(TRACK, () => {});
  assert.equal(first.removed, true);
  assert.equal(root.appended, root.els[1]);
});

test("the toast dismisses itself after the timeout", async () => {
  const root = fakeRoot();
  const toast = new UndoToast(root, { timeoutMs: 10 });
  toast.show(TRACK, () => {});
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(root.els[0].removed, true);
});

