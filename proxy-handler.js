// ─── Default Settings ────────────────────────────────────────────
let blockedHosts = ['example.com', 'example.org'];
let countryCode = 'US';
let forceIncognito = true;
let modeOfOperation = 'externalcheck';
let debugging = false;
const IP_ENDPOINT = 'https://ipinfo.io/json';

// ─── Constants ───────────────────────────────────────────────────
const LOCAL_SERVICE_HOST = 'localhost';
const LOCAL_SERVICE_PORT = '4567';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DIRECT_CONN = { type: "direct" };

const FORCE_DIRECT_HOSTS = new Set(['localhost', '0.0.0.0', '127.0.0.1', '::1']);

let vpnCheckCache = { vpnUp: null, timestamp: 0 };
const processedTabs = new Set();

// ─── Initialisation ──────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await browser.storage.local.get([
      'blockedHosts',
      'countryCode',
      'forceIncognito',
      'modeOfOperation',
      'debugging',
    ]);
    if (data.blockedHosts !== undefined)    blockedHosts    = data.blockedHosts;
    if (data.countryCode !== undefined)     countryCode     = data.countryCode;
    if (data.forceIncognito !== undefined)  forceIncognito  = data.forceIncognito;
    if (data.modeOfOperation !== undefined) modeOfOperation = data.modeOfOperation;
    if (data.debugging !== undefined)       debugging       = data.debugging;

    if (debugging) console.log('Settings loaded:', data);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({
    blockedHosts,
    countryCode,
    forceIncognito,
    modeOfOperation,
    debugging,
  });
});

// Load settings when ready
loadSettings();

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('blockedHosts'    in changes) blockedHosts    = changes.blockedHosts.newValue;
  if ('countryCode'     in changes) countryCode     = changes.countryCode.newValue;
  if ('forceIncognito'  in changes) forceIncognito  = changes.forceIncognito.newValue;
  if ('modeOfOperation' in changes) modeOfOperation = changes.modeOfOperation.newValue;
  if ('debugging'       in changes) debugging       = changes.debugging.newValue;

  clearVpnCache("settings changed");
});

// ─── Domain Matching ─────────────────────────────────────────────

function matchHost(hostname) {
  for (const entry of blockedHosts) {
    let rule = entry.trim();
    if (!rule) continue;

    const reversed = rule.startsWith('!');
    if (reversed) rule = rule.slice(1).trim();

    rule = rule.toLowerCase();

    if (hostname === rule || hostname.endsWith('.' + rule)) {
      if (debugging) console.log(`Host match: ${hostname} ↔ ${reversed ? '!' : ''}${rule}`);
      return { matched: true, reversed };
    }
  }
  return { matched: false };
}

// ─── History Management ──────────────────────────────────────────

async function deleteHistoryForHost(hostname) {
  try {
    const results = await browser.history.search({
      text: hostname,
      startTime: 0,
      maxResults: 100,
    });
    for (const item of results) {
      try {
        const h = new URL(item.url).hostname.toLowerCase();
        if (h === hostname || h.endsWith('.' + hostname)) {
          if (debugging) console.log(`Removing history entry: ${item.url}`);
          await browser.history.deleteUrl({ url: item.url });
        }
      } catch { /* skip malformed URLs */ }
    }
  } catch (err) {
    if (debugging) console.error(`History cleanup failed: ${err.message}`);
  }
}

browser.history.onVisited.addListener(async (historyItem) => {
  if (!forceIncognito) return;
  try {
    const hostname = new URL(historyItem.url).hostname.toLowerCase();
    const { matched } = matchHost(hostname);
    if (matched) {
      await browser.history.deleteUrl({ url: historyItem.url });
      if (debugging) console.log(`Auto-cleaned history entry: ${historyItem.url}`);
    }
  } catch { /* ignore */ }
});

// ─── VPN Checks ──────────────────────────────────────────────────

function clearVpnCache(reason) {
  vpnCheckCache = { vpnUp: null, timestamp: 0 };
  if (debugging) console.log(`VPN cache cleared: ${reason}`);
}

async function checkVPNviaLocalService() {
  try {
    const res  = await fetch(`http://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT}/getvpnstatus`);
    const body = await res.text();
    if (debugging) console.log(`Local-service response: ${body}`);
    return body.includes('status=UP');
  } catch (err) {
    if (debugging) {
      console.error(`Local-service check failed: ${err.message}`);
      console.error(`Is the service running at http://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT} ?`);
    }
    return false;
  }
}

async function checkVPNviaExternalIP() {
  const now = Date.now();

  if (vpnCheckCache.vpnUp !== null && (now - vpnCheckCache.timestamp) < CACHE_TTL_MS) {
    if (debugging) console.log(`Cached VPN-check result: vpnUp=${vpnCheckCache.vpnUp}`);
    return vpnCheckCache.vpnUp;
  }

  try {
    const res = await fetch(IP_ENDPOINT);
    const data = await res.json();

    if (!data || !data.country) {
      if (debugging) console.log('External check: no response or missing country — failing closed');
      return false;
    }

    const vpnUp = data.country.toUpperCase() !== countryCode.toUpperCase();

    if (debugging) console.log(`External check: country=${data.country}, home=${countryCode}, vpnUp=${vpnUp}`);

    vpnCheckCache = { vpnUp, timestamp: now };
    return vpnUp;
  } catch (err) {
    if (debugging) console.error(`External IP check failed: ${err.message}`);
    return false;
  }
}

async function isVPNActive() {
  switch (modeOfOperation) {
    case 'localservice':  return checkVPNviaLocalService();
    case 'externalcheck': return checkVPNviaExternalIP();
    default:
      console.error(
        `Invalid modeOfOperation "${modeOfOperation}"; must be "localservice" or "externalcheck".`
      );
      return false;
  }
}

// ─── Tab-based VPN Cache Invalidation ────────────────────────────

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  processedTabs.delete(details.tabId);

  try {
    const hostname = new URL(details.url).hostname.toLowerCase().trim();
    const { matched } = matchHost(hostname);

    if (matched) {
      processedTabs.add(details.tabId);
      clearVpnCache(`tab ${details.tabId} navigating to processed domain: ${hostname}`);
    }
  } catch { /* ignore about:, moz-extension:, etc. */ }
});

browser.tabs.onRemoved.addListener((tabId) => {
  processedTabs.delete(tabId);
});

// ─── Request Blocking (webRequest) ───────────────────────────────

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    let hostname;
    try {
      hostname = new URL(details.url).hostname.toLowerCase().trim();
    } catch {
      return {};
    }

    if (FORCE_DIRECT_HOSTS.has(hostname)) return {};

    const { matched, reversed } = matchHost(hostname);
    if (!matched) return {};

    if (!reversed && forceIncognito && !details.incognito) {
      deleteHistoryForHost(hostname);
      if (debugging) console.log(`[webRequest] Blocked ${hostname}: not in incognito mode`);
      return { cancel: true };
    }

    return isVPNActive().then(vpnUp => {
      if (reversed) {
        if (vpnUp) {
          if (debugging) console.log(`[webRequest] Blocked ${hostname}: VPN is active (reverse rule)`);
          return { cancel: true };
        }
        if (debugging) console.log(`[webRequest] Allowing ${hostname}: VPN is not active (reverse rule)`);
        return {};
      } else {
        if (!vpnUp) {
          if (debugging) console.log(`[webRequest] Blocked ${hostname}: VPN is not active`);
          return { cancel: true };
        }
        if (debugging) console.log(`[webRequest] Allowing ${hostname}: VPN is active`);
        return {};
      }
    });
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// ─── Proxy Request Handler ───────────────────────────────────────

/*async function handleProxyRequest(requestInfo) {
  const url      = new URL(requestInfo.url);
  const hostname = url.hostname.toLowerCase().trim();

  if (FORCE_DIRECT_HOSTS.has(hostname)) return DIRECT_CONN;

  return undefined;
}

browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ["<all_urls>"] });
*/

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "clearVpnCache") {
    clearVpnCache("manual message");
  }
});

// ─── Error Logging ───────────────────────────────────────────────

browser.proxy.onError.addListener(error => {
  console.error(`Proxy error: ${error.message}`);
});