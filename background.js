async function buildMenus() {
  await browser.contextMenus.removeAll();
  const data = await browser.storage.local.get("prompts");
  const prompts = data.prompts || [];

  if (prompts.length === 0) {
    browser.contextMenus.create({
      id: "no-prompts",
      title: "ReplaceSelectionAI: no prompts configured",
      contexts: ["editable"],
      enabled: false
    });
    return;
  }

  prompts.forEach(p => {
    if (p.name && p.text) {
      browser.contextMenus.create({
        id: "prompt_" + p.id,
        title: p.name,
        contexts: ["editable"]
      });
    }
  });
}

buildMenus();

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "reloadMenus") buildMenus();
});

async function callAPI(settings, promptText, selectedText) {
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
        messages: [{ role: "user", content: `${promptText}\n\n${selectedText}` }]
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
        messages: [{ role: "user", content: `${promptText}\n\n${selectedText}` }],
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

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("prompt_")) return;
  const promptId = info.menuItemId.replace("prompt_", "");

  const data = await browser.storage.local.get(["apiKey", "provider", "model", "endpoint", "prompts"]);
  const { apiKey, provider = "openai", model, endpoint } = data;
  const prompts = data.prompts || [];
  const promptObj = prompts.find(p => p.id === promptId);
  if (!promptObj) return;

  if (!apiKey) {
    browser.tabs.executeScript(tab.id, {
      code: `alert("ReplaceSelectionAI: no API key configured. Click the extension icon to open settings.");`
    });
    return;
  }

  try {
    await browser.tabs.executeScript(tab.id, { file: "content.js", allFrames: true });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 100));

  const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
  let selectedText = "", targetFrameId = null;

  for (const frame of frames) {
    try {
      const response = await browser.tabs.sendMessage(tab.id,
        { action: "getLastSelection" },
        { frameId: frame.frameId }
      );
      if (response && response.text && response.text.trim()) {
        selectedText = response.text;
        targetFrameId = frame.frameId;
        break;
      }
    } catch (e) {}
  }

  if (!selectedText.trim()) {
    browser.tabs.executeScript(tab.id, {
      code: `alert("ReplaceSelectionAI: please select some text before choosing an action.");`
    });
    return;
  }

  showToastInFrame(tab.id, targetFrameId, "Processing...", "loading");

  let result = "";
  try {
    result = await callAPI({ provider, apiKey, model, endpoint }, promptObj.text, selectedText);
  } catch (e) {
    showToastInFrame(tab.id, targetFrameId, `Error: ${e.message}`, "error");
    return;
  }

  try {
    await browser.tabs.sendMessage(tab.id,
      { action: "replaceSelection", result },
      { frameId: targetFrameId }
    );
  } catch (e) {}
});
