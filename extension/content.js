/**
 * AIKeep24 Context Keeper v0.9 - Entry Point
 * 모듈 로드 순서: config -> dom-parser -> ollama -> api -> summarizer -> ui -> observer -> content
 */
(function() {
  var CK = window.CK;

  function init() {
    var target = document.querySelector('.conversation-content')
      || document.querySelector('.chat-wrapper')
      || document.body;

    CK.observer.observe(target, { childList: true, subtree: true });

    var bodyObserver = new MutationObserver(function() { CK.ensureUI(); });
    bodyObserver.observe(document.body, { childList: true });

    CK.ensureUI();

    // keepalive ping
    setInterval(function() {
      try { chrome.runtime.sendMessage({type: 'ping'}, function() { if (chrome.runtime.lastError) {} }); } catch(e) {}
    }, 20000);

    console.log('[CK] Context Keeper v0.9 active (modular + autorun + hash-detect)');
    CK.checkForNewTurns();

    var lastCheckedUrl = '';
    setInterval(function() {
      var currentUrl = window.location.href;
      if (currentUrl !== lastCheckedUrl && currentUrl.indexOf('id=') > -1) {
        lastCheckedUrl = currentUrl;
        setTimeout(CK.checkPreviousContext, 2000);
      }
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
