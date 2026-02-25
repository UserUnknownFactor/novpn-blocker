// ─── DOM references ──────────────────────────────────────────────
const blockedHostsTextArea     = document.querySelector("#blocked-hosts");
const countryCodeInput         = document.querySelector("#country-code");
const forceIncognitoCheckbox   = document.querySelector("#force-incognito");
const modeLocalservice         = document.querySelector("#localservice");
const modeExternalcheck        = document.querySelector("#externalcheck");
const debugOn                  = document.querySelector("#on");
const debugOff                 = document.querySelector("#off");
const domainCountBadge         = document.querySelector("#domain-count");
const reverseDomainCountBadge  = document.querySelector("#reverse-domain-count");

// Must match the defaults in background.js
const DEFAULTS = {
  blockedHosts:    ['example.com', 'example.org'],
  countryCode:     'US',
  forceIncognito:  true,
  modeOfOperation: 'externalcheck',
  debugging:       false,
};

// ─── Domain counter ──────────────────────────────────────────────

function updateDomainCount() {
  if (!domainCountBadge) return;
  
  const lines = blockedHostsTextArea.value
    .split("\n")
    .map(h => h.trim())
    .filter(Boolean);
  
  const normalCount = lines.filter(h => !h.startsWith('!')).length;
  const reverseCount = lines.filter(h => h.startsWith('!')).length;
  
  domainCountBadge.textContent = normalCount;
  
  if (reverseDomainCountBadge) {
    reverseDomainCountBadge.textContent = reverseCount;
    reverseDomainCountBadge.style.display = reverseCount > 0 ? 'inline-flex' : 'none';
  }
}

// ─── Save / Load ─────────────────────────────────────────────────

function storeSettings() {
  const blockedHosts = blockedHostsTextArea.value
    .split("\n")
    .map(h => h.trim())
    .filter(Boolean);

  browser.storage.local.set({
    blockedHosts,
    countryCode:     countryCodeInput.value.trim(),
    forceIncognito:  forceIncognitoCheckbox.checked,
    modeOfOperation: modeLocalservice.checked ? 'localservice' : 'externalcheck',
    debugging:       debugOn.checked,
  });

  updateDomainCount();
}

function updateUI(settings) {
  const s = { ...DEFAULTS, ...settings };

  blockedHostsTextArea.value     = (Array.isArray(s.blockedHosts)
                                     ? s.blockedHosts
                                     : DEFAULTS.blockedHosts
                                   ).join("\n");
  countryCodeInput.value         = s.countryCode || DEFAULTS.countryCode;
  forceIncognitoCheckbox.checked = s.forceIncognito;

  modeLocalservice.checked  = s.modeOfOperation === 'localservice';
  modeExternalcheck.checked = s.modeOfOperation === 'externalcheck';

  debugOn.checked  = s.debugging === true;
  debugOff.checked = s.debugging !== true;

  updateDomainCount();
}

function onError(e) {
  console.error('Failed to load settings:', e);
  updateUI(DEFAULTS);
}

// ─── Init ────────────────────────────────────────────────────────

browser.storage.local.get(DEFAULTS).then(updateUI, onError);

// Save on any change
[
  blockedHostsTextArea, countryCodeInput, forceIncognitoCheckbox,
  modeLocalservice, modeExternalcheck, debugOn, debugOff,
].forEach(el => el.addEventListener("change", storeSettings));

// Live-update the badge while typing
blockedHostsTextArea.addEventListener("input", updateDomainCount);

// ─── Copy-to-clipboard buttons ───────────────────────────────────

document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const codeBlock = btn.closest('.code-block');
    const pre = codeBlock.querySelector('pre');
    const text = pre.textContent;

    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });
});

document.querySelector("#clear-cache")?.addEventListener("click", () => {
  browser.runtime.sendMessage({ action: "clearVpnCache" });
});

/* ── i18n: Auto-detect browser language ── */
/* ── i18n: detect browser language, set <html lang> ── */
(function() {
  const SUPPORTED = ["en", "de", "ja"];
  const DEFAULT   = "en";

  const candidates = navigator.languages || [navigator.language || DEFAULT];
  for (const tag of candidates) {
    const base = tag.split("-")[0].toLowerCase();
    if (SUPPORTED.includes(base)) {
      document.documentElement.lang = base;
      break;
    }
  }
})();


/* ── i18n: bridge attributes CSS can't set ── */
document.addEventListener("DOMContentLoaded", () => {
  const s = k => getComputedStyle(document.documentElement)
    .getPropertyValue(k).trim().replace(/^["']|["']$/g, "");

  const title = s("--i18n-page-title");
  if (title) document.title = title;

  // Badge tooltips
  const req = s("--i18n-badge-vpn-required");
  const blk = s("--i18n-badge-vpn-blocked");
  if (req) document.getElementById("domain-count").title = req;
  if (blk) document.getElementById("reverse-domain-count").title = blk;

  // Copy buttons
  const copyTitle = s("--i18n-copy-btn-title");
  if (copyTitle) document.querySelectorAll(".copy-btn").forEach(b => b.title = copyTitle);
});