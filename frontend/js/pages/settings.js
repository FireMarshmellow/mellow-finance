import { api }         from "../api.js";
import { showLoading, toast } from "../app.js";

export async function renderSettings(container) {
  showLoading();

  let keySet = false;
  try {
    const s = await api.getSettings();
    keySet = s.youtube_api_key_set;
  } catch (_) {}

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Settings</div>
      <div class="page-subtitle">Configure integrations and API keys</div>
    </div>

    <div class="settings-card">
      <div class="settings-section-title">YouTube Integration</div>

      <div class="settings-field">
        <label for="yt-api-key">YouTube Data API v3 Key</label>
        <div class="settings-input-row">
          <input type="password" id="yt-api-key"
                 placeholder="${keySet ? "Enter a new key to replace the current one" : "Paste your API key here"}"
                 autocomplete="off" spellcheck="false" />
          <button class="btn btn-ghost" id="btn-toggle-key">Show</button>
        </div>
        <div class="settings-hint" id="settings-hint">
          ${keySet
            ? "✓ API key is configured. Leave blank to keep the existing key."
            : "Required for the Sponsor Tracker to fetch video data from YouTube."}
        </div>
      </div>

      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">Save Settings</button>
      </div>
    </div>
  `;

  const input     = container.querySelector("#yt-api-key");
  const toggleBtn = container.querySelector("#btn-toggle-key");
  const saveBtn   = container.querySelector("#btn-save-settings");
  const hint      = container.querySelector("#settings-hint");

  toggleBtn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggleBtn.textContent = show ? "Hide" : "Show";
  });

  saveBtn.addEventListener("click", async () => {
    const val = input.value.trim();
    if (!val) {
      toast("Enter an API key to save", "error");
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await api.saveSettings({ youtube_api_key: val });
      input.value = "";
      input.type = "password";
      toggleBtn.textContent = "Show";
      hint.innerHTML = "✓ API key is configured. Leave blank to keep the existing key.";
      toast("Settings saved");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Settings";
    }
  });
}
