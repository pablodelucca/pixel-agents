/**
 * ws-adapter.js
 *
 * Replaces VS Code's postMessage API with a WebSocket connection so the
 * Pixel Agents React webview can run standalone in a regular browser.
 *
 * This script MUST be loaded BEFORE the React application bundle.
 */
(function () {
  'use strict';

  const WS_URL = 'ws://localhost:3333';
  const RECONNECT_INTERVAL_MS = 2000;
  const STATE_KEY = 'pixel-agents-state';

  let ws = null;
  let messageQueue = [];
  let isConnected = false;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getPersistedState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setPersistedState(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable (private mode, quota, etc.)
    }
  }

  function sendRaw(msg) {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      messageQueue.push(payload);
    }
  }

  function flushQueue() {
    while (messageQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(messageQueue.shift());
    }
  }

  // ---------------------------------------------------------------------------
  // Fake VS Code API
  // ---------------------------------------------------------------------------

  const vscodeApi = {
    postMessage: function (msg) {
      sendRaw(msg);
    },
    getState: function () {
      return getPersistedState();
    },
    setState: function (state) {
      setPersistedState(state);
      return state;
    },
  };

  // The real VS Code webview exposes acquireVsCodeApi() exactly once.
  // We replicate that behaviour: the first call creates, subsequent calls
  // return the same cached instance.
  let acquired = false;
  window.acquireVsCodeApi = function () {
    if (!acquired) {
      acquired = true;
    }
    return vscodeApi;
  };

  // ---------------------------------------------------------------------------
  // WebSocket connection with auto-reconnect
  // ---------------------------------------------------------------------------

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return; // already connected or connecting
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
      console.log('[ws-adapter] connected to', WS_URL);
      isConnected = true;

      // Flush any messages that were queued while disconnected
      flushQueue();

      // Notify the server that the webview is ready
      sendRaw({ type: 'webviewReady' });
    };

    ws.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        // Dispatch as a regular window MessageEvent so the React app picks it
        // up via its `window.addEventListener('message', handler)` listener.
        window.dispatchEvent(new MessageEvent('message', { data: data }));
      } catch (err) {
        console.error('[ws-adapter] failed to parse incoming message:', err, event.data);
      }
    };

    ws.onerror = function (err) {
      console.warn('[ws-adapter] WebSocket error:', err);
    };

    ws.onclose = function () {
      console.warn('[ws-adapter] disconnected — will retry in', RECONNECT_INTERVAL_MS, 'ms');
      isConnected = false;
      ws = null;
      setTimeout(connect, RECONNECT_INTERVAL_MS);
    };
  }

  // Kick off the first connection attempt immediately
  connect();
})();
