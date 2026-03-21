if (typeof window.__rsai_loaded === "undefined") {
  window.__rsai_loaded = true;

  let lastSelection = null;

  function captureSelection() {
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const text = el.value.substring(start, end);
      if (text.trim()) lastSelection = { el, start, end, text, type: "input" };
    } else {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      if (text.trim()) lastSelection = { text, type: "selection" };
    }
  }

  document.addEventListener("mouseup", captureSelection);
  document.addEventListener("keyup", (e) => {
    if (e.shiftKey || e.key === "End" || e.key === "Home" ||
        e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp" || e.key === "ArrowDown" ||
        (e.key === "a" && (e.ctrlKey || e.metaKey))) {
      captureSelection();
    }
  });
  document.addEventListener("selectionchange", () => {
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      if (el.selectionStart !== el.selectionEnd) captureSelection();
    }
  });

  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === "ping") return true;

    if (msg.action === "showError") {
      showToast(msg.message, "error");
      return;
    }

    if (msg.action === "getLastSelection") {
      if (!lastSelection) return null;
      return { text: lastSelection.text, type: lastSelection.type, start: lastSelection.start, end: lastSelection.end };
    }

    if (msg.action === "replaceSelection") {
      if (!lastSelection) { showToast("No saved selection found", "error"); return; }
      if (lastSelection.type === "input" && lastSelection.el) {
        const el = lastSelection.el;
        el.focus();
        el.setRangeText(msg.result, lastSelection.start, lastSelection.end, "select");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        showToast("Done ✓", "success");
      } else {
        await navigator.clipboard.writeText(msg.result);
        showToast("Copied to clipboard — paste manually (⌘V / Ctrl+V)", "success");
      }
      lastSelection = null;
    }

    if (msg.action === "readClipboard") {
      try {
        const text = await navigator.clipboard.readText();
        return { text };
      } catch (e) {
        return { text: "" };
      }
    }

    if (msg.action === "writeClipboard") {
      try {
        await navigator.clipboard.writeText(msg.text);
        showToast("Result copied to clipboard ✓", "success");
      } catch (e) {
        showToast("Could not write to clipboard", "error");
      }
    }
  });

  function showToast(message, type) {
    const existing = document.getElementById("__rsai_toast__");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "__rsai_toast__";
    const colors = { loading: "#2563eb", success: "#16a34a", error: "#dc2626" };
    Object.assign(toast.style, {
      position: "fixed", top: "16px", right: "16px", zIndex: "999999",
      background: colors[type] || "#333", color: "white",
      padding: "10px 16px", borderRadius: "8px", fontSize: "13px",
      fontFamily: "system-ui,sans-serif", boxShadow: "0 4px 12px rgba(0,0,0,.3)",
      maxWidth: "340px", lineHeight: "1.4"
    });
    toast.textContent = message;
    document.body.appendChild(toast);
    if (type !== "loading") setTimeout(() => toast.remove(), 3000);
  }
}
