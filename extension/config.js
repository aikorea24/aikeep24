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

window.CK = CK;
