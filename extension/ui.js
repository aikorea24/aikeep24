/**
 * AIKeep24 - UI (버튼, 배지, BRW 패널, 탭 토글)
 */
(function() {
  var CK = window.CK;

  CK.updateBadge = function(msg) {
    var el = document.getElementById('ck-badge');
    if (el) { el.innerText = msg; el.style.display = 'block'; }
  };

  CK.setRunBtnState = function(running) {
    var btn = document.getElementById('ck-run-btn');
    if (!btn) return;
    if (running) {
      btn.disabled = true;
      btn.style.background = '#666';
      btn.style.cursor = 'not-allowed';
      btn.innerText = 'Running...';
    } else {
      btn.disabled = false;
      btn.style.background = '#86efac';
      btn.style.cursor = 'pointer';
      btn.innerText = 'RUN';
    }
  };

  CK.createUI = function() {
    var panel = document.createElement('div');
    panel.id = 'ck-panel';
    panel.style.cssText = 'position:fixed;bottom:120px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:6px;align-items:flex-end;padding:2px 0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    var badge = document.createElement('div');
    badge.id = 'ck-badge';
    badge.style.cssText = 'display:none;background:rgba(20,25,40,0.92);color:#b0b8c8;font-size:11px;padding:8px 12px;border-radius:6px;max-width:350px;line-height:1.4;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.08);font-family:monospace;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);';

    var btnBox = document.createElement('div');
    btnBox.style.cssText = 'display:flex;gap:4px;align-items:center;';

    var btnStyle = 'border:1.5px solid #0f172a;box-shadow:2px 2px 0px #0f172a;border-radius:3px;padding:2px 10px;font-size:9px;font-weight:700;cursor:pointer;transition:all 0.15s ease;text-transform:uppercase;letter-spacing:0.5px;line-height:1.4;';

    // === ON/OFF 토글 ===
    var btnToggle = document.createElement('button');
    btnToggle.id = 'ck-toggle-btn';
    btnToggle.innerText = 'ON';
    btnToggle.style.cssText = 'background:#86efac;color:#0f172a;' + btnStyle;
    btnToggle.onclick = function() {
      CK.enabled = !CK.enabled;
      btnToggle.innerText = CK.enabled ? 'ON' : 'OFF';
      btnToggle.style.background = CK.enabled ? '#86efac' : '#f87171';
      CK.updateBadge(CK.enabled ? 'CK: Enabled' : 'CK: Disabled (RUN/AutoRun blocked)');
      if (!CK.enabled && CK.autoRunTimer) {
        clearTimeout(CK.autoRunTimer);
        CK.autoRunTimer = null;
      }
    };
    btnBox.appendChild(btnToggle);

    // === RUN 버튼 ===
    var btnRun = document.createElement('button');
    btnRun.id = 'ck-run-btn';
    btnRun.innerText = 'RUN';
    btnRun.style.cssText = 'background:#86efac;color:#0f172a;' + btnStyle;
    var holdTimer = null;
    btnRun.onmousedown = function() {
      holdTimer = setTimeout(function() {
        holdTimer = 'held';
        CK.updateBadge('CK: Reloading...');
        chrome.runtime.sendMessage({type: 'reload_extension'}, function() {
          CK.updateBadge('CK: Reloaded! Refreshing...');
          setTimeout(function() { location.reload(); }, 1000);
        });
      }, 2000);
    };
    btnRun.onmouseup = function() {
      if (holdTimer === 'held') { holdTimer = null; return; }
      clearTimeout(holdTimer);
      holdTimer = null;
      badge.style.display = 'block';
      CK.summarizeAll();
    };
    btnRun.onmouseleave = function() {
      if (holdTimer && holdTimer !== 'held') { clearTimeout(holdTimer); holdTimer = null; }
    };
    btnBox.appendChild(btnRun);

    // === INJ 버튼 ===
    var btnInject = document.createElement('button');
    btnInject.id = 'ck-inject-btn';
    btnInject.innerText = 'INJ';
    btnInject.style.cssText = 'background:#93c5fd;color:#0f172a;' + btnStyle;

    var injHoldTimer = null;
    btnInject.onmousedown = function() {
      injHoldTimer = setTimeout(function() {
        injHoldTimer = null;
        doInject('full');
      }, 600);
    };
    btnInject.onmouseup = function() {
      if (injHoldTimer) {
        clearTimeout(injHoldTimer);
        injHoldTimer = null;
        doInject('light');
      }
    };
    btnInject.onmouseleave = function() {
      if (injHoldTimer) { clearTimeout(injHoldTimer); injHoldTimer = null; }
    };
    btnBox.appendChild(btnInject);

    // === SNAP 버튼 ===
    var btnSnap = document.createElement('button');
    btnSnap.id = 'ck-snap-btn';
    btnSnap.innerText = 'SNAP';
    btnSnap.style.cssText = 'background:#fbbf24;color:#0f172a;' + btnStyle;
    btnSnap.onclick = function() {
      var allTurns = CK.extractTurns();
      if (allTurns.length < 2) {
        CK.updateBadge('SNAP: Not enough turns');
        setTimeout(function() { badge.style.display = 'none'; }, 3000);
        return;
      }
      var recentTurns = allTurns.slice(-10);
      var rawText = recentTurns.map(function(t) {
        return '[' + t.role.toUpperCase() + ']\n' + t.text;
      }).join('\n\n');
      var snapText = '[SNAP CONTEXT - Recent ' + recentTurns.length + ' turns]\n' + rawText + '\n\n위 맥락을 참고하여 이어서 작업해주세요.';
      navigator.clipboard.writeText(snapText).then(function() {
        CK.updateBadge('SNAP copied! (' + recentTurns.length + ' turns, ' + snapText.length + ' chars) Cmd+V');
        setTimeout(function() { badge.style.display = 'none'; }, 5000);
      });
    };
    btnBox.appendChild(btnSnap);

    // === BRW 버튼 ===
    var btnBrowse = document.createElement('button');
    btnBrowse.id = 'ck-browse-btn';
    btnBrowse.innerText = 'BRW';
    btnBrowse.style.cssText = 'background:#c4a7e7;color:#0f172a;' + btnStyle;

    var browsePanel = document.createElement('div');
    browsePanel.id = 'ck-browse-panel';
    browsePanel.style.cssText = 'display:none;background:rgba(20,25,40,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px;max-height:350px;overflow-y:auto;min-width:280px;backdrop-filter:blur(8px);';

    btnBrowse.onclick = function() {
      if (browsePanel.style.display !== 'none') {
        browsePanel.style.display = 'none';
        return;
      }
      browsePanel.style.display = 'block';
      loadBrowsePanel(browsePanel, badge);
    };
    btnBox.appendChild(btnBrowse);

    panel.appendChild(btnBox);
    panel.appendChild(browsePanel);
    panel.appendChild(badge);
    document.body.appendChild(panel);
  };

  // === INJ 실행 ===
  function doInject(mode) {
    var badge = document.getElementById('ck-badge');
    try { chrome.runtime.id; } catch(e) {
      if (badge) { badge.innerText = '확장 리로드됨. 페이지 새로고침(Cmd+R) 필요'; badge.style.display = 'block'; }
      return;
    }
    if (badge) { badge.innerText = 'D1에서 불러오는 중...'; badge.style.display = 'block'; }

    var currentUrl = window.location.href;
    CK.fetchSessionByUrl(currentUrl).then(function(data) {
      var sessions = data.sessions || [];
      if (sessions.length === 0) {
        // 프로젝트 누적 컨텍스트 시도
        return tryProjectInject(mode);
      }
      var s = sessions.sort(function(a, b) { return (b.total_chunks || 0) - (a.total_chunks || 0); })[0];
      return CK.fetchSession(s.session_id);
    }).then(function(s) {
      if (!s || !s.session_id) return;
      var ctx = buildCtxFromSession(s);

      // 프로젝트 누적: 같은 프로젝트의 다른 세션도 가져오기
      if (mode === 'full' && ctx.project && ctx.project !== 'unknown') {
        return CK.fetchProjectContext(ctx.project).then(function(allSessions) {
          if (allSessions.length > 1) {
            var text = CK.buildProjectContext(allSessions, mode);
            return clipAndNotify(text, 'Project context (' + allSessions.length + ' sessions)', mode);
          }
          return applyInject(ctx, mode);
        });
      }
      return applyInject(ctx, mode);
    }).catch(function(e) {
      if (badge) {
        badge.innerText = 'D1 error: ' + e.message;
        setTimeout(function() { badge.style.display = 'none'; }, 3000);
      }
    });
  }

  function tryProjectInject(mode) {
    return CK.fetchProjects().then(function(pData) {
      var projects = (pData.results || []).slice(0, 3);
      if (projects.length === 0) {
        CK.updateBadge('No context in D1. Run first.');
        setTimeout(function() { document.getElementById('ck-badge').style.display = 'none'; }, 3000);
        return null;
      }
      return CK.fetchLatestByProject(projects[0].project);
    });
  }

  function buildCtxFromSession(s) {
    return {
      summary: s.summary || '',
      topics: CK.tryParseJSON(s.topics) || [],
      key_decisions: CK.tryParseJSON(s.key_decisions) || [],
      tools: CK.tryParseJSON(s.tools) || [],
      project: s.project || '',
      status: s.status || '',
      checkpoint: s.checkpoint || '',
      chunks: (s.chunks || []).map(function(c) {
        return {
          chunk_index: c.chunk_index,
          chunk_summary: c.chunk_summary,
          chunk_checkpoint: c.chunk_checkpoint,
          decisions: CK.tryParseJSON(c.chunk_key_decisions) || [],
          unresolved: [],
          turn_start: c.turn_start,
          turn_end: c.turn_end,
          project: c.project || ''
        };
      }),
      _fromD1: true
    };
  }

  function applyInject(ctx, mode) {
    var text = CK.buildContext(ctx, mode);
    return clipAndNotify(text, (mode === 'full' ? 'Full' : 'Light') + ' context (D1)', mode);
  }

  function clipAndNotify(text, label, mode) {
    return navigator.clipboard.writeText(text).then(function() {
      CK.updateBadge(label + ' copied! Cmd+V to paste.');
      setTimeout(function() { document.getElementById('ck-badge').style.display = 'none'; }, 4000);
    });
  }

  // === BRW 패널 로드 ===
  function loadBrowsePanel(browsePanel, badge) {
    browsePanel.innerHTML = '<div style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;"><input id="ck-search-input" type="text" placeholder="벡터 검색..." style="width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#e4e4e7;font-size:11px;padding:5px 8px;outline:none;box-sizing:border-box;"/></div><div id="ck-brw-content" style="color:#888;font-size:11px;padding:4px 8px;">Loading...</div>';

    setTimeout(function() {
      var searchInput = document.getElementById('ck-search-input');
      if (searchInput) {
        searchInput.addEventListener('keydown', function(ev) {
          if (ev.key === 'Enter' && searchInput.value.trim().length > 0) {
            ev.preventDefault();
            doVectorSearch(searchInput.value.trim(), badge);
          }
        });
      }
    }, 100);

    loadCurrentSessionChunks(badge);
  }

  function doVectorSearch(query, badge) {
    var contentDiv = document.getElementById('ck-brw-content');
    if (contentDiv) contentDiv.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Searching...</div>';
    CK.vectorSearch(query, 8).then(function(data) {
      var res = data.results || [];
      if (!contentDiv) return;
      if (res.length === 0) { contentDiv.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">No results</div>'; return; }
      var sh = '<div style="color:#ffd166;font-size:10px;font-weight:700;padding:2px 8px;">' + res.length + ' results</div>';
      res.forEach(function(r) {
        var score = Math.round((r.score || 0) * 100);
        var tR = 'T' + (r.turn_start || 0) + '-' + (r.turn_end || 0);
        var proj = r.project || '';
        var sum = (r.chunk_summary || '').substring(0, 60);
        sh += '<div style="padding:4px 8px;cursor:pointer;border-radius:4px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.4;" data-search-sid="' + r.session_id + '"><span style="color:#86efac;font-size:9px;">' + score + '%</span> <span style="color:#c4a7e7;">' + proj + '</span> <span style="color:#93c5fd;">' + tR + '</span><br/>' + sum + '</div>';
      });
      contentDiv.innerHTML = sh;
      contentDiv.querySelectorAll('[data-search-sid]').forEach(function(el) {
        el.onclick = function() {
          var sid = el.getAttribute('data-search-sid');
          CK.fetchSession(sid).then(function(sess) {
            var allChunks = (sess.chunks || []).sort(function(a, b) { return (a.chunk_index || 0) - (b.chunk_index || 0); });
            var lines = ['[CONTEXT from Vector Search]', 'Project: ' + (sess.project || 'unknown') + ' | Chunks: ' + allChunks.length, ''];
            allChunks.forEach(function(ck, idx) {
              lines.push('[Chunk ' + (idx + 1) + ' T' + (ck.turn_start || 0) + '-' + (ck.turn_end || 0) + ']');
              lines.push(ck.raw_content || ck.chunk_summary || '(no data)');
              lines.push('');
            });
            var txt = lines.join('\n');
            navigator.clipboard.writeText(txt).then(function() {
              CK.updateBadge('Full session (' + allChunks.length + ' chunks, ' + txt.length + ' chars) copied');
              setTimeout(function() { badge.style.display = 'none'; }, 4000);
            });
          });
        };
      });
    }).catch(function(e) {
      if (contentDiv) contentDiv.innerHTML = '<div style="color:#f87171;font-size:11px;padding:4px 8px;">Error: ' + e.message + '</div>';
    });
  }

  function loadCurrentSessionChunks(badge) {
    var cid = CK.getChatId();
    CK.fetchSession(cid).then(function(sess) {
      var chunks = (sess.chunks || []).sort(function(a, b) { return (a.chunk_index || 0) - (b.chunk_index || 0); });
      var contentDiv = document.getElementById('ck-brw-content');
      if (!contentDiv) return;
      var html = '';
      if (chunks.length > 0) {
        html += '<div style="color:#86efac;font-size:10px;font-weight:700;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:2px;">THIS CHAT (' + chunks.length + ' chunks)</div>';
        chunks.forEach(function(ch, i) {
          var tRange = 'T' + (ch.turn_start || 0) + '-' + (ch.turn_end || 0);
          var rawSum = ch.chunk_summary || ch.chunk_checkpoint || '(요약 없음)';
          var sum = tRange + ' ' + rawSum.substring(0, 45);
          var hasRaw = ch.raw_content && ch.raw_content.length > 0;
          html += '<div style="padding:3px 8px;cursor:pointer;border-radius:4px;font-size:10px;color:#d4d4d8;transition:background 0.15s;line-height:1.3;" data-chunk-idx="' + i + '"><span style="color:#93c5fd;">[' + (i + 1) + ']</span> ' + sum + '...' + (hasRaw ? ' <span style="color:#ffd166;font-size:8px;">[RAW]</span>' : '') + '</div>';
        });
        html += '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:2px 0;"></div>';
      } else {
        html += '<div style="color:#888;font-size:10px;padding:4px 8px;">No chunks yet. Run first.</div>';
        html += '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:2px 0;"></div>';
      }
      html += '<div style="color:#86efac;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.1);" id="ck-brw-all-sessions">ALL SESSIONS</div>';

      contentDiv.innerHTML = html;

      // 청크 클릭 → 클립보드 복사
      contentDiv.querySelectorAll('[data-chunk-idx]').forEach(function(el) {
        el.onclick = function() {
          var idx = parseInt(el.getAttribute('data-chunk-idx'));
          var ch = chunks[idx];
          if (!ch) return;
          var txt = (ch.raw_content && ch.raw_content.length > 0) ? ch.raw_content : (ch.chunk_summary || '') + '\n\n' + (ch.chunk_checkpoint || '');
          navigator.clipboard.writeText(txt).then(function() {
            CK.updateBadge(ch.raw_content ? 'Raw (' + ch.raw_content.length + ' chars) copied' : 'Summary copied');
            setTimeout(function() { badge.style.display = 'none'; }, 3000);
          });
        };
      });

      // ALL SESSIONS
      var allBtn = document.getElementById('ck-brw-all-sessions');
      if (allBtn) {
        allBtn.onclick = function() { loadAllSessions(contentDiv, badge); };
      }
    }).catch(function() {
      var contentDiv = document.getElementById('ck-brw-content');
      if (contentDiv) contentDiv.innerHTML = '<div style="color:#888;font-size:10px;padding:4px 8px;">No chunks yet. Run first.</div><div style="color:#86efac;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;" id="ck-brw-all-sessions">ALL SESSIONS</div>';
      var allBtn = document.getElementById('ck-brw-all-sessions');
      if (allBtn) allBtn.onclick = function() { loadAllSessions(contentDiv, badge); };
    });
  }

  function loadAllSessions(container, badge) {
    container.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Loading sessions...</div>';
    CK.fetchSessions(30).then(function(j) {
      var sessions = j.results || [];
      if (!sessions.length) { container.innerHTML = '<div style="color:#888;font-size:11px;">No sessions</div>'; return; }
      var sh = '<div style="color:#86efac;font-size:10px;padding:2px 8px;font-weight:700;">ALL SESSIONS (' + sessions.length + ')</div>';
      sessions.forEach(function(s) {
        var label = s.project || s.title || s.session_id.substring(0, 8);
        sh += '<div style="padding:3px 8px;cursor:pointer;border-radius:6px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);" data-sid="' + s.session_id + '">' + label + ' <span style="color:#666;">(' + (s.total_turns || 0) + 't)</span></div>';
      });
      container.innerHTML = sh;
      container.querySelectorAll('[data-sid]').forEach(function(sel) {
        sel.onclick = function() {
          var sid = sel.getAttribute('data-sid');
          loadSessionChunks(sid, container, badge);
        };
      });
    });
  }

  function loadSessionChunks(sid, container, badge) {
    container.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 8px;">Loading chunks...</div>';
    CK.fetchSession(sid).then(function(sess) {
      var cks = sess.chunks || [];
      if (!cks.length) { container.innerHTML = '<div style="color:#888;font-size:11px;">No chunks</div>'; return; }
      var ch = '<div style="color:#86efac;font-size:10px;padding:2px 8px;font-weight:700;">' + (sess.project || sess.title || sid.substring(0, 8)) + ' (' + cks.length + ' chunks)</div>';
      cks.forEach(function(ck, idx) {
        var tR = 'T' + (ck.turn_start || 0) + '-' + (ck.turn_end || 0);
        var sm = tR + ' ' + (ck.chunk_summary || '(요약 없음)').substring(0, 50);
        var hasR = ck.raw_content && ck.raw_content.length > 0;
        ch += '<div style="padding:3px 8px;cursor:pointer;border-radius:6px;font-size:10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,0.05);" data-cidx="' + idx + '">[' + (idx + 1) + '] ' + sm + (hasR ? ' <span style="color:#86efac">[RAW]</span>' : '') + '</div>';
      });
      container.innerHTML = ch;
      container.querySelectorAll('[data-cidx]').forEach(function(cel) {
        cel.onclick = function() {
          var ci = parseInt(cel.getAttribute('data-cidx'));
          var chk = cks[ci];
          var txt = (chk.raw_content && chk.raw_content.length > 0) ? chk.raw_content : (chk.chunk_summary || '') + '\n\n' + (chk.chunk_checkpoint || '');
          navigator.clipboard.writeText(txt).then(function() {
            CK.updateBadge(chk.raw_content ? 'Raw (' + chk.raw_content.length + ' chars) copied' : 'Summary copied');
          });
        };
      });
    });
  }

})();
