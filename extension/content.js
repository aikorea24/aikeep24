(function() {
  var CONFIG = {
    TURNS_PER_CHUNK: 20,
    OLLAMA_URL: 'http://localhost:11434/api/generate',
    MODEL: 'exaone3.5:7.8b',
    WORKER_URL: 'https://aikeep24-web.hugh79757.workers.dev',
    API_KEY: ''
  };


  function getChatId() {
    try {
      var params = new URLSearchParams(window.location.search);
      var id = params.get('id');
      if (id) return id;
    } catch(e) {}
    return window.location.pathname.replace(/\//g, '_');
  }

  function saveToWorker(sessionData) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({
        type: 'save_session',
        payload: sessionData
      }, function(resp) {
        if (resp && resp.ok) {
          console.log('[CK] Saved to D1:', resp.session_id);
          updateBadge('CK Done! Saved to D1');
        } else if (resp && resp.skipped) {
          console.log('[CK] ' + resp.reason);
          updateBadge('CK Done! (not saved)');
        } else {
          console.error('[CK] Save failed:', resp ? resp.error : 'no response');
          updateBadge('CK Done! (save failed)');
        }
        resolve();
      });
    });
  }

  var lastTurnCount = 0;
  var isRunning = false;

  function extractTurns() {
    var els = document.querySelectorAll(
      '.conversation-item-desc'
    );
    var result = [];
    els.forEach(function(el) {
      var isUser = el.classList.contains('user');
      var text = el.innerText.trim();
      if (text.length > 0) {
        result.push({
          role: isUser ? 'user' : 'assistant',
          text: text
        });
      }
    });
    return result;
  }

  function formatChunk(turnList) {
    return turnList.map(function(t) {
      var label = t.role === 'user' ? 'USER' : 'ASSISTANT';
      return '[' + label + ']\n' + t.text;
    }).join('\n\n---\n\n');
  }

  function callOllama(prompt, maxTokens) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'ollama',
        payload: {
          model: CONFIG.MODEL,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: maxTokens || 512,
            num_ctx: 4096
          }
        }
      }, function(resp) {
        if (resp && resp.ok) {
          resolve(resp.response);
        } else {
          reject(new Error(resp ? resp.error : 'no response'));
        }
      });
    });
  }

  function parseJson(text) {
    var m = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (m) {
      try { return JSON.parse(m[1]); } catch(e) {}
    }
    var s = text.indexOf('{');
    var e = text.lastIndexOf('}') + 1;
    if (s >= 0 && e > s) {
      try { return JSON.parse(text.substring(s, e)); }
      catch(ex) {}
    }
    var jsonBlocks = text.match(/\{[^{}]+\}/g);
    if (jsonBlocks && jsonBlocks.length > 1) {
      var merged = {};
      jsonBlocks.forEach(function(b) {
        try { var obj = JSON.parse(b); Object.keys(obj).forEach(function(k){ merged[k] = obj[k]; }); } catch(ee) {}
      });
      if (Object.keys(merged).length >= 2) { return merged; }
    }
    return null;
  }

  function parseCheckpoint(text) {
    var m = text.match(/```[Cc]heckpoint\s*\n([\s\S]*?)\n```/);
    if (m) { console.log('[CK] checkpoint parsed (fenced), len:', m[1].trim().length); return m[1].trim(); }
    m = text.match(/```checkpoint([\s\S]*?)```/i);
    if (m) { console.log('[CK] checkpoint parsed (loose), len:', m[1].trim().length); return m[1].trim(); }
    var idx = text.indexOf('# 맥락');
    if (idx < 0) idx = text.indexOf('# Context');
    if (idx < 0) idx = text.indexOf('checkpoint');
    if (idx >= 0) { console.log('[CK] checkpoint fallback at idx:', idx); return text.substring(idx, idx+600).trim(); }
    console.log('[CK] checkpoint NOT FOUND in response. Last 200 chars:', text.slice(-200));
    return '';
  }

  function updateBadge(msg) {
    var el = document.getElementById('ck-badge');
    if (el) { el.innerText = msg; el.style.display = 'block'; }
  }

  function summarizeAll() {
    if (isRunning) {
      console.log('[CK] Already running, ignoring click');
      return;
    }
    isRunning = true;
    var runBtn = document.getElementById('ck-run-btn');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.style.background = '#666';
      runBtn.style.cursor = 'not-allowed';
      runBtn.innerText = 'Running...';
    }
    var allTurns = extractTurns();
    if (allTurns.length < 2) {
      updateBadge('CK: Not enough turns');
      isRunning = false;
      if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#86efac'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'RUN'; }
      return;
    }

    var chatId = getChatId();
    var storageKey = 'ck_last_turn_' + chatId;

    // D1에서 실제 마지막 턴 조회
    chrome.runtime.sendMessage({type: 'getkey'}, function(kr) {
      var apiKey = (kr && kr.key) || '';
      var d1LastTurn = 0;
      var checkD1 = apiKey ? fetch(CONFIG.WORKER_URL + '/api/session/' + chatId, {
        headers: {'Authorization': 'Bearer ' + apiKey}
      }).then(function(r) { return r.json(); }).then(function(s) {
        if (s && s.chunks && s.chunks.length > 0) {
          var maxEnd = 0;
          s.chunks.forEach(function(c) { if ((c.turn_end || 0) > maxEnd) maxEnd = c.turn_end; });
          d1LastTurn = maxEnd;
        }
      }).catch(function() {}) : Promise.resolve();

      checkD1.then(function() {
        chrome.storage.local.get([storageKey], function(stored) {
          var localLast = (stored && stored[storageKey]) || 0;
          var lastTurn = (d1LastTurn > allTurns.length) ? 0 : (d1LastTurn || localLast);
          console.log('[CK] D1 last turn:', d1LastTurn, 'Local last:', localLast, 'Using:', lastTurn);
          var newTurns = allTurns.slice(lastTurn);
          console.log('[CK] Total turns:', allTurns.length, 'Last summarized:', lastTurn, 'New turns:', newTurns.length);

      if (newTurns.length < 2) {
        updateBadge('CK: No new turns');
        isRunning = false;
        if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#86efac'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'RUN'; }
        return;
      }

      var chunks = [];
      for (var i = 0; i < newTurns.length; i += CONFIG.TURNS_PER_CHUNK) {
        chunks.push(newTurns.slice(i, i + CONFIG.TURNS_PER_CHUNK));
      }

      updateBadge('CK: 0/' + chunks.length + '...');
      console.log('[CK] Start: ' + newTurns.length + ' new turns, ' + chunks.length + ' chunks (from turn ' + lastTurn + ')');

    var results = [];
    var chain = Promise.resolve();

    chunks.forEach(function(chunk, ci) {
      chain = chain.then(function() {
        updateBadge('CK: ' + (ci+1) + '/' + chunks.length);
        var text = formatChunk(chunk);
        if (text.length > 15000) {
          text = text.substring(0, 15000);
        }
          var p = '[SYSTEM] 반드시 ```json과 ```checkpoint 형식만 출력하세요. 대화 내용을 그대로 반복하거나 분석하지 마세요. 설명 없이 바로 JSON 블록으로 시작하세요.\n\n'
            + '[FORMAT]\n'
            + '```json\n'
            + '{"summary":"2~3문장 요약","topics":["주제1"],"key_decisions":["결정1"],"tools":["기술1"],"project":"프로젝트명","completed":["완료항목1","완료항목2"],"unresolved":["미해결1"],"files_modified":["파일1.py"]}\n'
            + '```\n\n'
            + '```checkpoint\n'
            + '완료: 항목 나열. 미해결: 항목+이유. 다음단계: 구체적 작업.\n'
            + '```\n'
            + '[/FORMAT]\n\n'
            + '[RULES]\n'
            + '- 반드시 아래 대화 원문에 실제로 등장하는 내용만 요약하세요. 원문에 없는 내용을 추가하거나 지어내면 안 됩니다.\n'
            + '- summary: 원문에서 실제로 논의된 구체적 주제와 결론을 2~3문장으로.\n'
            + '- completed: 이 구간에서 실제로 완료된 작업을 구체적으로 나열. 코드 수정, 배포, 설정 변경 등.\n'
            + '- unresolved: 이 구간에서 해결되지 않은 이슈, 에러, TODO를 구체적으로 나열. 없으면 빈 배열.\n'
            + '- files_modified: 이 구간에서 수정/생성/삭제된 파일 경로. 언급된 것만.\n'
            + '- tools: 대화에서 실제로 언급된 기술, 도구, 서비스만 추출. 언급 안 된 도구는 절대 넣지 마세요.\n'
            + '- project: 반드시 다음 중 하나만 사용=[AIKeep24, TV-show, TAP, aikorea24, news-keyword-pro, KDE-keepalive]. 대화 내용이 이 목록의 프로젝트와 관련 없으면 반드시 "unknown"으로 설정. 새 이름을 만들지 마세요.\n'
            + '[/RULES]\n\n'
            + '전체 ' + chunks.length + '개 구간 중 ' + (ci+1) + '번째 대화를 분석하세요:\n\n' + text;
        console.log('[CK] Prompt preview:', text.substring(0, 200)); return callOllama(p, 384);
      }).then(function(resp) {
        console.log('[CK] Chunk ' + (ci+1) + ' raw first 300:', resp.substring(0, 300));
        var fm = parseJson(resp);
        var cp = parseCheckpoint(resp);
        console.log('[CK] Chunk ' + (ci+1) + ':',
          fm ? (fm.summary || '').substring(0, 80) : 'fail');
        results.push({frontmatter: fm, checkpoint: cp});
        // 청크 단위 D1 저장
        if (fm) {
          try {
            chrome.runtime.sendMessage({
              type: 'save_chunk',
              payload: {
                session_id: chatId,
                url: window.location.href,
                chunk_index: ci,
                chunk_summary: fm.summary || '',
                chunk_checkpoint: cp || '',
                turn_start: ci * CONFIG.TURNS_PER_CHUNK,
                turn_end: Math.min((ci + 1) * CONFIG.TURNS_PER_CHUNK, allTurns.length),
                raw_content: formatChunk(chunks[ci]),
                frontmatter: fm,
                project: fm.project || ''
              }
            }, function(r) {
              console.log('[CK] Chunk ' + (ci+1) + ' saved to D1');
            });
          } catch(e) { console.warn('[CK] Chunk save failed:', e); }
        }
      }).catch(function(err) {
        console.error('[CK] Chunk ' + (ci+1) + ':', err);
        results.push({frontmatter: null, checkpoint: ''});
      });
    });

    chain.then(function() {
      var valid = results.filter(function(r) {
        return r.frontmatter;
      });
      if (valid.length === 0) {
        updateBadge('CK: All failed');
        return;
      }

      // Final/checkpoint Ollama 호출 제거 - 청크 데이터에서 직접 세션 정보 조립
      updateBadge('CK: Saving...');
      console.log('[CK] Preparing save (no Final). results count:', results.length, 'valid count:', valid.length);

      // 청크 데이터에서 태그 병합
      var allTopics = [], allTools = [], allDecisions = [], allFiles = [];
      var lastProject = '', lastStatus = '진행중';
      valid.forEach(function(r) {
        var f = r.frontmatter;
        (f.topics || []).forEach(function(t) { if (allTopics.indexOf(t) === -1) allTopics.push(t); });
        (f.tools || []).forEach(function(t) { if (allTools.indexOf(t) === -1) allTools.push(t); });
        (f.key_decisions || []).forEach(function(d) { if (allDecisions.indexOf(d) === -1) allDecisions.push(d); });
        (f.files_modified || []).forEach(function(fi) { if (allFiles.indexOf(fi) === -1) allFiles.push(fi); });
        if (f.project) lastProject = f.project;
        if (f.status) lastStatus = f.status;
      });

      // 마지막 청크의 summary를 세션 summary로 사용
      var lastValid = valid[valid.length - 1].frontmatter;
      var sessionSummary = lastValid.summary || '';

      // 최근 3개 청크 summary를 checkpoint으로 조립
      var recentChunks = valid.slice(-3);
      var checkpoint = recentChunks.map(function(r) {
        return r.frontmatter.summary || '';
      }).filter(function(s) { return s.length > 0; }).join(' \u2192 ');

      var chunkData = chunks.map(function(chunk, i) {
        var raw = formatChunk(chunk);
        return {
          turn_start: i * CONFIG.TURNS_PER_CHUNK + 1,
          turn_end: Math.min((i + 1) * CONFIG.TURNS_PER_CHUNK, allTurns.length),
          summary: results[i] && results[i].frontmatter ? (results[i].frontmatter.summary || '') : '',
          checkpoint: results[i] ? (results[i].checkpoint || '') : '',
          topics: results[i] && results[i].frontmatter ? (results[i].frontmatter.topics || []) : [],
          key_decisions: results[i] && results[i].frontmatter ? (results[i].frontmatter.key_decisions || []) : [],
          raw_content: raw
        };
      });

      var msg = 'CK Done!\n' + sessionSummary.substring(0, 150);
      updateBadge(msg);

      console.log('[CK] Calling saveToWorker now...');
      return saveToWorker({
        source: 'genspark',
        url: window.location.href,
        title: document.title || 'Genspark Chat',
        summary: sessionSummary,
        topics: allTopics,
        key_decisions: allDecisions,
        tools: allTools,
        project: lastProject,
        status: lastStatus,
        checkpoint: checkpoint,
        total_turns: allTurns.length,
        chunks: chunkData
      }).then(function() {
        var saveObj = {};
        saveObj[storageKey] = allTurns.length;
        chrome.storage.local.set(saveObj, function() {
          console.log('[CK] Saved last turn:', allTurns.length, 'for chat:', chatId);
        });
        lastTurnCount = allTurns.length;
        autoSaveTriggered = true;
        if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
        console.log('[CK] Auto-save blocked until next new turn');
      });

    }).catch(function(chainErr) {
      console.error('[CK] Chain error:', chainErr);
    }).finally(function() {
      console.log('[CK] .finally() reached, resetting state');
      isRunning = false;
      var runBtn = document.getElementById('ck-run-btn');
      if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#86efac'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'RUN'; }
    });
    }); }); });
  }

  function createUI() {
    var panel = document.createElement('div');
    panel.id = 'ck-panel';
    panel.style.cssText = 'position:fixed;bottom:120px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:6px;align-items:flex-end;padding:2px 0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    var badge = document.createElement('div');
    badge.id = 'ck-badge';
    badge.style.cssText = 'display:none;background:rgba(20,25,40,0.92);color:#b0b8c8;font-size:11px;padding:4px 10px;border-radius:12px;max-width:320px;line-height:1.4;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.08);'
      + 'padding:8px 12px;border-radius:6px;font-size:12px;'
      + 'font-family:monospace;max-width:350px;'
      + 'white-space:pre-wrap;display:none;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,0.5);';

    var btnBox = document.createElement('div');
    btnBox.style.cssText = 'display:flex;gap:4px;align-items:center;';

    var btnRun = document.createElement('button');
    btnRun.id = 'ck-run-btn';
    btnRun.innerText = 'RUN';
    btnRun.style.cssText = 'background:#86efac;color:#0f172a;border:1.5px solid #0f172a;box-shadow:2px 2px 0px #0f172a;border-radius:3px;padding:2px 10px;font-size:9px;font-weight:700;cursor:pointer;transition:all 0.15s ease;text-transform:uppercase;letter-spacing:0.5px;line-height:1.4;';
    var holdTimer = null;
    btnRun.onmousedown = function() {
      holdTimer = setTimeout(function() {
        holdTimer = 'held';
        badge.style.display = 'block';
        badge.innerText = 'CK: Reloading...';
        chrome.runtime.sendMessage({type: 'reload_extension'}, function() {
          badge.innerText = 'CK: Reloaded! Refreshing...';
          setTimeout(function() { location.reload(); }, 1000);
        });
      }, 2000);
    };
    btnRun.onmouseup = function() {
      if (holdTimer === 'held') { holdTimer = null; return; }
      clearTimeout(holdTimer);
      holdTimer = null;
      badge.style.display = 'block';
      summarizeAll();
    };
    btnRun.onmouseleave = function() {
      if (holdTimer && holdTimer !== 'held') { clearTimeout(holdTimer); holdTimer = null; }
    };

    var btnInject = document.createElement('button');
    btnInject.id = 'ck-inject-btn';
    btnInject.innerText = 'INJ';
    btnInject.style.cssText = 'background:#93c5fd;color:#0f172a;border:1.5px solid #0f172a;box-shadow:2px 2px 0px #0f172a;border-radius:3px;padding:2px 10px;font-size:9px;font-weight:700;cursor:pointer;transition:all 0.15s ease;text-transform:uppercase;letter-spacing:0.5px;line-height:1.4;';

    // doInject removed — use fetchFromD1 directly

    function fetchFromD1(mode) {
      try { chrome.runtime.id; } catch(e) { badge.innerText = '확장 리로드됨. 페이지 새로고침(Cmd+R) 필요'; badge.style.display = 'block'; return; }
      badge.innerText = 'D1에서 불러오는 중...';
      badge.style.display = 'block';
      var currentUrl = window.location.href;
      chrome.runtime.sendMessage({type: 'getkey'}, function(kr) {
        var apiKey = (kr && kr.key) || '';
        if (!apiKey) {
          badge.innerText = 'API key not set.';
          setTimeout(function(){ badge.style.display = 'none'; }, 3000);
          return;
        }
        fetch(CONFIG.WORKER_URL + '/api/sessions/search?url=' + encodeURIComponent(currentUrl), {
          headers: {'Authorization': 'Bearer ' + apiKey}
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var sessions = data.sessions || [];
          if (sessions.length === 0) {
            badge.innerText = 'No context in D1. Run first.';
            setTimeout(function(){ badge.style.display = 'none'; }, 3000);
            return;
          }
          var s = sessions.sort(function(a,b){ return (b.total_chunks||0) - (a.total_chunks||0); })[0];
          return fetch(CONFIG.WORKER_URL + '/api/session/' + s.session_id, {
            headers: {'Authorization': 'Bearer ' + apiKey}
          }).then(function(r2) { return r2.json(); });
        })
        .then(function(s) {
          if (!s || !s.session_id) return;
          var ctx = {
            summary: s.summary || '',
            topics: tryParseJSON(s.topics) || [],
            key_decisions: tryParseJSON(s.key_decisions) || [],
            tools: tryParseJSON(s.tools) || [],
            project: s.project || '',
            status: s.status || '',
            checkpoint: s.checkpoint || '',
            chunks: (s.chunks || []).map(function(c) { return {chunk_index: c.chunk_index, chunk_summary: c.chunk_summary, chunk_checkpoint: c.chunk_checkpoint, turn_start: c.turn_start, turn_end: c.turn_end, project: c.project || ''}; }),
            _fromD1: true
          };
          applyInject(ctx, mode);
        })
        .catch(function(e) {
          badge.innerText = 'D1 error: ' + e.message;
          setTimeout(function(){ badge.style.display = 'none'; }, 3000);
        });
      });
    }


    function applyInject(ctx, mode) {
      var text = buildContext(ctx, mode);
      navigator.clipboard.writeText(text).then(function() {
        var label = mode === 'full' ? 'Full context' : 'Light context';
        var src = ctx._fromD1 ? ' (D1)' : '';
        badge.innerText = label + src + ' copied! Cmd+V to paste.';
        badge.style.display = 'block';
        setTimeout(function(){ badge.style.display = 'none'; }, 4000);
      });
    }

    var holdTimer = null;
    btnInject.onmousedown = function() {
      holdTimer = setTimeout(function() {
        holdTimer = null;
        fetchFromD1('full');
      }, 600);
    };
    btnInject.onmouseup = function() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        fetchFromD1('light');
      }
    };
    btnInject.onmouseleave = function() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };

    btnBox.appendChild(btnRun);
    btnBox.appendChild(btnInject);



    var btnBrowse = document.createElement('button');
    btnBrowse.id = 'ck-browse-btn';
    btnBrowse.innerText = 'BRW';
    btnBrowse.style.cssText = 'background:#c4a7e7;color:#0f172a;border:1.5px solid #0f172a;box-shadow:2px 2px 0px #0f172a;border-radius:3px;padding:2px 10px;font-size:9px;font-weight:700;cursor:pointer;transition:all 0.15s ease;text-transform:uppercase;letter-spacing:0.5px;line-height:1.4;';

    var browsePanel = document.createElement('div');
    browsePanel.id = 'ck-browse-panel';
    browsePanel.style.cssText = 'display:none;background:rgba(20,25,40,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px;max-height:350px;overflow-y:auto;min-width:280px;backdrop-filter:blur(8px);';

    btnBrowse.onclick = function() {
      if (browsePanel.style.display !== 'none') {
        browsePanel.style.display = 'none';
        return;
      }
      browsePanel.innerHTML = '<div style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;"><input id="ck-search-input" type="text" placeholder="벡터 검색..." style="width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#e4e4e7;font-size:11px;padding:5px 8px;outline:none;box-sizing:border-box;"/></div><div id="ck-brw-content" style="color:#888;font-size:11px;padding:4px 8px;">Loading...</div>';
      browsePanel.style.display = 'block';
      setTimeout(function() {
        var searchInput = document.getElementById('ck-search-input');
        if (searchInput) {
          searchInput.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter' && searchInput.value.trim().length > 0) {
              ev.preventDefault();
              var query = searchInput.value.trim();
              var contentDiv = document.getElementById('ck-brw-content');
              if (contentDiv) contentDiv.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Searching...</div>';
              chrome.runtime.sendMessage({type: 'getkey'}, function(kr2) {
                var ak = (kr2 && kr2.key) || '';
                fetch(CONFIG.WORKER_URL + '/api/vector-search?q=' + encodeURIComponent(query) + '&limit=8', {
                  headers: {'Authorization': 'Bearer ' + ak}
                }).then(function(r) { return r.json(); }).then(function(data) {
                  var res = data.results || [];
                  if (!contentDiv) return;
                  if (res.length === 0) { contentDiv.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">No results</div>'; return; }
                  var sh = '<div style="color:#ffd166;font-size:10px;font-weight:700;padding:2px 8px;">' + res.length + ' results</div>';
                  res.forEach(function(r, i) {
                    var score = Math.round((r.score||0)*100);
                    var tR = 'T' + (r.turn_start||0) + '-' + (r.turn_end||0);
                    var proj = r.project || '';
                    var sum = (r.chunk_summary || '').substring(0, 60);
                    sh += '<div style="padding:4px 8px;cursor:pointer;border-radius:4px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.4;" data-search-sid="' + r.session_id + '" data-search-cidx="' + r.chunk_index + '"><span style="color:#86efac;font-size:9px;">' + score + '%</span> <span style="color:#c4a7e7;">' + proj + '</span> <span style="color:#93c5fd;">' + tR + '</span><br/>' + sum + '</div>';
                  });
                  contentDiv.innerHTML = sh;
                  contentDiv.querySelectorAll('[data-search-sid]').forEach(function(el) {
                    el.onclick = function() {
                      var sid = el.getAttribute('data-search-sid');
                      var cidx = el.getAttribute('data-search-cidx');
                      chrome.runtime.sendMessage({type: 'getkey'}, function(kr3) {
                        var ak3 = (kr3 && kr3.key) || '';
                        fetch(CONFIG.WORKER_URL + '/api/session/' + sid, {
                          headers: {'Authorization': 'Bearer ' + ak3}
                        }).then(function(r) { return r.json(); }).then(function(sess) {
                          var chunks = sess.chunks || [];
                          var ch = chunks[parseInt(cidx)] || chunks.find(function(c){ return c.chunk_index == cidx; }) || {};
                          var txt = ch.raw_content || (ch.chunk_summary || '') + '\n\n' + (ch.chunk_checkpoint || '');
                          navigator.clipboard.writeText(txt).then(function() {
                            var badge = document.getElementById('ck-badge');
                            if (badge) { badge.innerText = ch.raw_content ? 'Raw (' + ch.raw_content.length + ' chars) copied' : 'Summary copied'; badge.style.display = 'block'; setTimeout(function(){ badge.style.display = 'none'; }, 3000); }
                          });
                        });
                      });
                    };
                  });
                }).catch(function(e) {
                  if (contentDiv) contentDiv.innerHTML = '<div style="color:#f87171;font-size:11px;padding:4px 8px;">Error: ' + e.message + '</div>';
                });
              });
            }
          });
        }
      }, 100);
      var cid = getChatId();
      var ctxKey = 'ck_context_' + cid;
      chrome.runtime.sendMessage({type: 'getkey'}, function(kr) {
        var apiKey = (kr && kr.key) || '';
        fetch(CONFIG.WORKER_URL + '/api/session/' + cid, {
          headers: {'Authorization': 'Bearer ' + (apiKey || '')}
        }).then(function(r){ return r.json(); }).then(function(sess) {
          var chunks = (sess.chunks || []).sort(function(a,b){ return (a.chunk_index||0)-(b.chunk_index||0); });
          var html = '';
          if (chunks.length > 0) {
            html += '<div style="color:#86efac;font-size:10px;font-weight:700;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:2px;">THIS CHAT (' + chunks.length + ' chunks)</div>';
            chunks.forEach(function(ch, i) {
              var tRange = 'T' + (ch.turn_start||0) + '-' + (ch.turn_end||0);
              var rawSum = ch.chunk_summary || ch.chunk_checkpoint || '(요약 없음)';
              var sum = tRange + ' ' + rawSum.substring(0, 45);
              var hasRaw = ch.raw_content && ch.raw_content.length > 0;
              html += '<div style="padding:3px 8px;cursor:pointer;border-radius:4px;font-size:10px;color:#d4d4d8;transition:background 0.15s;line-height:1.3;" data-chunk-idx="' + i + '" data-chunk-raw="' + (hasRaw ? '1' : '0') + '"><span style="color:#93c5fd;">[' + (i+1) + ']</span> ' + sum + '...' + (hasRaw ? ' <span style="color:#ffd166;font-size:8px;">[RAW]</span>' : '') + '</div>';
            });
            html += '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:2px 0;"></div>';
          } else {
            html += '<div style="color:#888;font-size:10px;padding:4px 8px;">No chunks yet. Run first.</div>';
            html += '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:2px 0;"></div>';
          }
          html += '<div style="color:#86efac;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.1);" id="ck-brw-all-sessions">ALL SESSIONS</div>';
          window._ckCurrentChunks = chunks;
          var contentDiv = document.getElementById('ck-brw-content');
          if (contentDiv) contentDiv.innerHTML = html; else browsePanel.innerHTML = html;
          var allSessionsBtn = document.getElementById('ck-brw-all-sessions');
          if (allSessionsBtn) {
            allSessionsBtn.onclick = function() {
              browsePanel.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Loading sessions...</div>';
              chrome.runtime.sendMessage({type: 'getkey'}, function(resp3) {
                var ak3 = resp3 && resp3.key;
                if (!ak3) { browsePanel.innerHTML = '<div style="color:#f87171;font-size:11px;">No API key</div>'; return; }
                fetch(CONFIG.WORKER_URL + '/api/sessions?limit=30', {
                  headers: {'Authorization': 'Bearer ' + ak3}
                }).then(function(r){ return r.json(); }).then(function(j){
                  var sessions = j.results || [];
                  if (!sessions.length) { browsePanel.innerHTML = '<div style="color:#888;font-size:11px;">No sessions</div>'; return; }
                  var sh = '<div style="color:#86efac;font-size:10px;padding:2px 8px;font-weight:700;">ALL SESSIONS (' + sessions.length + ')</div>';
                  sessions.forEach(function(s){
                    var label = (s.project || s.title || s.session_id.substring(0,8));
                    sh += '<div style="padding:3px 8px;cursor:pointer;border-radius:6px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);" data-sid="' + s.session_id + '">' + label + ' <span style="color:#666;">(' + (s.total_turns||0) + 't)</span></div>';
                  });
                  browsePanel.innerHTML = sh;
                  browsePanel.querySelectorAll('[data-sid]').forEach(function(sel){
                    sel.onclick = function(){
                      var sid = sel.getAttribute('data-sid');
                      browsePanel.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Loading chunks...</div>';
                      fetch(CONFIG.WORKER_URL + '/api/session/' + sid, {
                        headers: {'Authorization': 'Bearer ' + ak3}
                      }).then(function(r){ return r.json(); }).then(function(sess){
                        var cks = sess.chunks || [];
                        if (!cks.length) { browsePanel.innerHTML = '<div style="color:#888;font-size:11px;">No chunks</div>'; return; }
                        var ch = '<div style="color:#86efac;font-size:10px;padding:2px 8px;font-weight:700;">' + (sess.project||sess.title||sid.substring(0,8)) + ' (' + cks.length + ' chunks)</div>';
                        cks.forEach(function(ck, idx){
                          var tR = 'T' + (ck.turn_start||0) + '-' + (ck.turn_end||0);
                          var rawSm = ck.chunk_summary || ck.chunk_checkpoint || '(요약 없음)';
                          var sm = tR + ' ' + rawSm.substring(0, 50);
                          var hasR = ck.raw_content && ck.raw_content.length > 0;
                          ch += '<div style="padding:3px 8px;cursor:pointer;border-radius:6px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);" data-cidx="' + idx + '">[' + (idx+1) + '] ' + sm + (hasR ? ' <span style=color:#86efac>[RAW]</span>' : '') + '</div>';
                        });
                        browsePanel.innerHTML = ch;
                        browsePanel.querySelectorAll('[data-cidx]').forEach(function(cel){
                          cel.onclick = function(){
                            var ci = parseInt(cel.getAttribute('data-cidx'));
                            var chk = cks[ci];
                            var txt = (chk.raw_content && chk.raw_content.length > 0) ? chk.raw_content : (chk.chunk_summary||'') + '\n\n' + (chk.chunk_checkpoint||'');
                            navigator.clipboard.writeText(txt).then(function(){
                              badge.innerText = (chk.raw_content && chk.raw_content.length > 0) ? 'Raw (' + chk.raw_content.length + ' chars) copied' : 'Summary copied';
                            });
                          };
                        });
                      });
                    };
                  });
                });
              });
            };
          }
          browsePanel.querySelectorAll('[data-chunk-idx]').forEach(function(el) {
            el.onclick = function() {
              var idx = parseInt(el.getAttribute('data-chunk-idx'));
              badge.innerText = 'Loading raw chunk ' + (idx+1) + '...';
              badge.style.display = 'block';
              var sid = getChatId();
              fetch(CONFIG.WORKER_URL + '/api/session/' + encodeURIComponent(sid), {
                headers: {'Authorization': 'Bearer ' + apiKey}
              })
              .then(function(r) { return r.json(); })
              .then(function(s) {
                var chunks = s.chunks || [];
                var raw = chunks[idx] ? (chunks[idx].raw_content || '') : '';
                if (raw) {
                  navigator.clipboard.writeText(raw);
                  badge.innerText = 'Chunk ' + (idx+1) + ' raw (' + raw.length + ' chars) copied!';
                } else {
                  var ch = ctx.chunks[idx] || {};
                  var fallback = '[CHUNK ' + (idx+1) + ']\nSummary: ' + (ch.summary || '') + '\nCheckpoint: ' + (ch.checkpoint || '');
                  navigator.clipboard.writeText(fallback);
                  badge.innerText = 'Chunk ' + (idx+1) + ' (summary only, no raw in D1)';
                }
                setTimeout(function() { badge.style.display = 'none'; }, 4000);
                browsePanel.style.display = 'none';
              })
              .catch(function(e) {
                badge.innerText = 'Error: ' + e.message;
                setTimeout(function() { badge.style.display = 'none'; }, 3000);
              });
            };
          });
          var projBtn = document.getElementById('ck-brw-projects');
          if (projBtn) {
            projBtn.onclick = function() {
              if (!apiKey) { browsePanel.innerHTML = '<div style="color:#f87171;font-size:11px;padding:4px 8px;">API key not set</div>'; return; }
              browsePanel.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Loading...</div>';
              fetch(CONFIG.WORKER_URL + '/api/sessions/projects', { headers: {'Authorization': 'Bearer ' + apiKey} })
              .then(function(r) { return r.json(); })
              .then(function(j) {
                var projects = (j.results || []).filter(function(p) { return p.project && p.project !== ''; }).slice(0, 5);
                browsePanel.innerHTML = '<div style="color:#c4a7e7;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;" id="ck-brw-back">◂ BACK</div>' + projects.map(function(p) {
                  return '<div style="padding:3px 8px;cursor:pointer;border-radius:4px;font-size:10px;color:#d4d4d8;" onmouseover="this.style.background=\'rgba(255,255,255,0.06)\'" onmouseout="this.style.background=\'transparent\'" data-project="' + p.project + '">' + p.project + ' (' + (p.cnt || 0) + ')</div>';
                }).join('');
                document.getElementById('ck-brw-back').onclick = function() { btnBrowse.click(); };
                browsePanel.querySelectorAll('[data-project]').forEach(function(el) {
                  el.onclick = function() { browsePanel.style.display = 'none'; loadProjectContext(el.getAttribute('data-project'), apiKey); };
                });
              });
            };
          }
        });
      });
    };

    btnBox.appendChild(btnBrowse);

    panel.appendChild(btnBox);
    panel.appendChild(browsePanel);
    panel.appendChild(badge);
    document.body.appendChild(panel);
  }

  var lastNewTurnTime = 0;
  var autoSaveTimer = null;
  var autoSaveTriggered = false;

  function checkForNewTurns() {
    var current = extractTurns();
    if (current.length > lastTurnCount) {
      var diff = current.length - lastTurnCount;
      console.log('[CK] +' + diff
        + ' new turns, total: ' + current.length);
      lastTurnCount = current.length;
      if (diff <= 50) {
        lastNewTurnTime = Date.now();
        autoSaveTriggered = false;
        var chatId = getChatId();
        var skKey = 'ck_last_turn_' + chatId;
        chrome.storage.local.get([skKey], function(st) {
          var lastSaved = (st && st[skKey]) || 0;
          var unsaved = current.length - lastSaved;
          if (unsaved >= 50 && !isRunning) {
            console.log('[CK] 50-turn auto-trigger: unsaved=' + unsaved);
            triggerAutoSave('50turns');
          } else {
            scheduleAutoSave();
          }
        });
      } else {
        console.log('[CK] Burst detected (+' + diff + '), auto-save skipped. Use Run button.');
        autoSaveTriggered = true;
      }
    }
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(function() {
      if (!autoSaveTriggered && !isRunning && lastTurnCount >= 2) {
        triggerAutoSave('idle');
      }
    }, 120000);
  }

  function triggerAutoSave(reason) {
    var chatId = getChatId();
    var storageKey = 'ck_last_turn_' + chatId;
    chrome.storage.local.get([storageKey], function(stored) {
      var lastSaved = (stored && stored[storageKey]) || 0;
      if (lastTurnCount > lastSaved) {
        autoSaveTriggered = true;
        console.log('[CK] Auto-save triggered (' + reason + '), turns:', lastTurnCount, 'lastSaved:', lastSaved);
        var badge = document.getElementById('ck-badge');
        if (badge) { badge.style.display = 'block'; badge.innerText = 'Auto-saving... (' + reason + ')'; }
        summarizeAll();
      }
    });
  }

  var observer = new MutationObserver(function() {
    clearTimeout(window._ckDebounce);
    window._ckDebounce = setTimeout(checkForNewTurns, 1000);
  });

  function checkPreviousContext() {
    var cid = getChatId();
      chrome.runtime.sendMessage({type: 'getkey'}, function(kr) {
        var apiKey = (kr && kr.key) || '';
        if (!apiKey) return;
        fetch(CONFIG.WORKER_URL + '/api/sessions/search?url=' + encodeURIComponent(window.location.href), {
          headers: {'Authorization': 'Bearer ' + apiKey}
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.sessions && data.sessions.length > 0) return;
          return fetch(CONFIG.WORKER_URL + '/api/sessions/projects', {
            headers: {'Authorization': 'Bearer ' + apiKey}
          }).then(function(r) { return r.json(); });
        })
        .then(function(pData) {
          if (!pData || !pData.results || pData.results.length === 0) return;
          var badge = document.getElementById('ck-badge');
          if (!badge) return;
          badge.innerHTML = '<span style="color:#7c83ff;font-size:11px">이전 프로젝트 맥락 사용: </span>';
          var projects = pData.results.slice(0, 5);
          projects.forEach(function(p) {
            var btn = document.createElement('span');
            btn.textContent = p.project + '(' + p.cnt + ')';
            btn.style.cssText = 'background:#1a1a2e;color:#ffd166;padding:2px 6px;border-radius:4px;margin:0 2px;cursor:pointer;font-size:11px';
            btn.onclick = function() { loadProjectContext(p.project, apiKey); };
            badge.appendChild(btn);
          });
          badge.style.display = 'block';
        })
        .catch(function() {});
      });
    }

  function loadProjectContext(project, apiKey) {
    var badge = document.getElementById('ck-badge');
    if (badge) {
      badge.innerText = project + ' 맥락 로딩...';
    }
    fetch(CONFIG.WORKER_URL + '/api/sessions/latest?project=' + encodeURIComponent(project), {
      headers: {'Authorization': 'Bearer ' + apiKey}
    })
    .then(function(r) { return r.json(); })
    .then(function(s) {
      if (!s || !s.session_id) {
        if (badge) badge.innerText = '맥락 없음';
        return;
      }
      var ctx = {
        summary: s.summary || '',
        topics: tryParseJSON(s.topics) || [],
        key_decisions: tryParseJSON(s.key_decisions) || [],
        tech_stack: tryParseJSON(s.tech_stack) || [],
        project: s.project || '',
        status: s.status || '',
        checkpoint: s.checkpoint || '',
        chunks: (s.chunks || []).map(function(c) { return {chunk_index: c.chunk_index, chunk_summary: c.chunk_summary, chunk_checkpoint: c.chunk_checkpoint, turn_start: c.turn_start, turn_end: c.turn_end, project: c.project || ''}; }),
        _fromD1: true
      };
      var text = buildContext(ctx, 'full');
      navigator.clipboard.writeText(text).then(function() {
        if (badge) {
          badge.innerText = project + ' 맥락 복사됨! Cmd+V로 붙여넣기';
          badge.style.display = 'block';
          setTimeout(function() { badge.style.display = 'none'; }, 5000);
        }
      });
    })
    .catch(function(e) {
      if (badge) badge.innerText = '로딩 실패: ' + e.message;
    });
    }


  function tryParseJSON(str) {
    try { return JSON.parse(str); } catch(e) { return []; }
  }


  function buildContext(ctx, mode) {
    var text = '[CONTEXT INJECTION]\n';
    text += 'Project: ' + (ctx.project || 'unknown') + ' | Status: ' + (ctx.status || '진행중') + '\n\n';
    var chunks = ctx.chunks || [];
    var recent = mode === 'full' ? chunks.slice(-5) : chunks.slice(-3);
    if (recent.length > 0) {
      text += '[RECENT PROGRESS]\n';
      recent.forEach(function(c) {
        var sum = c.chunk_summary || c.summary || '';
        if (sum) text += '- ' + sum + '\n';
      });
      text += '\n';
    }
    if (ctx.key_decisions && ctx.key_decisions.length > 0) {
      text += '[KEY DECISIONS] ' + ctx.key_decisions.join(', ') + '\n\n';
    }
    if (mode === 'full' && ctx.tools && ctx.tools.length > 0) {
      text += '[TOOLS] ' + ctx.tools.join(', ') + '\n\n';
    }
    text += '위 맥락을 참고하여 이어서 작업해주세요.';
    return text;
    }

  function ensureUI() {
    if (!document.getElementById('ck-panel') && document.body) {
      console.log('[CK] Inserting ck-panel');
      createUI();
    }
  }

  function init() {
    var target = document.querySelector(
      '.conversation-content')
      || document.querySelector('.chat-wrapper')
      || document.body;

    observer.observe(target, {
      childList: true,
      subtree: true
    });

    // body 자체의 직접 자식 변경도 감시 (Genspark DOM 교체 대응)
    var bodyObserver = new MutationObserver(function() {
      ensureUI();
    });
    bodyObserver.observe(document.body, {
      childList: true
    });

    ensureUI();

    document.addEventListener('visibilitychange', function() {
      // tab-switch auto-save disabled
    });

    setInterval(function() {
      try {
        chrome.runtime.sendMessage({type: 'ping'}, function() {
          if (chrome.runtime.lastError) {}
        });
      } catch(e) {}
    }, 20000);

    console.log('[CK] Context Keeper v0.8 active (auto-trigger + keepalive + chaining)');
    checkForNewTurns();
    var lastCheckedUrl = '';
    setInterval(function() {
      var currentUrl = window.location.href;
      if (currentUrl !== lastCheckedUrl && currentUrl.indexOf('id=') > -1) {
        lastCheckedUrl = currentUrl;
        setTimeout(checkPreviousContext, 2000);
      }
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
