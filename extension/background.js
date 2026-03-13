console.log('[CK-BG] Background service worker loaded');

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    console.log('[CK-BG] Message received:', request.type);

    if (request.type === 'ollama') {
      console.log('[CK-BG] Calling Ollama...');
      fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(request.payload)
      })
      .then(function(r) {
        console.log('[CK-BG] Fetch status:', r.status);
        return r.text();
      })
      .then(function(text) {
        console.log('[CK-BG] Response length:', text.length);
        console.log('[CK-BG] Response preview:', text.substring(0, 200));
        try {
          var data = JSON.parse(text);
          sendResponse({ok: true, response: data.response});
        } catch(e) {
          console.error('[CK-BG] JSON parse error:', e.message);
          sendResponse({ok: false, error: 'JSON parse: ' + e.message});
        }
      })
      .catch(function(err) {
        console.error('[CK-BG] Fetch error:', err.message);
        sendResponse({ok: false, error: err.message});
      });
      return true;
    }

    if (request.type === 'ping') {
      console.log('[CK-BG] Ping received');
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
          console.log('[CK-BG] No API key, skipping save');
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
