const MAX_PROMPTS = 5;
const status = document.getElementById("status");
const promptsList = document.getElementById("promptsList");
const promptCount = document.getElementById("promptCount");
const addBtn = document.getElementById("addPrompt");
const providerSel = document.getElementById("provider");
const modelInput = document.getElementById("model");
const endpointRow = document.getElementById("endpointRow");
const endpointInput = document.getElementById("endpoint");
const providerHint = document.getElementById("providerHint");

let prompts = [];

const PROVIDER_DEFAULTS = {
  openai: { model: "gpt-4o-mini", endpoint: "https://api.openai.com/v1", hint: "Get your API key at platform.openai.com/api-keys" },
  anthropic: { model: "claude-haiku-4-5-20251001", endpoint: "https://api.anthropic.com/v1", hint: "Get your API key at console.anthropic.com — note: Anthropic uses a different API format" },
  "openai-compatible": { model: "", endpoint: "", hint: "Enter the endpoint URL and model name as specified by your provider (Groq, Mistral, Together AI, etc.)" }
};

function showStatus(msg, color) {
  status.style.color = color || "#16a34a";
  status.textContent = msg;
  setTimeout(() => { status.textContent = ""; }, 2500);
}

function generateId() {
  return "p_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
}

function savePrompts() {
  browser.storage.local.set({ prompts }).then(() => {
    browser.runtime.sendMessage({ action: "reloadMenus" });
  });
}

function updateProviderUI() {
  const p = providerSel.value;
  providerHint.textContent = PROVIDER_DEFAULTS[p].hint;
  endpointRow.style.display = p === "openai-compatible" ? "block" : "none";
  if (!modelInput.value) modelInput.value = PROVIDER_DEFAULTS[p].model;
}

providerSel.addEventListener("change", () => {
  const def = PROVIDER_DEFAULTS[providerSel.value];
  modelInput.value = def.model;
  if (endpointInput && def.endpoint) endpointInput.value = def.endpoint;
  updateProviderUI();
});

document.getElementById("clipboardMode").addEventListener("change", () => {
  browser.storage.local.set({ clipboardMode: document.getElementById("clipboardMode").value });
});



document.getElementById("saveSettings").addEventListener("click", () => {
  const provider = providerSel.value;
  const apiKey = document.getElementById("apiKey").value.trim();
  const model = modelInput.value.trim();
  const endpoint = endpointInput.value.trim();
  if (!apiKey) { showStatus("Please enter an API key", "#dc2626"); return; }
  if (!model) { showStatus("Please enter a model name", "#dc2626"); return; }
  if (provider === "openai-compatible" && !endpoint) { showStatus("Please enter an endpoint URL", "#dc2626"); return; }
  browser.storage.local.set({ provider, apiKey, model, endpoint, clipboardMode: document.getElementById("clipboardMode").value }).then(() => showStatus("Settings saved ✓"));
});

function makeEl(tag, props, children) {
  const el = document.createElement(tag);
  if (props) Object.assign(el, props);
  if (children) children.forEach(c => el.appendChild(c));
  return el;
}

function renderPrompts() {
  while (promptsList.firstChild) promptsList.removeChild(promptsList.firstChild);
  promptCount.textContent = prompts.length;
  addBtn.disabled = prompts.length >= MAX_PROMPTS;

  if (prompts.length === 0) {
    promptsList.appendChild(makeEl("div", { className: "empty-state", textContent: 'No prompts yet. Click "+ Add prompt" to get started.' }));
    return;
  }

  prompts.forEach(p => {
    const nameInput = makeEl("input", { className: "name-input", type: "text", placeholder: "Context menu label...", value: p.name });
    const saveBtn = makeEl("button", { className: "btn-save-card", textContent: "Save" });
    const deleteBtn = makeEl("button", { className: "btn-delete", textContent: "Remove" });
    const cardHeader = makeEl("div", { className: "prompt-card-header" }, [nameInput, saveBtn, deleteBtn]);
    const textarea = makeEl("textarea", { placeholder: "Prompt text..." });
    textarea.value = p.text;
    const card = makeEl("div", { className: "prompt-card" }, [cardHeader, textarea]);
    promptsList.appendChild(card);

    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      const text = textarea.value.trim();
      if (!name) { showStatus("Please enter a prompt name", "#dc2626"); return; }
      if (!text) { showStatus("Prompt text cannot be empty", "#dc2626"); return; }
      const i = prompts.findIndex(x => x.id === p.id);
      if (i !== -1) { prompts[i].name = name; prompts[i].text = text; }
      savePrompts();
      showStatus("Saved ✓");
    });

    deleteBtn.addEventListener("click", () => {
      prompts = prompts.filter(x => x.id !== p.id);
      savePrompts();
      renderPrompts();
      showStatus("Prompt removed");
    });
  });
}

addBtn.addEventListener("click", () => {
  if (prompts.length >= MAX_PROMPTS) return;
  prompts.push({ id: generateId(), name: "", text: "" });
  renderPrompts();
  promptsList.lastElementChild.querySelector(".name-input").focus();
});

browser.storage.local.get(["apiKey", "provider", "model", "endpoint", "clipboardMode", "prompts"]).then(data => {
  if (data.apiKey) document.getElementById("apiKey").value = data.apiKey;
  if (data.provider) providerSel.value = data.provider;
  if (data.model) modelInput.value = data.model;
  if (data.endpoint) endpointInput.value = data.endpoint;
  // Set clipboardMode without triggering change event
  const cm = document.getElementById("clipboardMode");
  cm.value = data.clipboardMode || "clipboard";
  prompts = data.prompts || [];
  updateProviderUI();
  renderPrompts();
});

// Export
document.getElementById("exportPrompts").addEventListener("click", () => {
  if (prompts.length === 0) { showStatus("No prompts to export", "#dc2626"); return; }
  const json = JSON.stringify({ version: 1, prompts }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "replaceselectionai-prompts.json";
  a.click();
  URL.revokeObjectURL(url);
  showStatus("Exported ✓");
});

// Import
document.getElementById("importPrompts").addEventListener("click", () => {
  document.getElementById("importFile").click();
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.prompts || !Array.isArray(data.prompts)) throw new Error("Invalid format");
      const imported = data.prompts.filter(p => p.name && p.text).slice(0, MAX_PROMPTS);
      prompts = imported.map(p => ({ id: generateId(), name: p.name, text: p.text }));
      savePrompts();
      renderPrompts();
      showStatus(`Imported ${prompts.length} prompt(s) ✓`);
    } catch (err) {
      showStatus("Import failed: invalid file", "#dc2626");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});
