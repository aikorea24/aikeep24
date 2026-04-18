/**
 * AIKeep24 - Ollama 클라이언트 (LLM 호출 + 파싱)
 */
(function() {
  var CK = window.CK;

  CK.callOllama = function(prompt, maxTokens) {
    return new Promise(function(resolve, reject) {
      var opts = {
        temperature: CK.CONFIG.TEMPERATURE || 0.3,
        num_predict: maxTokens || CK.CONFIG.NUM_PREDICT || 1024,
        num_ctx: CK.CONFIG.NUM_CTX || 6144
      };
      var payload = {
        model: CK.CONFIG.OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: opts
      };
      if (CK.CONFIG.THINKING === false) payload.think = false;
      chrome.runtime.sendMessage({
        type: 'ollama',
        payload: payload
      }, function(resp) {
        if (resp && resp.ok) {
          resolve(resp.response);
        } else {
          reject(new Error(resp ? resp.error : 'no response'));
        }
      });
    });
  };

  CK.parseJson = function(text) {
    // 1) ```json fenced
    var m = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (m) {
      try { return JSON.parse(m[1]); } catch(e) {}
      // fenced block이지만 잘렸다면 복구 시도
      var fixed = tryRepairJson(m[1]);
      if (fixed) return fixed;
    }
    // 2) first { ~ last }
    var s = text.indexOf('{');
    var e = text.lastIndexOf('}') + 1;
    if (s >= 0 && e > s) {
      try { return JSON.parse(text.substring(s, e)); } catch(ex) {}
    }
    // 3) truncated JSON 복구 (summary, topics만이라도 살리기)
    if (s >= 0) {
      var partial = text.substring(s);
      var repaired = tryRepairJson(partial);
      if (repaired) return repaired;
    }
    // 4) 다중 블록 병합
    var jsonBlocks = text.match(/\{[^{}]+\}/g);
    if (jsonBlocks && jsonBlocks.length > 1) {
      var merged = {};
      jsonBlocks.forEach(function(b) {
        try {
          var obj = JSON.parse(b);
          Object.keys(obj).forEach(function(k) { merged[k] = obj[k]; });
        } catch(ee) {}
      });
      if (Object.keys(merged).length >= 2) return merged;
    }
    return null;
  };

  // 잘린 JSON에서 summary 같은 핵심 필드만이라도 추출
  function tryRepairJson(text) {
    var out = {};
    var sm = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (sm) out.summary = sm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    var tm = text.match(/"topics"\s*:\s*\[([^\]]*)/);
    if (tm) {
      out.topics = tm[1].match(/"([^"]+)"/g);
      if (out.topics) out.topics = out.topics.map(function(s){return s.slice(1,-1);});
    }
    var dm = text.match(/"decisions"\s*:\s*\[([^\]]*)/);
    if (dm) {
      out.decisions = dm[1].match(/"([^"]+)"/g);
      if (out.decisions) out.decisions = out.decisions.map(function(s){return s.slice(1,-1);});
    }
    var pm = text.match(/"project"\s*:\s*"([^"]+)"/);
    if (pm) out.project = pm[1];
    var stm = text.match(/"status"\s*:\s*"([^"]+)"/);
    if (stm) out.status = stm[1];
    if (out.summary && out.summary.length > 10) return out;
    return null;
  }

  CK.parseCheckpoint = function(text) {
    var m = text.match(/```[Cc]heckpoint\s*\n([\s\S]*?)\n```/);
    if (m) return m[1].trim();
    m = text.match(/```checkpoint([\s\S]*?)```/i);
    if (m) return m[1].trim();
    var idx = text.indexOf('# 맥락');
    if (idx < 0) idx = text.indexOf('# Context');
    if (idx < 0) idx = text.indexOf('checkpoint');
    if (idx >= 0) return text.substring(idx, idx + 600).trim();
    return '';
  };

})();
