'use strict';

const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: false, server: '', room: 'default' };

chrome.storage.local.get({ bridge: DEFAULTS }, ({ bridge }) => {
  $('server').value = bridge.server || '';
  $('room').value = bridge.room || 'default';
  $('enabled').checked = !!bridge.enabled;
});

$('save').addEventListener('click', () => {
  const bridge = {
    enabled: $('enabled').checked,
    server: $('server').value.trim(),
    room: $('room').value.trim() || 'default',
  };
  chrome.storage.local.set({ bridge }, () => {
    $('saved').textContent = '保存しました。Meet のタブを再読み込みしてください。';
    setTimeout(() => ($('saved').textContent = ''), 3000);
  });
});
