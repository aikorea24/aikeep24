/**
 * AIKeep24 - Worker API 클라이언트
 */
(function() {
  var CK = window.CK;

  function getApiKey() {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({type: 'getkey'}, function(kr) {
        resolve((kr && kr.key) || '');
      });
    });
  }

  function workerFetch(path, options) {
    return getApiKey().then(function(apiKey) {
      if (!apiKey) return Promise.reject(new Error('No API key set'));
      var url = CK.CONFIG.WORKER_URL + path;
      var opts = options || {};
      opts.headers = opts.headers || {};
      opts.headers['Authorization'] = 'Bearer ' + apiKey;
      opts.headers['Content-Type'] = 'application/json';
      return fetch(url, opts).then(function(r) { return r.json(); });
    });
  }

  CK.getApiKey = getApiKey;

  CK.saveToWorker = function(sessionData) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({
        type: 'save_session',
        payload: sessionData
      }, function(resp) {
        if (resp && resp.ok) {
          console.log('[CK] Saved to D1:', resp.session_id);
          CK.updateBadge('CK Done! Saved to D1');
        } else if (resp && resp.skipped) {
          console.log('[CK] ' + resp.reason);
          CK.updateBadge('CK Done! (not saved)');
        } else {
          console.error('[CK] Save failed:', resp ? resp.error : 'no response');
          CK.updateBadge('CK Done! (save failed)');
        }
        resolve();
      });
    });
  };

  CK.saveChunk = function(payload) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({
        type: 'save_chunk',
        payload: payload
      }, function(r) {
        resolve(r);
      });
    });
  };

  CK.saveSnap = function(payload) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({
        type: 'save_snap',
        payload: payload
      }, function(r) {
        resolve(r || {});
      });
    });
  };

  CK.fetchSessionByUrl = function(pageUrl) {
    return workerFetch('/api/sessions/search?url=' + encodeURIComponent(pageUrl));
  };

  CK.fetchSession = function(sessionId) {
    return workerFetch('/api/session/' + encodeURIComponent(sessionId));
  };

  CK.fetchSessions = function(limit) {
    return workerFetch('/api/sessions?limit=' + (limit || 30));
  };

  CK.fetchSessionsByProject = function(project, limit) {
    return workerFetch('/api/sessions/search?project=' + encodeURIComponent(project) + '&limit=' + (limit || 10));
  };

  CK.fetchLatestByProject = function(project) {
    return workerFetch('/api/sessions/latest?project=' + encodeURIComponent(project));
  };

  CK.fetchProjects = function() {
    return workerFetch('/api/sessions/projects');
  };

  CK.vectorSearch = function(query, limit) {
    return workerFetch('/api/vector-search?q=' + encodeURIComponent(query) + '&limit=' + (limit || 8));
  };

  /**
   * D1에서 현재 세션의 마지막 턴 번호 조회
   */
  CK.fetchLastTurnFromD1 = function(chatId) {
    return CK.fetchSession(chatId).then(function(s) {
      if (s && s.chunks && s.chunks.length > 0) {
        var maxEnd = 0;
        s.chunks.forEach(function(c) {
          if ((c.turn_end || 0) > maxEnd) maxEnd = c.turn_end;
        });
        return maxEnd;
      }
      return 0;
    }).catch(function() { return 0; });
  };

  /**
   * INJ: 프로젝트 단위 누적 컨텍스트 (최근 N개 세션)
   */
  CK.fetchProjectContext = function(project) {
    return CK.fetchSessionsByProject(project, CK.CONFIG.INJ_MAX_SESSIONS).then(function(data) {
      var sessions = (data.sessions || []).slice(0, CK.CONFIG.INJ_MAX_SESSIONS);
      var promises = sessions.map(function(s) {
        return CK.fetchSession(s.session_id);
      });
      return Promise.all(promises);
    });
  };

})();
