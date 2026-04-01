/**
 * AIKeep24 - Ollama 클라이언트 (LLM 호출 + 파싱)
 */
(function() {
  var CK = window.CK;

  CK.callOllama = function(prompt, maxTokens) {
    return new Promise(function(resolve, reject) {
      var opts = {
        temperature: CK.CONFIG.TEMPERATURE || 0.3,
        num_predict: maxTokens || CK.CONFIG.NUM_PREDICT || 512,
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
    var m = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (m) {
      try { return JSON.parse(m[1]); } catch(e) {}
    }
    var s = text.indexOf('{');
    var e = text.lastIndexOf('}') + 1;
    if (s >= 0 && e > s) {
      try { return JSON.parse(text.substring(s, e)); } catch(ex) {}
    }
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
