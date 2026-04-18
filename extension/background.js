console.log('[CK-BG] Background service worker loaded v0.9.6 (Ollama+Optiq)');

var CK_BG_CONFIG = {
  BACKEND: 'ollama',
  OLLAMA_URL: 'http://localhost:11434',
  OPTIQ_URL: 'http://localhost:8080',
  OPTIQ_MODEL: 'FakeRockert543/gemma-4-e4b-it-MLX-4bit',
  WORKER_URL: 'https://aikeep24-web.hugh79757.workers.dev'
};

// 옵션 페이지에서 저장한 설정 로드
chrome.storage.local.get([
  'ck_backend', 'ck_ollama_url', 'ck_worker_url', 'ck_ollama_model', 'ck_api_key',
  'ck_optiq_url', 'ck_optiq_model'
], function(d) {
  if (d.ck_backend) CK_BG_CONFIG.BACKEND = d.ck_backend;
  if (d.ck_ollama_url) CK_BG_CONFIG.OLLAMA_URL = d.ck_ollama_url;
  if (d.ck_worker_url) CK_BG_CONFIG.WORKER_URL = d.ck_worker_url;
  if (d.ck_ollama_model) CK_BG_CONFIG.OLLAMA_MODEL = d.ck_ollama_model;
  if (d.ck_optiq_url) CK_BG_CONFIG.OPTIQ_URL = d.ck_optiq_url;
  if (d.ck_optiq_model) CK_BG_CONFIG.OPTIQ_MODEL = d.ck_optiq_model;
  console.log('[CK-BG] Settings loaded: backend=' + CK_BG_CONFIG.BACKEND,
    'ollama=' + CK_BG_CONFIG.OLLAMA_URL, 'optiq=' + CK_BG_CONFIG.OPTIQ_URL,
    'worker=' + CK_BG_CONFIG.WORKER_URL);
  if (!d.ck_api_key) {
    chrome.storage.local.set({ck_api_key: ''}, function() {
      console.log('[CK-BG] API key auto-configured');
    });
  }
});

// 옵션 변경 시 실시간 반영
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.ck_backend) CK_BG_CONFIG.BACKEND = changes.ck_backend.newValue;
  if (changes.ck_ollama_url) CK_BG_CONFIG.OLLAMA_URL = changes.ck_ollama_url.newValue;
  if (changes.ck_worker_url) CK_BG_CONFIG.WORKER_URL = changes.ck_worker_url.newValue;
  if (changes.ck_ollama_model) CK_BG_CONFIG.OLLAMA_MODEL = changes.ck_ollama_model.newValue;
  if (changes.ck_optiq_url) CK_BG_CONFIG.OPTIQ_URL = changes.ck_optiq_url.newValue;
  if (changes.ck_optiq_model) CK_BG_CONFIG.OPTIQ_MODEL = changes.ck_optiq_model.newValue;
  console.log('[CK-BG] Settings updated: backend=' + CK_BG_CONFIG.BACKEND);
});

setInterval(function() {
  if (ollamaRunning) {
    var url = CK_BG_CONFIG.BACKEND === 'optiq' ? CK_BG_CONFIG.OPTIQ_URL : CK_BG_CONFIG.OLLAMA_URL;
    fetch(url + '/').catch(function(){});
  }
}, 20000);

// === LLM Request Queue (Ollama or Optiq) ===
var ollamaQueue = [];
var ollamaRunning = false;
var activeTabId = null;

function processOllamaQueue() {
  if (ollamaRunning || ollamaQueue.length === 0) return;
  ollamaRunning = true;
  var item = ollamaQueue.shift();
  activeTabId = item.tabId;
  console.log('[CK-BG] Processing request from tab:', item.tabId,
    'backend:', CK_BG_CONFIG.BACKEND, 'Queue remaining:', ollamaQueue.length);
  broadcastQueueStatus();

  llmFetchWithRetry(item.payload, 2)
    .then(function(result) { item.callback(result); })
    .catch(function(err) { item.callback({ok: false, error: err.message}); })
    .finally(function() {
      ollamaRunning = false;
      activeTabId = null;
      broadcastQueueStatus();
      processOllamaQueue();
    });
}

function broadcastQueueStatus() {
  var pending = ollamaQueue.length;
  chrome.runtime.sendMessage({type: 'queue_status', pending: pending, running: ollamaRunning, activeTab: activeTabId}).catch(function(){});
}

// 백엔드 분기: ollama 또는 optiq
function llmFetchWithRetry(payload, retriesLeft) {
  if (CK_BG_CONFIG.BACKEND === 'optiq') {
    return optiqFetchWithRetry(payload, retriesLeft);
  }
  return ollamaFetchWithRetry(payload, retriesLeft);
}

function ollamaFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 180000);

  return fetch(CK_BG_CONFIG.OLLAMA_URL + '/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: (function() {
      var b = JSON.stringify(Object.assign({}, payload, {stream: false}));
      console.log('[CK-BG] Ollama req body length:', b.length, 'model:', payload.model);
      return b;
    })(),
    signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    console.log('[CK-BG] Ollama HTTP:', r.status, r.statusText);
    if (r.status !== 200) {
      return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)); });
    }
    return r.text();
  })
  .then(function(text) {
    console.log('[CK-BG] Ollama raw response length:', text.length);
    try {
      var data = JSON.parse(text);
      return {ok: true, response: data.response};
    } catch(e) {
      console.error('[CK-BG] Ollama JSON parse failed:', text.substring(0, 500));
      throw new Error('JSON parse: ' + e.message);
    }
  })
  .catch(function(err) {
    clearTimeout(timeoutId);
    console.error('[CK-BG] Ollama error:', err.message, 'retries:', retriesLeft);
    if (retriesLeft > 0) {
      console.log('[CK-BG] Retrying Ollama...');
      return ollamaFetchWithRetry(payload, retriesLeft - 1);
    }
    throw err;
  });
}

// Optiq (mlx_lm.server OpenAI 호환) 호출 → Ollama {response} 형식으로 래핑
function optiqFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 300000);

  // Ollama payload → OpenAI chat payload 변환
  var opts = payload.options || {};
  var systemMsg = '';
  if (payload.think === false) {
    systemMsg = '/no_think\nDo not output any thinking or reasoning. Output only the final answer directly.';
  }
  var messages = [];
  if (systemMsg) messages.push({role: 'system', content: systemMsg});
  messages.push({role: 'user', content: payload.prompt || ''});

  var body = {
    model: CK_BG_CONFIG.OPTIQ_MODEL || payload.model,
    messages: messages,
    max_tokens: opts.num_predict || 512,
    temperature: (typeof opts.temperature === 'number') ? opts.temperature : 0.3,
    stream: false
  };

  var b = JSON.stringify(body);
  console.log('[CK-BG] Optiq req body length:', b.length, 'model:', body.model,
    'max_tokens:', body.max_tokens);

  return fetch(CK_BG_CONFIG.OPTIQ_URL + '/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: b,
    signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    console.log('[CK-BG] Optiq HTTP:', r.status, r.statusText);
    if (r.status !== 200) {
      return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)); });
    }
    return r.text();
  })
  .then(function(text) {
    console.log('[CK-BG] Optiq raw response length:', text.length);
    try {
      var data = JSON.parse(text);
      var choice = (data.choices && data.choices[0]) || {};
      var msg = choice.message || {};
      var out = msg.content;
      if (!out || out.length === 0) {
        // thinking 모델 fallback: reasoning 필드에서 추출
        out = msg.reasoning || '';
      }
      if (!out) {
        console.error('[CK-BG] Optiq empty response:', text.substring(0, 500));
        throw new Error('Empty content from Optiq');
      }
      return {ok: true, response: out};
    } catch(e) {
      console.error('[CK-BG] Optiq JSON parse failed:', text.substring(0, 500));
      throw new Error('JSON parse: ' + e.message);
    }
  })
  .catch(function(err) {
    clearTimeout(timeoutId);
    console.error('[CK-BG] Optiq error:', err.message, 'retries:', retriesLeft);
    if (retriesLeft > 0) {
      console.log('[CK-BG] Retrying Optiq...');
      return optiqFetchWithRetry(payload, retriesLeft - 1);
    }
    throw err;
  });
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('[CK-BG] Message received:', request.type);

  if (request.type === 'ollama') {
    var tabId = sender.tab ? sender.tab.id : 0;
    ollamaQueue.push({payload: request.payload, callback: sendResponse, tabId: tabId});
    console.log('[CK-BG] Queued llm request from tab:', tabId, 'Queue size:', ollamaQueue.length);
    processOllamaQueue();
    return true;
  }

  if (request.type === 'queue_info') {
    sendResponse({pending: ollamaQueue.length, running: ollamaRunning});
    return true;
  }

  if (request.type === 'reload_extension') {
    console.log('[CK-BG] Reloading extension...');
    chrome.runtime.reload();
    return;
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

  if (request.type === 'save_snap') {
    chrome.storage.local.get(['ck_api_key'], function(data) {
      var apiKey = data.ck_api_key || '';
      if (!apiKey) { sendResponse({ok: false}); return; }
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session/snap', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(result) { console.log('[CK-BG] Snap saved:', JSON.stringify(result)); sendResponse(result); })
      .catch(function(err) { console.error('[CK-BG] Snap save error:', err.message); sendResponse({ok: false}); });
    });
    return true;
  }

  if (request.type === 'save_chunk') {
    chrome.storage.local.get(['ck_api_key'], function(data) {
      var apiKey = data.ck_api_key || '';
      if (!apiKey) { sendResponse({ok: false}); return; }
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session/chunk', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(result) { console.log('[CK-BG] Chunk saved:', JSON.stringify(result)); sendResponse(result); })
      .catch(function(err) { console.error('[CK-BG] Chunk save error:', err.message); sendResponse({ok: false}); });
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
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(result) { console.log('[CK-BG] Save result:', JSON.stringify(result)); sendResponse(result); })
      .catch(function(err) { console.error('[CK-BG] Save error:', err.message); sendResponse({ok: false, error: err.message}); });
    });
    return true;
  }
});
