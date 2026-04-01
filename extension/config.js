/**
 * AIKeep24 Extension - 공통 설정
 */
var CK = window.CK || {};

CK.CONFIG = {
  TURNS_PER_CHUNK: 20,
  OLLAMA_URL: 'http://localhost:11434/api/generate',
  OLLAMA_MODEL: 'exaone3.5:7.8b',
  WORKER_URL: 'https://aikeep24-web.hugh79757.workers.dev',
  AUTORUN_IDLE_MS: 300000,
  HASH_PREFIX_LEN: 100,
  SKIP_PATTERNS: ['/image/', '/draw/', '/art/'],
  INJ_MAX_SESSIONS: 5,
  KNOWN_PROJECTS: ['AIKeep24', 'TV-show', 'TAP', 'aikorea24', 'news-keyword-pro', 'KDE-keepalive'],
  PLATFORMS: {
    genspark: {
      hostMatch: 'genspark.ai',
      turnSelector: '.conversation-item-desc',
      roleDetect: function(el) { return el.classList.contains('user') ? 'user' : 'assistant'; },
      skipSelectors: 'img[src*="generated"], img[src*="dalle"], .image-generation'
    },
    chatgpt: {
      hostMatch: 'chatgpt.com',
      turnSelector: '[data-message-author-role]',
      roleDetect: function(el) { return el.getAttribute('data-message-author-role') || 'assistant'; },
      skipSelectors: ''
    },
    claude: {
      hostMatch: 'claude.ai',
      turnSelector: null,
      roleDetect: 'parent-structure',
      skipSelectors: ''
    }
  }
};

CK.enabled = true;
CK.isRunning = false;
CK.lastTurnCount = 0;
CK.lastNewTurnTime = 0;
CK.autoRunTimer = null;
CK.autoRunTriggered = false;

CK.hashText = function(text) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

CK.tryParseJSON = function(str) {
  try { return JSON.parse(str); } catch(e) { return []; }
};

// chrome.storage에서 사용자 설정 로드
CK.loadSettings = function(callback) {
  var keys = [
    'ck_ollama_model', 'ck_ollama_url', 'ck_worker_url',
    'ck_num_ctx', 'ck_num_predict', 'ck_temperature',
    'ck_turns_per_chunk', 'ck_max_text_len'
  ];
  chrome.storage.local.get(keys, function(data) {
    if (data.ck_ollama_model) CK.CONFIG.OLLAMA_MODEL = data.ck_ollama_model;
    if (data.ck_ollama_url) {
      CK.CONFIG.OLLAMA_URL = data.ck_ollama_url + '/api/generate';
      CK.CONFIG.OLLAMA_TAGS_URL = data.ck_ollama_url + '/api/tags';
    }
    if (data.ck_worker_url) CK.CONFIG.WORKER_URL = data.ck_worker_url;
    if (data.ck_num_ctx) CK.CONFIG.NUM_CTX = parseInt(data.ck_num_ctx);
    if (data.ck_num_predict) CK.CONFIG.NUM_PREDICT = parseInt(data.ck_num_predict);
    if (data.ck_temperature) CK.CONFIG.TEMPERATURE = parseFloat(data.ck_temperature);
    if (data.ck_turns_per_chunk) CK.CONFIG.TURNS_PER_CHUNK = parseInt(data.ck_turns_per_chunk);
    if (data.ck_max_text_len) CK.CONFIG.MAX_TEXT_LEN = parseInt(data.ck_max_text_len);
    CK.CONFIG.THINKING = data.ck_thinking === 'true';
    console.log('[CK] Settings loaded:', CK.CONFIG.OLLAMA_MODEL, CK.CONFIG.WORKER_URL);
    if (callback) callback();
  });
};

window.CK = CK;
