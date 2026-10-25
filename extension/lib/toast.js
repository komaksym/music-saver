// In-page Undo toast (M6). Single-flight notice with a one-shot Undo
// button. The page owns display only; persistence lives in the background.

export class UndoToast {
  constructor(root, opts) {
    this.root = root;
    this.timeoutMs = (opts && opts.timeoutMs) || 8000;
    this.el = null;
    this.timer = null;
  }

  dismiss() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      if (this.el && this.el.remove) this.el.remove();
    } catch (e) {
      // Toast teardown is best-effort.
    }
    this.el = null;
  }

  show(track, onUndo) {
    this.dismiss();
    let el = null;
    try {
      el = this.root.createElement("div");
    } catch (e) {
      return;
    }
    if (!el) return;
    try {
      el.setAttribute("data-testid", "music-saver-toast");
    } catch (e) {
      // Attribute failure still leaves a usable notice.
    }
    try {
      el.setAttribute("role", "status");
    } catch (e) {
      // Usable without the hook.
    }
    try {
      if (el.style) {
        el.style.cssText =
          "display:block!important;position:fixed;bottom:96px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
          "background:#191414;color:#fff;padding:10px 14px;border-radius:8px;" +
          "font:14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);";
      }
    } catch (e) {
      // An unstyled toast still carries the Undo action.
    }
    const text = (track ? track.title + " - " + track.artist : "Track") + " saved to Liked Songs";
    if ("textContent" in el) {
      el.textContent = text + " ";
    }
    let btn = null;
    try {
      btn = this.root.createElement("button");
    } catch (e) {
      btn = null;
    }
    if (!btn) return;
    try {
      btn.setAttribute("data-testid", "music-saver-undo");
    } catch (e) {
      // Usable without the hook.
    }
    btn.textContent = "Undo";
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      try {
        if (onUndo) onUndo();
      } finally {
        this.dismiss();
      }
    };
    try {
      if (btn.addEventListener) btn.addEventListener("click", fire);
      else btn.onclick = fire;
    } catch (e) {
      btn.onclick = fire;
    }
    try {
      if (el.appendChild) el.appendChild(btn);
      const host = this.root.body && this.root.body.appendChild ? this.root.body : this.root;
      if (host.appendChild) host.appendChild(el);
      else if (this.root.appendChild) this.root.appendChild(el);
    } catch (e) {
      return;
    }
    this.el = el;
    this.timer = setTimeout(() => this.dismiss(), this.timeoutMs);
  }
}

