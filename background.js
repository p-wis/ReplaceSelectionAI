async function buildMenus() {
  await browser.contextMenus.removeAll();
  const data = await browser.storage.local.get(["prompts", "clipboardMode"]);
  const prompts = (data.prompts || []).filter(p => p.name && p.text);
  const clipboardTitle = data.clipboardMode === "paste"
    ? "Rewrite clipboard & paste"
    : "Rewrite clipboard";

  if (prompts.length === 0) {
    browser.contextMenus.create({
      id: "no-prompts",
      title: "ReplaceSelectionAI: no prompts configured",
      contexts: ["editable"],
      enabled: false
    });
    return;
  }

  // Top-level: Process selection
  browser.contextMenus.create({
    id: "header-selection",
    title: "Rewrite selection",
    contexts: ["editable"]
  });
  prompts.forEach(p => {
    browser.contextMenus.create({
      id: "sel_" + p.id,
      title: p.name,
      parentId: "header-selection",
      contexts: ["editable"]
    });
  });

  // Top-level: Process clipboard
  browser.contextMenus.create({
    id: "header-clipboard",
    title: clipboardTitle,
    contexts: ["editable"]
  });
  prompts.forEach(p => {
    browser.contextMenus.create({
      id: "clip_" + p.id,
      title: p.name,
      parentId: "header-clipboard",
      contexts: ["editable"]
    });
  });
}

buildMenus();

// Install default prompts on first install
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install") return;
  const data = await browser.storage.local.get("prompts");
  if (data.prompts && data.prompts.length > 0) return;

  const defaultPrompts = [
    {
      id: "default_1",
      name: "Fix grammar",
      text: "Fix all grammar, spelling, and punctuation errors in the following text. Return only the corrected text, no explanations."
    },
    {
      id: "default_2",
      name: "Translate to English",
      text: "Translate the following text to English. Return only the translation, no explanations."
    },
    {
      id: "default_3",
      name: "Summarize",
      text: "Summarize the following text in 2-3 sentences. Return only the summary, no explanations."
    },
    {
      id: "default_4",
      name: "Make professional",
      text: "Rewrite the following text in a professional, formal tone suitable for business communication. Return only the rewritten text, no explanations."
    },
    {
      id: "default_5",
      name: "Bullet points",
      text: "Convert the following text into a clear, concise bullet point list. Return only the bullet points, no explanations."
    }
  ];

  await browser.storage.local.set({ prompts: defaultPrompts });
  buildMenus();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "reloadMenus") buildMenus();
});

async function callAPI(settings, promptText, inputText) {
  const { provider, apiKey, model, endpoint } = settings;

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: `${promptText}\n\n${inputText}` }]
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text.trim();
  } else {
    const baseUrl = (provider === "openai-compatible" && endpoint)
      ? endpoint.replace(/\/$/, "")
      : "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: `${promptText}\n\n${inputText}` }],
        temperature: 0
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
  }
}

function showToastInFrame(tabId, frameId, message, type) {
  const colors = { loading: "#2563eb", success: "#16a34a", error: "#dc2626" };
  const bg = colors[type] || "#333";
  const timeout = type !== "loading" ? `setTimeout(()=>t.remove(),3000);` : "";
  browser.tabs.executeScript(tabId, {
    frameId,
    code: `
      (() => {
        let t = document.getElementById("__rsai_toast__");
        if (!t) {
          t = document.createElement("div"); t.id = "__rsai_toast__";
          Object.assign(t.style, { position:"fixed", top:"16px", right:"16px", zIndex:"999999",
            color:"white", padding:"10px 16px", borderRadius:"8px", fontSize:"13px",
            fontFamily:"system-ui,sans-serif", boxShadow:"0 4px 12px rgba(0,0,0,.3)" });
          document.body.appendChild(t);
        }
        t.style.background = "${bg}";
        t.textContent = ${JSON.stringify(message)};
        ${timeout}
      })()
    `
  });
}

async function injectIfNeeded(tabId, frameId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, { action: "ping" }, { frameId });
    if (response === true) return;
  } catch (e) {}
  try {
    await browser.tabs.executeScript(tabId, { file: "content.js", frameId });
    await new Promise(r => setTimeout(r, 80));
  } catch (e) {}
}

async function findTargetFrame(tabId) {
  const frames = await browser.webNavigation.getAllFrames({ tabId });
  for (const frame of frames) {
    await injectIfNeeded(tabId, frame.frameId);
    try {
      const response = await browser.tabs.sendMessage(tabId,
        { action: "getLastSelection" },
        { frameId: frame.frameId }
      );
      if (response && response.text && response.text.trim()) {
        return { frameId: frame.frameId, selectedText: response.text };
      }
    } catch (e) {}
  }
  return null;
}

async function findAnyFrame(tabId) {
  // Returns first accessible frame (for clipboard mode — we just need somewhere to show toast and paste)
  const frames = await browser.webNavigation.getAllFrames({ tabId });
  for (const frame of frames) {
    await injectIfNeeded(tabId, frame.frameId);
    try {
      await browser.tabs.sendMessage(tabId, { action: "ping" }, { frameId: frame.frameId });
      return frame.frameId;
    } catch (e) {}
  }
  return 0;
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;
  const isSelection = menuId.startsWith("sel_");
  const isClipboard = menuId.startsWith("clip_");
  if (!isSelection && !isClipboard) return;

  const promptId = menuId.replace(/^(sel_|clip_)/, "");
  const data = await browser.storage.local.get(["apiKey", "provider", "model", "endpoint", "clipboardMode", "prompts"]);
  const { apiKey, provider = "openai", model, endpoint, clipboardMode = "clipboard" } = data;
  const prompts = data.prompts || [];
  const promptObj = prompts.find(p => p.id === promptId);
  if (!promptObj) return;

  if (!apiKey) {
    browser.tabs.executeScript(tab.id, {
      code: `alert("ReplaceSelectionAI: no API key configured. Click the extension icon to open settings.");`
    });
    return;
  }

  if (isSelection) {
    // --- SELECTION MODE ---
    const found = await findTargetFrame(tab.id);

    if (!found) {
      browser.tabs.executeScript(tab.id, {
        code: `alert("ReplaceSelectionAI: please select some text before choosing an action.");`
      });
      return;
    }

    const { frameId, selectedText } = found;
    showToastInFrame(tab.id, frameId, "Processing...", "loading");

    let result = "";
    try {
      result = await callAPI({ provider, apiKey, model, endpoint }, promptObj.text, selectedText);
    } catch (e) {
      showToastInFrame(tab.id, frameId, `Error: ${e.message}`, "error");
      return;
    }

    try {
      await browser.tabs.sendMessage(tab.id,
        { action: "replaceSelection", result },
        { frameId }
      );
    } catch (e) {}

  } else {
    // --- CLIPBOARD MODE ---
    // Find frame that has a remembered active element
    const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
    let targetFrameId = 0;

    for (const frame of frames) {
      await injectIfNeeded(tab.id, frame.frameId);
      try {
        const response = await browser.tabs.sendMessage(tab.id,
          { action: "hasActiveElement" },
          { frameId: frame.frameId }
        );
        if (response === true) {
          targetFrameId = frame.frameId;
          break;
        }
      } catch (e) {
      }
    }

    const frameId = targetFrameId;
    showToastInFrame(tab.id, frameId, "Reading clipboard...", "loading");

    // Read clipboard via injected async script — works even after focus loss
    let clipboardText = "";
    try {
      const results = await browser.tabs.executeScript(tab.id, {
        frameId,
        code: `(async () => { try { return await navigator.clipboard.readText(); } catch(e) { return ""; } })()`
      });
      clipboardText = results && results[0] ? results[0] : "";
    } catch (e) {
      clipboardText = "";
    }

    if (!clipboardText.trim()) {
      showToastInFrame(tab.id, frameId, "Clipboard is empty", "error");
      return;
    }

    showToastInFrame(tab.id, frameId, "Processing...", "loading");

    let result = "";
    try {
      result = await callAPI({ provider, apiKey, model, endpoint }, promptObj.text, clipboardText);
    } catch (e) {
      showToastInFrame(tab.id, frameId, `Error: ${e.message}`, "error");
      return;
    }

    // Write result back to clipboard and optionally paste
    try {
      const wr = await browser.tabs.sendMessage(tab.id,
        { action: "writeClipboard", text: result, paste: clipboardMode === "paste" },
        { frameId }
      );
    } catch (e) {
    }
  }
});
