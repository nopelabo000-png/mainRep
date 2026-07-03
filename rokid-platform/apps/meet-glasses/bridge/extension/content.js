'use strict';

/**
 * 拡張の隔離ワールド側。chrome.storage の設定を読み、
 * MAIN world (inject.js) へ postMessage で届ける。変更も即時反映。
 */

const DEFAULTS = { enabled: false, server: '', room: 'default' };

function push(config) {
  window.postMessage({ type: 'MEET_BRIDGE_CONFIG', config }, '*');
}

chrome.storage.local.get({ bridge: DEFAULTS }, ({ bridge }) => push(bridge));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bridge) push(changes.bridge.newValue || DEFAULTS);
});
