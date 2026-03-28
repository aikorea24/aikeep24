/**
 * AIKeep24 - Observer (변경 감지 + 오토런)
 * 해시 기반 변경 감지 + 5분 idle 자동 실행
 */
(function() {
  var CK = window.CK;

  CK.checkForNewTurns = function() {
    var current = CK.extractTurns();
    if (current.length > CK.lastTurnCount) {
      var diff = current.length - CK.lastTurnCount;
      console.log('[CK] +' + diff + ' new turns, total: ' + current.length);
      CK.lastTurnCount = current.length;

      if (diff <= 50) {
        CK.lastNewTurnTime = Date.now();
        CK.autoRunTriggered = false;
        scheduleAutoRun();
      } else {
        console.log('[CK] Burst detected (+' + diff + '), auto-run skipped. Use Run button.');
        CK.autoRunTriggered = true;
      }
    }
  };

  /**
   * 오토런: 마지막 새 턴 감지 후 5분간 추가 턴 없을 때만 자동 실행
   * 대화 중에는 절대 트리거하지 않음
   */
  function scheduleAutoRun() {
    if (CK.autoRunTimer) clearTimeout(CK.autoRunTimer);
    CK.autoRunTimer = setTimeout(function() {
      // 5분 후 재확인: 그 사이 새 턴이 있었으면 다시 대기
      var now = Date.now();
      var elapsed = now - CK.lastNewTurnTime;
      if (elapsed < CK.CONFIG.AUTORUN_IDLE_MS - 1000) {
        // 아직 idle 시간 안 됨 (다른 턴이 중간에 왔음)
        console.log('[CK] AutoRun deferred, not idle enough (' + Math.round(elapsed / 1000) + 's)');
        scheduleAutoRun();
        return;
      }

      if (!CK.autoRunTriggered && !CK.isRunning && CK.enabled && CK.lastTurnCount >= 2) {
        // 해시 비교로 실제 변경 확인
        var turns = CK.extractTurns();
        var chatId = CK.getChatId();
        var hashKey = 'ck_last_hash_' + chatId;
        var currentHash = CK.computeTurnHash(turns);

        chrome.storage.local.get([hashKey], function(stored) {
          var savedHash = stored[hashKey] || '';
          if (savedHash === currentHash) {
            console.log('[CK] AutoRun skipped: hash unchanged');
            return;
          }
          CK.autoRunTriggered = true;
          console.log('[CK] AutoRun triggered (idle ' + Math.round(elapsed / 1000) + 's)');
          CK.updateBadge('Auto-running... (idle 5min)');
          CK.summarizeAll();
        });
      }
    }, CK.CONFIG.AUTORUN_IDLE_MS);
  }

  CK.observer = new MutationObserver(function() {
    clearTimeout(window._ckDebounce);
    window._ckDebounce = setTimeout(CK.checkForNewTurns, 1000);
  });

  CK.checkPreviousContext = function() {
    CK.getApiKey().then(function(apiKey) {
      if (!apiKey) return;
      CK.fetchSessionByUrl(window.location.href).then(function(data) {
        if (data.sessions && data.sessions.length > 0) return;
        return CK.fetchProjects();
      }).then(function(pData) {
        if (!pData || !pData.results || pData.results.length === 0) return;
        var badge = document.getElementById('ck-badge');
        if (!badge) return;
        badge.innerHTML = '<span style="color:#7c83ff;font-size:11px">이전 프로젝트 맥락 사용: </span>';
        var projects = pData.results.slice(0, 5);
        projects.forEach(function(p) {
          var btn = document.createElement('span');
          btn.textContent = p.project + '(' + p.cnt + ')';
          btn.style.cssText = 'background:#1a1a2e;color:#ffd166;padding:2px 6px;border-radius:4px;margin:0 2px;cursor:pointer;font-size:11px';
          btn.onclick = function() {
            CK.fetchLatestByProject(p.project).then(function(s) {
              if (!s || !s.session_id) return;
              var ctx = {
                summary: s.summary || '',
                topics: CK.tryParseJSON(s.topics) || [],
                key_decisions: CK.tryParseJSON(s.key_decisions) || [],
                tools: CK.tryParseJSON(s.tools) || [],
                project: s.project || '',
                status: s.status || '',
                checkpoint: s.checkpoint || '',
                chunks: (s.chunks || []).map(function(c) {
                  return { chunk_index: c.chunk_index, chunk_summary: c.chunk_summary, chunk_checkpoint: c.chunk_checkpoint, turn_start: c.turn_start, turn_end: c.turn_end, project: c.project || '' };
                }),
                _fromD1: true
              };
              var text = CK.buildContext(ctx, 'full');
              navigator.clipboard.writeText(text).then(function() {
                CK.updateBadge(p.project + ' 맥락 복사됨! Cmd+V로 붙여넣기');
                setTimeout(function() { badge.style.display = 'none'; }, 5000);
              });
            });
          };
          badge.appendChild(btn);
        });
        badge.style.display = 'block';
      }).catch(function() {});
    });
  };

  CK.ensureUI = function() {
    if (!document.getElementById('ck-panel') && document.body) {
      console.log('[CK] Inserting ck-panel');
      CK.createUI();
    }
  };

})();
