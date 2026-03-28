/**
 * AIKeep24 - DOM 파서 (Genspark 대화 추출)
 */
(function() {
  var CK = window.CK;

  /**
   * 현재 URL에서 플랫폼을 자동 감지한다.
   */
  CK.detectPlatform = function() {
    var host = window.location.hostname;
    var platforms = CK.CONFIG.PLATFORMS;
    for (var key in platforms) {
      if (host.indexOf(platforms[key].hostMatch) > -1) return platforms[key];
    }
    return platforms.genspark; // fallback
  };

  CK.getChatId = function() {
    var path = window.location.pathname;
    // ChatGPT: /c/uuid
    var chatgptMatch = path.match(/\/c\/([a-f0-9-]+)/);
    if (chatgptMatch) return chatgptMatch[1];
    // Genspark: ?id=xxx
    try {
      var params = new URLSearchParams(window.location.search);
      var id = params.get('id');
      if (id) return id;
    } catch(e) {}
    return path.replace(/\//g, '_');
  };

  CK.extractTurns = function() {
    var platform = CK.detectPlatform();
    var els = document.querySelectorAll(platform.turnSelector);
    var result = [];
    els.forEach(function(el) {
      var role = platform.roleDetect(el);
      var text = el.innerText.trim();
      if (text.length > 0) {
        result.push({ role: role, text: text });
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
    var platform = CK.detectPlatform();
    if (platform.skipSelectors) {
      var imgEls = document.querySelectorAll(platform.skipSelectors);
      var turnEls = document.querySelectorAll(platform.turnSelector);
      if (imgEls.length > 0 && turnEls.length <= 4) return true;
    }
    return false;
  };

})();
