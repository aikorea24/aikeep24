console.log('[CK-BG] Background service worker loaded');

// === Ollama Queue ===
var ollamaQueue = [];
var ollamaRunning = false;

function processOllamaQueue() {
  if (ollamaRunning || ollamaQueue.length === 0) return;
  ollamaRunning = true;
  var item = ollamaQueue.shift();
  broadcastQueueStatus();

  ollamaFetchWithRetry(item.payload, 1)
    .then(function(result) {
      item.callback(result);
    })
    .catch(function(err) {
      item.callback({ok: false, error: err.message});
    })
    .finally(function() {
      ollamaRunning = false;
      broadcastQueueStatus();
      processOllamaQueue();
    });
}

function broadcastQueueStatus() {
  var pending = ollamaQueue.length;
  chrome.runtime.sendMessage({type: 'queue_status', pending: pending, running: ollamaRunning}).catch(function(){});
}

function ollamaFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 90000);

  return fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
    signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    return r.text();
  })
  .then(function(text) {
    try {
      var data = JSON.parse(text);
      return {ok: true, response: data.response};
    } catch(e) {
      throw new Error('JSON parse: ' + e.message);
    }
  })
  .catch(function(err) {
    clearTimeout(timeoutId);
    console.error('[CK-BG] Ollama error:', err.message, 'retries:', retriesLeft);
    if (retriesLeft > 0) {
      console.log('[CK-BG] Retrying...');
      return ollamaFetchWithRetry(payload, retriesLeft - 1);
    }
    throw err;
  });
}

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    console.log('[CK-BG] Message received:', request.type);

    if (request.type === 'ollama') {
      ollamaQueue.push({payload: request.payload, callback: sendResponse});
      console.log('[CK-BG] Queued ollama request. Queue size:', ollamaQueue.length);
      processOllamaQueue();
      return true;
    }

    if (request.type === 'queue_info') {
      sendResponse({pending: ollamaQueue.length, running: ollamaRunning});
      return true;
    }

    if (request.type === 'ping') {
      sendResponse({ok: true, msg: 'pong'});
      return true;
    }

    if (request.type === 'setkey') {
      chrome.storage.local.set({ck_api_key: request.key}, function() {
        console.log('[CK-BG] API key saved');
        sendResponse({ok: true});
      });
      return true;
    }

    if (request.type === 'getkey') {
      chrome.storage.local.get(['ck_api_key'], function(data) {
        sendResponse({ok: true, key: data.ck_api_key || ''});
      });
      return true;
    }

    if (request.type === 'save_session') {
      chrome.storage.local.get(['ck_api_key'], function(data) {
        var apiKey = data.ck_api_key || '';
        if (!apiKey) {
          sendResponse({ok: false, skipped: true, reason: 'No API key set'});
          return;
        }
        console.log('[CK-BG] Saving session to D1...');
        fetch('https://ods-mobile.hugh79757.workers.dev/api/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify(request.payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          console.log('[CK-BG] Save result:', JSON.stringify(result));
          sendResponse(result);
        })
        .catch(function(err) {
          console.error('[CK-BG] Save error:', err.message);
          sendResponse({ok: false, error: err.message});
        });
      });
      return true;
    }
  }
);
