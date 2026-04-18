/**
 * AIKeep24 - 요약 엔진 (summarizeAll + buildContext)
 */
(function() {
  var CK = window.CK;

  /**
   * INJ 범용화: 공통 4필드 프롬프트
   * summary, decisions, unresolved/next_steps, topics
   * 개발 프로젝트일 때만 files_modified 추가
   */
  function buildPrompt(chunkText, chunkIndex, totalChunks) {
    return '[SYSTEM] 반드시 ```json과 ```checkpoint 형식만 출력하세요. 대화 내용을 그대로 반복하거나 분석하지 마세요. 설명 없이 바로 JSON 블록으로 시작하세요.\n\n'
      + '[FORMAT]\n'
      + '```json\n'
      + '{"summary":"2~3문장 요약","topics":["주제1"],"decisions":["결정1"],"unresolved":["미해결1"],"next_steps":["다음단계1"],"tools":["기술1"],"project":"프로젝트명","files_modified":["파일1.py"]}\n'
      + '```\n\n'
      + '```checkpoint\n'
      + '완료: 항목 나열. 미해결: 항목+이유. 다음단계: 구체적 작업.\n'
      + '```\n'
      + '[/FORMAT]\n\n'
      + '[RULES]\n'
      + '- 반드시 아래 대화 원문에 실제로 등장하는 내용만 요약하세요. 원문에 없는 내용을 추가하거나 지어내면 안 됩니다.\n'
      + '- summary: 원문에서 실제로 논의된 구체적 주제와 결론을 2~3문장으로.\n'
      + '- decisions: 이 구간에서 합의/결정된 사항. 없으면 빈 배열.\n'
      + '- unresolved: 해결되지 않은 이슈, 에러, TODO를 구체적으로. 없으면 빈 배열.\n'
      + '- next_steps: 다음에 해야 할 구체적 작업. 없으면 빈 배열.\n'
      + '- files_modified: 수정/생성/삭제된 파일 경로. 개발 대화가 아니면 빈 배열.\n'
      + '- tools: 대화에서 실제로 언급된 기술, 도구, 서비스만 추출.\n'
      + '- project: 반드시 다음 중 하나만 사용=[' + CK.CONFIG.KNOWN_PROJECTS.join(', ') + ']. 관련 없으면 "unknown".\n'
      + '[/RULES]\n\n'
      + '전체 ' + totalChunks + '개 구간 중 ' + (chunkIndex + 1) + '번째 대화를 분석하세요:\n\n' + chunkText;
  }

  CK.summarizeAll = function() {
    if (CK.isRunning) {
      console.log('[CK] Already running, ignoring');
      return;
    }
    if (!CK.enabled) {
      console.log('[CK] Tab disabled, ignoring');
      return;
    }
    if (CK.shouldSkipConversation()) {
      CK.updateBadge('CK: Skipped (image/non-text)');
      console.log('[CK] Conversation skipped by filter');
      return;
    }

    CK.isRunning = true;
    CK.setRunBtnState(true);

    var allTurns = CK.extractTurns();
    if (allTurns.length < 2) {
      CK.updateBadge('CK: Not enough turns');
      CK.isRunning = false;
      CK.setRunBtnState(false);
      return;
    }

    var chatId = CK.getChatId();
    var hashKey = 'ck_last_hash_' + chatId;
    var turnKey = 'ck_last_turn_' + chatId;

    // 해시 기반 변경 감지
    var currentHash = CK.computeTurnHash(allTurns);

    CK.fetchLastTurnFromD1(chatId).then(function(d1LastTurn) {
      return new Promise(function(resolve) {
        chrome.storage.local.get([hashKey, turnKey], function(stored) {
          var savedHash = stored[hashKey] || '';
          var localLast = stored[turnKey] || 0;
          var lastTurn = d1LastTurn || localLast;

          // 해시 비교: 같으면 변경 없음
          if (savedHash && savedHash === currentHash) {
            console.log('[CK] Hash unchanged, no new content');
            CK.updateBadge('CK: No changes detected');
            CK.isRunning = false;
            CK.setRunBtnState(false);
            return;
          }

          if (lastTurn > allTurns.length) {
            console.log('[CK] lastTurn(' + lastTurn + ') > DOM(' + allTurns.length + '), DOM compressed');
            lastTurn = allTurns.length;
          }

          console.log('[CK] D1:', d1LastTurn, 'Local:', localLast, 'Using:', lastTurn, 'Hash:', currentHash);
          resolve({ lastTurn: lastTurn, currentHash: currentHash });
        });
      });
    }).then(function(info) {
      if (!info) return;
      var lastTurn = info.lastTurn;

      var newTurns = allTurns.slice(lastTurn);
      console.log('[CK] Total:', allTurns.length, 'Last:', lastTurn, 'New:', newTurns.length);

      if (newTurns.length < 2) {
        CK.updateBadge('CK: No new turns');
        var noNewSave = {};
        noNewSave[hashKey] = info.currentHash;
        noNewSave[turnKey] = allTurns.length;
        chrome.storage.local.set(noNewSave);
        CK.isRunning = false;
        CK.setRunBtnState(false);
        return;
      }

      // 청킹
      var chunks = [];
      for (var i = 0; i < newTurns.length; i += CK.CONFIG.TURNS_PER_CHUNK) {
        chunks.push(newTurns.slice(i, i + CK.CONFIG.TURNS_PER_CHUNK));
      }
      if (chunks.length > 1 && chunks[chunks.length - 1].length <= 5) {
        var lastShort = chunks.pop();
        chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(lastShort);
      }

      CK.updateBadge('CK: 0/' + chunks.length + '...');
      var results = [];
      var chain = Promise.resolve();

      chunks.forEach(function(chunk, ci) {
        chain = chain.then(function() {
          if (!CK.enabled) {
            console.log('[CK] Stopped by user at chunk ' + (ci + 1));
            CK.updateBadge('CK: Stopped');
            return Promise.reject('USER_STOP');
          }
          CK.updateBadge('CK: ' + (ci + 1) + '/' + chunks.length);
          var text = CK.formatChunk(chunk);
          if (text.length > 8000) text = text.substring(0, 8000);
          var prompt = buildPrompt(text, ci, chunks.length);
          return CK.callOllama(prompt);
        }).then(function(resp) {
          var fm = CK.parseJson(resp);
          var cp = CK.parseCheckpoint(resp);
          console.log('[CK] Chunk ' + (ci + 1) + ':', fm ? (fm.summary || '').substring(0, 80) : 'fail');
          results.push({ frontmatter: fm, checkpoint: cp });

          if (fm) {
            var chunkEnd = Math.min(lastTurn + (ci + 1) * CK.CONFIG.TURNS_PER_CHUNK, allTurns.length);
            CK.saveChunk({
              session_id: chatId,
              url: window.location.href,
              chunk_index: ci,
              chunk_summary: fm.summary || '',
              chunk_checkpoint: cp || '',
              turn_start: lastTurn + ci * CK.CONFIG.TURNS_PER_CHUNK + 1,
              turn_end: chunkEnd,
              raw_content: CK.formatChunk(chunks[ci]),
              frontmatter: fm,
              project: fm.project || ''
            });
            // 청크 완료 시 즉시 진행상태 저장 (재실행 시 이어서 처리)
            var partialSave = {};
            partialSave[turnKey] = chunkEnd;
            chrome.storage.local.set(partialSave);
            console.log('[CK] Progress saved: turn ' + chunkEnd);
          }
        }).catch(function(err) {
          console.error('[CK] Chunk ' + (ci + 1) + ':', err);
          results.push({ frontmatter: null, checkpoint: '' });
        });
      });

      chain.then(function() {
        var valid = results.filter(function(r) { return r.frontmatter; });
        if (valid.length === 0) {
          CK.updateBadge('CK: All failed');
          return;
        }

        CK.updateBadge('CK: Saving...');

        // INJ 구조화된 필드 조합: 청크 데이터에서 직접 병합
        var allTopics = [], allTools = [], allDecisions = [], allUnresolved = [], allNextSteps = [], allFiles = [];
        var lastProject = '', lastStatus = '진행중';

        valid.forEach(function(r) {
          var f = r.frontmatter;
          mergeUnique(allTopics, f.topics);
          mergeUnique(allTools, f.tools);
          mergeUnique(allDecisions, f.decisions || f.key_decisions);
          mergeUnique(allUnresolved, f.unresolved);
          mergeUnique(allNextSteps, f.next_steps);
          mergeUnique(allFiles, f.files_modified);
          if (f.project) lastProject = f.project;
          if (f.status) lastStatus = f.status;
        });

        var lastValid = valid[valid.length - 1].frontmatter;
        var sessionSummary = lastValid.summary || '';

        // 최근 3개 청크로 checkpoint 조립
        var recentChunks = valid.slice(-3);
        var checkpoint = recentChunks.map(function(r) {
          return r.frontmatter.summary || '';
        }).filter(function(s) { return s.length > 0; }).join(' \u2192 ');

        var chunkData = chunks.map(function(chunk, i) {
          return {
            turn_start: lastTurn + i * CK.CONFIG.TURNS_PER_CHUNK + 1,
            turn_end: Math.min(lastTurn + (i + 1) * CK.CONFIG.TURNS_PER_CHUNK, allTurns.length),
            summary: results[i] && results[i].frontmatter ? (results[i].frontmatter.summary || '') : '',
            checkpoint: results[i] ? (results[i].checkpoint || '') : '',
            topics: results[i] && results[i].frontmatter ? (results[i].frontmatter.topics || []) : [],
            key_decisions: results[i] && results[i].frontmatter ? (results[i].frontmatter.decisions || results[i].frontmatter.key_decisions || []) : [],
            raw_content: CK.formatChunk(chunk)
          };
        });

        CK.updateBadge('CK Done!\n' + sessionSummary.substring(0, 150));

        return CK.saveToWorker({
          session_id: chatId,
          source: CK.getPlatformKey(),
          url: window.location.href,
          title: document.title || 'AI Chat',
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
          saveObj[turnKey] = allTurns.length;
          saveObj[hashKey] = info.currentHash;
          chrome.storage.local.set(saveObj);
          CK.lastTurnCount = allTurns.length;
          CK.autoRunTriggered = true;
          if (CK.autoRunTimer) { clearTimeout(CK.autoRunTimer); CK.autoRunTimer = null; }
        });
      }).catch(function(err) {
        if (err === 'USER_STOP') {
          console.log('[CK] Run stopped by user');
        } else {
          console.error('[CK] Chain error:', err);
        }
      }).finally(function() {
        CK.isRunning = false;
        CK.setRunBtnState(false);
      });
    });
  };

  /**
   * INJ 범용 컨텍스트 빌드
   * 공통 4필드: summary, decisions, unresolved, topics
   */
  CK.buildContext = function(ctx, mode) {
    // SNAP 스냅샷 우선
    if (ctx.checkpoint && ctx.checkpoint.length > 100) {
      var text = ctx.checkpoint;
      if (text.indexOf('위 맥락을') === -1) {
        text += '\n\n위 맥락을 참고하여 이어서 작업해주세요.';
      }
      return text;
    }

    var text = '[CONTEXT INJECTION]\n';
    text += 'Project: ' + (ctx.project || 'unknown') + ' | Status: ' + (ctx.status || '진행중') + '\n\n';

    // 구조화된 필드 조합 (체크포인트 텍스트 대신 JSON 필드 직접 사용)
    var chunks = ctx.chunks || [];

    // 결정사항 수집
    var allDecisions = [];
    var allUnresolved = [];
    chunks.forEach(function(c) {
      var d = c.decisions || c.key_decisions || [];
      if (typeof d === 'string') d = CK.tryParseJSON(d);
      mergeUnique(allDecisions, d);
      var u = c.unresolved || [];
      if (typeof u === 'string') u = CK.tryParseJSON(u);
      mergeUnique(allUnresolved, u);
    });

    var recent = mode === 'full' ? chunks.slice(-5) : chunks.slice(-3);
    if (recent.length > 0) {
      text += '[RECENT PROGRESS]\n';
      recent.forEach(function(c) {
        var sum = c.chunk_summary || c.summary || '';
        if (sum) text += '- ' + sum + '\n';
      });
      text += '\n';
    }

    if (allDecisions.length > 0) {
      text += '[DECISIONS] ' + allDecisions.join(', ') + '\n\n';
    }
    if (allUnresolved.length > 0) {
      text += '[UNRESOLVED] ' + allUnresolved.join(', ') + '\n\n';
    }

    if (ctx.key_decisions && ctx.key_decisions.length > 0 && allDecisions.length === 0) {
      text += '[KEY DECISIONS] ' + ctx.key_decisions.join(', ') + '\n\n';
    }
    if (mode === 'full' && ctx.tools && ctx.tools.length > 0) {
      text += '[TOOLS] ' + ctx.tools.join(', ') + '\n\n';
    }

    text += '위 맥락을 참고하여 이어서 작업해주세요.';
    return text;
  };

  /**
   * INJ 프로젝트 누적 컨텍스트: 여러 세션 통합
   */
  CK.buildProjectContext = function(sessions, mode) {
    var text = '[PROJECT CONTEXT - ' + sessions.length + ' sessions]\n\n';
    // 최신 세션부터 역순, 토큰 한도 내에서 최대한 채움
    var reversed = sessions.slice().reverse();
    var totalLen = 0;
    var maxLen = 4000;

    reversed.forEach(function(sess, idx) {
      if (totalLen > maxLen) return;
      var chunks = (sess.chunks || []).sort(function(a, b) {
        return (b.chunk_index || 0) - (a.chunk_index || 0);
      });
      text += '[Session ' + (idx + 1) + '] ' + (sess.project || '') + ' (' + (sess.created_at || '').substring(0, 10) + ')\n';
      chunks.forEach(function(c) {
        if (totalLen > maxLen) return;
        var line = '- ' + (c.chunk_summary || '') + '\n';
        text += line;
        totalLen += line.length;
      });
      text += '\n';
    });

    text += '위 맥락을 참고하여 이어서 작업해주세요.';
    return text;
  };

  function mergeUnique(target, source) {
    if (!source || !Array.isArray(source)) return;
    source.forEach(function(item) {
      if (item && target.indexOf(item) === -1) target.push(item);
    });
  }

})();
