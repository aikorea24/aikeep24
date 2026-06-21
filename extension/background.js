console.log('[CK-BG] Background service worker loaded v0.9.8 (Ollama+Optiq+Neurons+NVIDIA)');

var CK_BG_CONFIG = {
  BACKEND: 'ollama',
  OLLAMA_URL: 'http://localhost:11434',
  OPTIQ_URL: 'http://localhost:8080',
  OPTIQ_MODEL: 'FakeRockert543/gemma-4-e4b-it-MLX-4bit',
  NEURONS_URL: 'http://localhost:8080',
  NEURONS_MODEL: 'mlx-community/gemma-3-4b-it-qat-4bit',
  NVIDIA_API_KEY: '',
  NVIDIA_MODEL: 'google/diffusiongemma-26b-a4b-it',
  NVIDIA_FALLBACK_MODEL: 'meta/llama-3.3-70b-instruct',
  WORKER_URL: 'https://aikeep24-web.hugh79757.workers.dev'
};

chrome.storage.local.get([
  'ck_backend', 'ck_ollama_url', 'ck_worker_url', 'ck_ollama_model', 'ck_api_key',
  'ck_optiq_url', 'ck_optiq_model',
  'ck_neurons_url', 'ck_neurons_model',
  'ck_nvidia_api_key', 'ck_nvidia_model'
], function(d) {
  if (d.ck_backend)       CK_BG_CONFIG.BACKEND        = d.ck_backend;
  if (d.ck_ollama_url)    CK_BG_CONFIG.OLLAMA_URL     = d.ck_ollama_url;
  if (d.ck_worker_url)    CK_BG_CONFIG.WORKER_URL     = d.ck_worker_url;
  if (d.ck_ollama_model)  CK_BG_CONFIG.OLLAMA_MODEL   = d.ck_ollama_model;
  if (d.ck_optiq_url)     CK_BG_CONFIG.OPTIQ_URL      = d.ck_optiq_url;
  if (d.ck_optiq_model)   CK_BG_CONFIG.OPTIQ_MODEL    = d.ck_optiq_model;
  if (d.ck_neurons_url)   CK_BG_CONFIG.NEURONS_URL    = d.ck_neurons_url;
  if (d.ck_neurons_model) CK_BG_CONFIG.NEURONS_MODEL  = d.ck_neurons_model;
  if (d.ck_nvidia_api_key)CK_BG_CONFIG.NVIDIA_API_KEY = d.ck_nvidia_api_key;
  if (d.ck_nvidia_model)  CK_BG_CONFIG.NVIDIA_MODEL   = d.ck_nvidia_model;
  console.log('[CK-BG] Settings loaded: backend=' + CK_BG_CONFIG.BACKEND);
  if (!d.ck_api_key) chrome.storage.local.set({ck_api_key: ''});
});

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.ck_backend)        CK_BG_CONFIG.BACKEND         = changes.ck_backend.newValue;
  if (changes.ck_ollama_url)     CK_BG_CONFIG.OLLAMA_URL      = changes.ck_ollama_url.newValue;
  if (changes.ck_worker_url)     CK_BG_CONFIG.WORKER_URL      = changes.ck_worker_url.newValue;
  if (changes.ck_ollama_model)   CK_BG_CONFIG.OLLAMA_MODEL    = changes.ck_ollama_model.newValue;
  if (changes.ck_optiq_url)      CK_BG_CONFIG.OPTIQ_URL       = changes.ck_optiq_url.newValue;
  if (changes.ck_optiq_model)    CK_BG_CONFIG.OPTIQ_MODEL     = changes.ck_optiq_model.newValue;
  if (changes.ck_neurons_url)    CK_BG_CONFIG.NEURONS_URL     = changes.ck_neurons_url.newValue;
  if (changes.ck_neurons_model)  CK_BG_CONFIG.NEURONS_MODEL   = changes.ck_neurons_model.newValue;
  if (changes.ck_nvidia_api_key) CK_BG_CONFIG.NVIDIA_API_KEY  = changes.ck_nvidia_api_key.newValue;
  if (changes.ck_nvidia_model)   CK_BG_CONFIG.NVIDIA_MODEL    = changes.ck_nvidia_model.newValue;
  console.log('[CK-BG] Settings updated: backend=' + CK_BG_CONFIG.BACKEND);
});

setInterval(function() {
  if (ollamaRunning) {
    var url = CK_BG_CONFIG.BACKEND === 'neurons' ? CK_BG_CONFIG.NEURONS_URL
            : CK_BG_CONFIG.BACKEND === 'optiq'   ? CK_BG_CONFIG.OPTIQ_URL
            : CK_BG_CONFIG.OLLAMA_URL;
    fetch(url + '/').catch(function(){});
  }
}, 20000);

// === LLM Request Queue ===
var ollamaQueue = [];
var ollamaRunning = false;
var activeTabId = null;

function processOllamaQueue() {
  if (ollamaRunning || ollamaQueue.length === 0) return;
  ollamaRunning = true;
  var item = ollamaQueue.shift();
  activeTabId = item.tabId;
  console.log('[CK-BG] Processing request tab:', item.tabId, 'backend:', CK_BG_CONFIG.BACKEND, 'queue:', ollamaQueue.length);
  broadcastQueueStatus();

  llmFetchWithRetry(item.payload, 2)
    .then(function(result) { item.callback(result); })
    .catch(function(err)   { item.callback({ok: false, error: err.message}); })
    .finally(function() {
      ollamaRunning = false;
      activeTabId = null;
      broadcastQueueStatus();
      processOllamaQueue();
    });
}

function broadcastQueueStatus() {
  chrome.runtime.sendMessage({type: 'queue_status', pending: ollamaQueue.length, running: ollamaRunning, activeTab: activeTabId}).catch(function(){});
}

function llmFetchWithRetry(payload, retriesLeft) {
  if (CK_BG_CONFIG.BACKEND === 'nvidia')  return nvidiaFetchWithRetry(payload, retriesLeft, false);
  if (CK_BG_CONFIG.BACKEND === 'neurons') return neuronsFetchWithRetry(payload, retriesLeft);
  if (CK_BG_CONFIG.BACKEND === 'optiq')   return optiqFetchWithRetry(payload, retriesLeft);
  return ollamaFetchWithRetry(payload, retriesLeft);
}

// ── Ollama ──────────────────────────────────────────────
function ollamaFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 300000);

  return fetch(CK_BG_CONFIG.OLLAMA_URL + '/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(Object.assign({}, payload, {stream: false, keep_alive: "10m"})),
    signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    if (r.status !== 200) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0,200)); });
    return r.text();
  })
  .then(function(text) {
    var data = JSON.parse(text);
    return {ok: true, response: data.response};
  })
  .catch(function(err) {
    clearTimeout(timeoutId);
    if (retriesLeft > 0) return ollamaFetchWithRetry(payload, retriesLeft - 1);
    throw err;
  });
}

// ── Optiq / Neurons 공통 (OpenAI /v1/chat/completions) ──
function buildOpenAIBody(payload, model) {
  var opts = payload.options || {};
  var messages = [];
  if (payload.think === false) {
    messages.push({role: 'system', content: '/no_think\nDo not output any thinking or reasoning. Output only the final answer directly.'});
  }
  messages.push({role: 'user', content: payload.prompt || ''});
  return {
    model: model,
    messages: messages,
    max_tokens: opts.num_predict || 512,
    temperature: (typeof opts.temperature === 'number') ? opts.temperature : 0.3,
    stream: false
  };
}

function parseOpenAIResponse(text, name) {
  var data = JSON.parse(text);
  var choice = (data.choices && data.choices[0]) || {};
  var msg = choice.message || {};
  var out = msg.content || msg.reasoning || '';
  if (!out) throw new Error('Empty content from ' + name);
  return {ok: true, response: out};
}

function optiqFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 300000);
  var body = JSON.stringify(buildOpenAIBody(payload, CK_BG_CONFIG.OPTIQ_MODEL || payload.model));

  return fetch(CK_BG_CONFIG.OPTIQ_URL + '/v1/chat/completions', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: body, signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    if (r.status !== 200) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0,200)); });
    return r.text();
  })
  .then(function(text) { return parseOpenAIResponse(text, 'Optiq'); })
  .catch(function(err) {
    clearTimeout(timeoutId);
    if (retriesLeft > 0) return optiqFetchWithRetry(payload, retriesLeft - 1);
    throw err;
  });
}

function neuronsFetchWithRetry(payload, retriesLeft) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 300000);
  var body = JSON.stringify(buildOpenAIBody(payload, CK_BG_CONFIG.NEURONS_MODEL || payload.model));

  console.log('[CK-BG] Neurons req model:', CK_BG_CONFIG.NEURONS_MODEL, 'url:', CK_BG_CONFIG.NEURONS_URL);

  return fetch(CK_BG_CONFIG.NEURONS_URL + '/v1/chat/completions', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: body, signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    if (r.status !== 200) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0,200)); });
    return r.text();
  })
  .then(function(text) { return parseOpenAIResponse(text, 'Neurons'); })
  .catch(function(err) {
    clearTimeout(timeoutId);
    console.error('[CK-BG] Neurons error:', err.message, 'retries:', retriesLeft);
    if (retriesLeft > 0) return neuronsFetchWithRetry(payload, retriesLeft - 1);
    throw err;
  });
}

// ── NVIDIA ──────────────────────────────────────────────
function nvidiaFetchWithRetry(payload, retriesLeft, isFallback) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 60000);
  var model = isFallback ? CK_BG_CONFIG.NVIDIA_FALLBACK_MODEL : CK_BG_CONFIG.NVIDIA_MODEL;
  var body = JSON.stringify(buildOpenAIBody(payload, model));

  console.log('[CK-BG] NVIDIA ' + (isFallback ? 'fallback' : 'attempt') + ' model:', model);

  return fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CK_BG_CONFIG.NVIDIA_API_KEY
    },
    body: body,
    signal: controller.signal
  })
  .then(function(r) {
    clearTimeout(timeoutId);
    if (r.status !== 200) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0,200)); });
    return r.text();
  })
  .then(function(text) { return parseOpenAIResponse(text, 'NVIDIA'); })
  .catch(function(err) {
    clearTimeout(timeoutId);
    console.error('[CK-BG] NVIDIA error:', err.message, 'retries:', retriesLeft, 'isFallback:', isFallback);
    if (!isFallback) {
      console.log('[CK-BG] NVIDIA fallback to model:', CK_BG_CONFIG.NVIDIA_FALLBACK_MODEL);
      return nvidiaFetchWithRetry(payload, retriesLeft, true);
    }
    console.log('[CK-BG] NVIDIA final fallback to Ollama');
    return ollamaFetchWithRetry(payload, retriesLeft);
  });
}

// ── Message Handler ──────────────────────────────────────
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === 'ollama') {
    var tabId = sender.tab ? sender.tab.id : 0;
    ollamaQueue.push({payload: request.payload, callback: sendResponse, tabId: tabId});
    processOllamaQueue();
    return true;
  }
  if (request.type === 'queue_info') { sendResponse({pending: ollamaQueue.length, running: ollamaRunning}); return true; }
  if (request.type === 'reload_extension') { chrome.runtime.reload(); return; }
  if (request.type === 'ping') { sendResponse({ok: true, msg: 'pong'}); return true; }
  if (request.type === 'setkey') {
    chrome.storage.local.set({ck_api_key: request.key}, function() { sendResponse({ok: true}); });
    return true;
  }
  if (request.type === 'getkey') {
    chrome.storage.local.get(['ck_api_key'], function(data) { sendResponse({ok: true, key: data.ck_api_key || ''}); });
    return true;
  }
  if (request.type === 'save_snap') {
    chrome.storage.local.get(['ck_api_key'], function(data) {
      var apiKey = data.ck_api_key || '';
      if (!apiKey) { sendResponse({ok: false}); return; }
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session/snap', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      }).then(function(r) { return r.json(); }).then(function(r) { sendResponse(r); }).catch(function() { sendResponse({ok: false}); });
    });
    return true;
  }
  if (request.type === 'save_chunk') {
    chrome.storage.local.get(['ck_api_key'], function(data) {
      var apiKey = data.ck_api_key || '';
      if (!apiKey) { sendResponse({ok: false}); return; }
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session/chunk', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      }).then(function(r) { return r.json(); }).then(function(r) { sendResponse(r); }).catch(function() { sendResponse({ok: false}); });
    });
    return true;
  }
  if (request.type === 'save_session') {
    chrome.storage.local.get(['ck_api_key'], function(data) {
      var apiKey = data.ck_api_key || '';
      if (!apiKey) { sendResponse({ok: false, skipped: true, reason: 'No API key set'}); return; }
      fetch(CK_BG_CONFIG.WORKER_URL + '/api/session', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
        body: JSON.stringify(request.payload)
      }).then(function(r) { return r.json(); }).then(function(r) { sendResponse(r); }).catch(function(err) { sendResponse({ok: false, error: err.message}); });
    });
    return true;
  }
});
