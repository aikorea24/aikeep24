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
            + '{"summary":"2~3문장 요약","topics":["주제1","주제2"],"key_decisions":["결정1"],"tech_stack":["기술1","기술2"],"project":"프로젝트명"}\n'
            + '```\n\n'
            + '```checkpoint\n'
            + '현재 진행 상황 3~5문장\n'
            + '```\n'
            + '[/FORMAT]\n\n'
            + '[RULES]\n'
            + '- tech_stack: 대화에서 언급된 기술/도구/프레임워크/언어를 모두 추출. 예: ["Python","Cloudflare D1","Chrome Extension","Ollama","EXAONE"]. 빈 배열 []은 기술 언급이 전혀 없을 때만 허용.\n'
            + '- project: 기존 프로젝트=[AIKeep24, TV-show, TAP, aikorea24, news-keyword-pro, KDE-keepalive]. 해당 시 정확히 같은 이름 사용. 해당 없으면 간결한 새 이름 생성.\n'
            + '[/RULES]\n\n'
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
          + '{"summary":"3~5문장 통합요약","topics":[],"key_decisions":[],"tech_stack":[],"project":"","status":"진행중"}\n'
          + '```\n\n'
          + '[RULES]\n'
          + '- tech_stack: 각 구간의 tech_stack을 병합하여 중복 제거한 최종 목록. 빈 배열 금지(기술 언급이 있었다면).\n'
          + '- project: 기존 프로젝트=[AIKeep24, TV-show, TAP, aikorea24, news-keyword-pro, KDE-keepalive]. 해당 시 정확히 같은 이름 사용.\n'
          + '- status: 반드시 다음 중 하나만 선택 -> 진행중 | 완료 | 보류 | 검토중. 판단기준: 완료=작업 끝남 명시, 보류=블로커/대기, 검토중=리뷰/테스트 단계, 진행중=기본값.\n'
          + '[/RULES]\n\n'
          + '아래 구간별 요약을 통합하세요:\n\n' + combined;

      return callOllama(fp).then(function(resp) {
        console.log('[CK] Final Ollama response received, length:', resp ? resp.length : 0);
        var fm = parseJson(resp);
        console.log('[CK] Summary:', JSON.stringify(fm));

        // 2차 호출: checkpoint 생성
        var cpPrompt = '[SYSTEM] 아래 요약을 바탕으로 "다음 대화를 시작할 때 AI에게 제공할 맥락 브리핑"을 작성하세요.\n'
          + 'summary와 중복되지 않게 작성하세요. summary는 "무엇을 했는지"이고, checkpoint는 "다음에 무엇을 해야 하는지"입니다.\n'
          + '반드시 ```checkpoint 블록 하나만 출력하세요. 다른 텍스트 금지.\n\n'
          + '```checkpoint\n'
          + '1) 미해결 이슈/블로커 2) 다음 작업 단계 3) 주의사항/의존성. 300자 이내.\n'
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


          var contextData = {
            summary: fm ? (fm.summary || '') : '',
            topics: fm ? (fm.topics || []) : [],
            tech_stack: fm ? (fm.tech_stack || []) : [],
            key_decisions: fm ? (fm.key_decisions || []) : [],
            project: fm ? (fm.project || '') : '',
            status: fm ? (fm.status || '진행중') : '진행중',
            checkpoint: cp || '',
            chunks: results.filter(function(r){ return r.frontmatter; }).map(function(r, i){
              return { index: i+1, summary: r.frontmatter.summary || '', checkpoint: r.checkpoint || '' };
            }),
            updated: new Date().toISOString()
          };
          var ctxKey = 'ck_context_' + chatId;
          var ctxObj = {};
          ctxObj[ctxKey] = JSON.stringify(contextData);
          chrome.storage.local.set(ctxObj);
          console.log('[CK] Context saved for inject, key:', ctxKey);

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

    var btnInject = document.createElement('button');
    btnInject.id = 'ck-inject-btn';
    btnInject.innerText = 'Inject';
    btnInject.style.cssText = 'background:#1a1a2e;color:#ff0;'
      + 'border:1px solid #ff0;border-radius:20px;'
      + 'padding:8px 12px;cursor:pointer;'
      + 'font-family:monospace;font-size:12px;'
      + 'font-weight:bold;';
    function buildContext(ctx, mode) {
      var text = '[CONTEXT INJECTION]\n';
      text += 'Project: ' + (ctx.project || 'unknown') + ' | Status: ' + (ctx.status || '진행중') + '\n\n';
      if (ctx.checkpoint) {
        text += '[NEXT STEPS]\n' + ctx.checkpoint + '\n\n';
      }
      if (ctx.key_decisions && ctx.key_decisions.length > 0) {
        text += '[KEY DECISIONS] ' + ctx.key_decisions.join(', ') + '\n\n';
      }
      if (mode === 'full') {
        text += '[SUMMARY] ' + (ctx.summary || '') + '\n\n';
        if (ctx.tech_stack && ctx.tech_stack.length > 0) {
          text += '[TECH STACK] ' + ctx.tech_stack.join(', ') + '\n\n';
        }
        if (ctx.chunks && ctx.chunks.length > 0) {
          var recent = ctx.chunks.slice(-3);
          text += '[RECENT PROGRESS]\n';
          recent.forEach(function(c) {
            text += '- Part ' + c.index + ': ' + c.summary + '\n';
          });
          text += '\n';
        }
      }
      text += '위 맥락을 참고하여 이어서 작업해주세요.';
      return text;
    }

    function doInject(mode) {
      var cid = getChatId();
      var ctxKey = 'ck_context_' + cid;
      chrome.storage.local.get([ctxKey], function(stored) {
        var raw = stored[ctxKey];
        if (!raw) {
          badge.innerText = 'No context yet. Run first.';
          badge.style.display = 'block';
          setTimeout(function(){ badge.style.display = 'none'; }, 3000);
          return;
        }
        var ctx = JSON.parse(raw);
        var text = buildContext(ctx, mode);
        navigator.clipboard.writeText(text).then(function() {
          var label = mode === 'full' ? 'Full context' : 'Light context';
          badge.innerText = label + ' copied! Cmd+V to paste.';
          badge.style.display = 'block';
          setTimeout(function(){ badge.style.display = 'none'; }, 4000);
        });
      });
    }

    var holdTimer = null;
    btnInject.onmousedown = function() {
      holdTimer = setTimeout(function() {
        holdTimer = null;
        doInject('full');
      }, 600);
    };
    btnInject.onmouseup = function() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        doInject('light');
      }
    };
    btnInject.onmouseleave = function() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };

    btnBox.appendChild(btnRun);
    btnBox.appendChild(btnInject);
    panel.appendChild(badge);
    panel.appendChild(btnBox);
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
        scheduleAutoSave();
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
      if (document.hidden && !autoSaveTriggered && !isRunning && lastNewTurnTime > 0) {
        var elapsed = Date.now() - lastNewTurnTime;
        if (elapsed > 5000) {
          triggerAutoSave('tab-switch');
        }
      }
    });

    setInterval(function() {
      try {
        chrome.runtime.sendMessage({type: 'ping'}, function() {
          if (chrome.runtime.lastError) {}
        });
      } catch(e) {}
    }, 20000);

    console.log('[CK] Context Keeper v0.7 active (auto-trigger + keepalive)');
    checkForNewTurns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
