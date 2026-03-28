/**
 * AIKeep24 - DOM 파서 (Genspark 대화 추출)
 */
(function() {
  var CK = window.CK;

  CK.getChatId = function() {
    try {
      var params = new URLSearchParams(window.location.search);
      var id = params.get('id');
      if (id) return id;
    } catch(e) {}
    return window.location.pathname.replace(/\//g, '_');
  };

  CK.extractTurns = function() {
    var els = document.querySelectorAll('.conversation-item-desc');
    var result = [];
    els.forEach(function(el) {
      var isUser = el.classList.contains('user');
      var text = el.innerText.trim();
      if (text.length > 0) {
        result.push({ role: isUser ? 'user' : 'assistant', text: text });
      }
    });
    return result;
  };

  CK.formatChunk = function(turnList) {
    return turnList.map(function(t) {
      var label = t.role === 'user' ? 'USER' : 'ASSISTANT';
      return '[' + label + ']\n' + t.text;
    }).join('\n\n---\n\n');
  };

  /**
   * 해시 기반 변경 감지: 마지막 턴 텍스트의 앞 N자를 해시
   */
  CK.computeTurnHash = function(turns) {
    if (!turns || turns.length === 0) return '';
    var lastText = turns[turns.length - 1].text || '';
    var prefix = lastText.substring(0, CK.CONFIG.HASH_PREFIX_LEN);
    return CK.hashText(prefix);
  };

  /**
   * 대화 유형 필터링: 요약 불필요한 대화인지 판단
   */
  CK.shouldSkipConversation = function() {
    var url = window.location.href;
    var patterns = CK.CONFIG.SKIP_PATTERNS;
    for (var i = 0; i < patterns.length; i++) {
      if (url.indexOf(patterns[i]) > -1) return true;
    }
    var imgEls = document.querySelectorAll('img[src*="generated"], img[src*="dalle"], .image-generation');
    var turnEls = document.querySelectorAll('.conversation-item-desc');
    if (imgEls.length > 0 && turnEls.length <= 4) return true;
    return false;
  };

})();
