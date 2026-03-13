(function() {
  var CONFIG = {
    TURNS_PER_CHUNK: 20,
    OLLAMA_URL: 'http://localhost:11434/api/generate',
    MODEL: 'exaone3.5:7.8b',
    WORKER_URL: 'https://ods-mobile.hugh79757.workers.dev',
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

  function callOllama(prompt) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'ollama',
        payload: {
          model: CONFIG.MODEL,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 1024,
            num_ctx: 16384
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
    if (el) el.innerText = msg;
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
      if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#0f0'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'Run'; }
      return;
    }

    var chatId = getChatId();
    var storageKey = 'ck_last_turn_' + chatId;

    chrome.storage.local.get([storageKey], function(stored) {
      var lastTurn = (stored && stored[storageKey]) || 0;
      var newTurns = allTurns.slice(lastTurn);
      console.log('[CK] Total turns:', allTurns.length, 'Last summarized:', lastTurn, 'New turns:', newTurns.length);

      if (newTurns.length < 2) {
        updateBadge('CK: No new turns');
        isRunning = false;
        if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#0f0'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'Run'; }
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
        if (text.length > 30000) {
          text = text.substring(0, 30000);
        }
        var p = '[SYSTEM] 반드시 아래 형식만 출력하세요. 설명이나 인사말 없이 바로 시작하세요.\n\n'
          + '[FORMAT]\n'
          + '```json\n'
          + '{"summary":"2~3문장 요약","topics":["주제1"],"key_decisions":["결정1"],"project":"프로젝트명"}\n'
          + '```\n\n'
          + '```checkpoint\n'
          + '현재 진행 상황 3~5문장\n'
          + '```\n'
          + '[/FORMAT]\n\n'
          + '전체 ' + chunks.length + '개 구간 중 ' + (ci+1) + '번째 대화를 분석하세요:\n\n' + text;
        return callOllama(p);
      }).then(function(resp) {
        var fm = parseJson(resp);
        var cp = parseCheckpoint(resp);
        console.log('[CK] Chunk ' + (ci+1) + ':',
          fm ? (fm.summary || '').substring(0, 80) : 'fail');
        results.push({frontmatter: fm, checkpoint: cp});
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

      updateBadge('CK: Final...');
      var combined = valid.map(function(r, i) {
        return '[구간' + (i+1) + '] '
          + JSON.stringify(r.frontmatter);
      }).join('\n');

      var fp = '[SYSTEM] 반드시 아래 형식만 출력하세요. 설명이나 인사말 없이 ```json 블록 하나만 출력.\n\n'
        + '```json\n'
        + '{"summary":"3~5문장 통합요약","topics":[],"key_decisions":[],"project":"","status":"진행중"}\n'
        + '```\n\n'
        + '아래 구간별 요약을 통합하세요:\n\n' + combined;

      return callOllama(fp).then(function(resp) {
        console.log('[CK] Final Ollama response received, length:', resp ? resp.length : 0);
        var fm = parseJson(resp);
        console.log('[CK] Summary:', JSON.stringify(fm));

        // 2차 호출: checkpoint 생성
        var cpPrompt = '[SYSTEM] 아래 요약을 바탕으로 "다음 대화에서 사용할 맥락 요약"을 작성하세요.\n'
          + '반드시 ```checkpoint 블록 하나만 출력하세요. 다른 텍스트 금지.\n\n'
          + '```checkpoint\n'
          + '현재 프로젝트 상태, 완료된 작업, 진행중인 작업, 다음 단계를 500자 이내로 요약\n'
          + '```\n\n'
          + '요약 데이터:\n' + JSON.stringify(fm);
        updateBadge('CK: Checkpoint...');
        return callOllama(cpPrompt).then(function(cpResp) {
          console.log('[CK] Checkpoint Ollama response, length:', cpResp ? cpResp.length : 0);
          var cp = parseCheckpoint(cpResp);
          if (!cp && cpResp) {
            cp = cpResp.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
            if (cp) console.log('[CK] checkpoint extracted as raw text, len:', cp.length);
          }
          console.log('[CK] === RESULT ===');
          console.log('[CK] Checkpoint:', cp ? cp.substring(0, 100) + '...' : '(empty)');
          return { fm: fm, cp: cp };
        }).catch(function(cpErr) {
          console.error('[CK] Checkpoint call failed:', cpErr);
          return { fm: fm, cp: '' };
        });
      }).then(function(result) {
        var fm = result.fm;
        var cp = result.cp;
        var msg = 'CK Done!\n';
        if (fm) msg += (fm.summary || '').substring(0, 150);
        updateBadge(msg);

        // D1에 저장
        console.log('[CK] Preparing save. results count:', results.length, 'valid count:', valid.length);
        var chunkData = results.map(function(r, i) {
          return {
            turn_start: i * CONFIG.TURNS_PER_CHUNK + 1,
            turn_end: Math.min((i + 1) * CONFIG.TURNS_PER_CHUNK, allTurns.length),
            summary: r.frontmatter ? (r.frontmatter.summary || '') : '',
            checkpoint: r.checkpoint || '',
            topics: r.frontmatter ? (r.frontmatter.topics || []) : [],
            key_decisions: r.frontmatter ? (r.frontmatter.key_decisions || []) : []
          };
        });

        console.log('[CK] Calling saveToWorker now...');
        return saveToWorker({
          source: 'genspark',
          url: window.location.href,
          title: document.title || 'Genspark Chat',
          summary: fm ? (fm.summary || '') : '',
          topics: fm ? (fm.topics || []) : [],
          key_decisions: fm ? (fm.key_decisions || []) : [],
          tech_stack: fm ? (fm.tech_stack || []) : [],
          project: fm ? (fm.project || '') : '',
          status: fm ? (fm.status || '진행중') : '진행중',
          checkpoint: cp || '',
          total_turns: allTurns.length,
          chunks: chunkData
        }).then(function() {
          var saveObj = {};
          saveObj[storageKey] = allTurns.length;
          chrome.storage.local.set(saveObj, function() {
            console.log('[CK] Saved last turn:', allTurns.length, 'for chat:', chatId);
          });
        });
      }).catch(function(finalErr) {
        console.error('[CK] Final stage error:', finalErr);
      });
    }).catch(function(chainErr) {
      console.error('[CK] Chain error:', chainErr);
    }).finally(function() {
      console.log('[CK] .finally() reached, resetting state');
      isRunning = false;
      var runBtn = document.getElementById('ck-run-btn');
      if (runBtn) { runBtn.disabled = false; runBtn.style.background = '#0f0'; runBtn.style.cursor = 'pointer'; runBtn.innerText = 'Run'; }
    });
    }); // chrome.storage.local.get callback
  }

  function createUI() {
    var panel = document.createElement('div');
    panel.id = 'ck-panel';
    panel.style.cssText = 'position:fixed;bottom:80px;'
      + 'right:16px;z-index:99999;display:flex;'
      + 'flex-direction:column;gap:6px;align-items:flex-end;';

    var badge = document.createElement('div');
    badge.id = 'ck-badge';
    badge.style.cssText = 'background:#1a1a2e;color:#0f0;'
      + 'padding:8px 12px;border-radius:6px;font-size:12px;'
      + 'font-family:monospace;max-width:350px;'
      + 'white-space:pre-wrap;display:none;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,0.5);';

    var btnBox = document.createElement('div');
    btnBox.style.cssText = 'display:flex;gap:6px;';

    var btnStatus = document.createElement('button');
    btnStatus.innerText = 'CK';
    btnStatus.style.cssText = 'background:#1a1a2e;color:#0f0;'
      + 'border:1px solid #0f0;border-radius:50%;'
      + 'width:40px;height:40px;cursor:pointer;'
      + 'font-family:monospace;font-size:11px;'
      + 'font-weight:bold;';
    btnStatus.onclick = function() {
      var t = extractTurns();
      var c = Math.ceil(t.length / CONFIG.TURNS_PER_CHUNK);
      badge.innerText = 'Turns: ' + t.length
        + '\nChunks: ' + c;
      badge.style.display = 'block';
      setTimeout(function() {
        badge.style.display = 'none';
      }, 5000);
    };

    var btnRun = document.createElement('button');
    btnRun.id = 'ck-run-btn';
    btnRun.innerText = 'Run';
    btnRun.style.cssText = 'background:#0f0;color:#1a1a2e;'
      + 'border:none;border-radius:20px;'
      + 'padding:8px 16px;cursor:pointer;'
      + 'font-family:monospace;font-size:12px;'
      + 'font-weight:bold;';
    btnRun.onclick = function() {
      badge.style.display = 'block';
      summarizeAll();
    };

    btnBox.appendChild(btnStatus);
    btnBox.appendChild(btnRun);
    panel.appendChild(badge);
    panel.appendChild(btnBox);
    document.body.appendChild(panel);
  }

  function checkForNewTurns() {
    var current = extractTurns();
    if (current.length > lastTurnCount) {
      var diff = current.length - lastTurnCount;
      console.log('[CK] +' + diff
        + ' new turns, total: ' + current.length);
      lastTurnCount = current.length;
    }
  }

  var observer = new MutationObserver(function() {
    clearTimeout(window._ckDebounce);
    window._ckDebounce = setTimeout(checkForNewTurns, 1000);
  });

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
    console.log('[CK] Context Keeper v0.5 active');
    checkForNewTurns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
