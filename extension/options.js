(function() {
  var DEFAULTS = {
    model: 'exaone3.5:7.8b',
    ollamaUrl: 'http://localhost:11434',
    numCtx: 6144,
    numPredict: 384,
    temperature: 0.3,
    workerUrl: 'https://aikeep24-web.hugh79757.workers.dev',
    apiKey: '',
    turnsPerChunk: 20,
    maxTextLen: 8000
  };

  var fields = ['model','ollamaUrl','numCtx','numPredict','temperature','workerUrl','apiKey','turnsPerChunk','maxTextLen'];

  function load() {
    chrome.storage.local.get(['ck_settings'], function(data) {
      var s = data.ck_settings || {};
      fields.forEach(function(f) {
        var el = document.getElementById(f);
        if (el) el.value = s[f] !== undefined ? s[f] : DEFAULTS[f];
      });
    });
  }

  function save() {
    var settings = {};
    fields.forEach(function(f) {
      var el = document.getElementById(f);
      if (!el) return;
      var v = el.value.trim();
      if (el.type === 'number') v = parseFloat(v) || DEFAULTS[f];
      settings[f] = v;
    });
    chrome.storage.local.set({ck_settings: settings}, function() {
      var status = document.getElementById('status');
      status.style.display = 'block';
      status.textContent = 'Settings saved! Reload your Genspark tab to apply.';
      setTimeout(function() { status.style.display = 'none'; }, 4000);
    });
  }

  function testOllama() {
    var model = document.getElementById('model').value.trim() || DEFAULTS.model;
    var url = (document.getElementById('ollamaUrl').value.trim() || DEFAULTS.ollamaUrl) + '/api/generate';
    var numCtx = parseInt(document.getElementById('numCtx').value) || DEFAULTS.numCtx;
    var result = document.getElementById('testResult');
    result.style.display = 'block';
    result.textContent = 'Testing ' + model + '...';
    var start = Date.now();
    fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: model,
        prompt: '[SYSTEM] Output only ```json and ```checkpoint blocks.\n\n```json\n{"summary":"test","topics":["test"],"project":"unknown"}\n```\n\n```checkpoint\nDone: test.\n```\n\nSummarize: User said hello. Assistant replied hi.',
        stream: false,
        options: { num_ctx: numCtx, num_predict: 200, temperature: 0.3 }
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      var elapsed = ((Date.now() - start) / 1000).toFixed(1);
      var hasJson = (d.response || '').indexOf('"summary"') >= 0;
      var hasCP = (d.response || '').toLowerCase().indexOf('checkpoint') >= 0;
      result.textContent = 'Model: ' + model + '\n'
        + 'Time: ' + elapsed + 's\n'
        + 'Tokens: ' + (d.eval_count || 0) + '\n'
        + 'JSON output: ' + (hasJson ? 'YES' : 'NO') + '\n'
        + 'Checkpoint: ' + (hasCP ? 'YES' : 'NO') + '\n'
        + '---\n' + (d.response || '').substring(0, 300);
      result.style.color = (hasJson && hasCP) ? '#86efac' : '#f87171';
    }).catch(function(e) {
      result.textContent = 'Error: ' + e.message + '\nIs Ollama running? Check: ' + url;
      result.style.color = '#f87171';
    });
  }

  document.getElementById('saveBtn').onclick = save;
  document.getElementById('testBtn').onclick = testOllama;
  load();
})();