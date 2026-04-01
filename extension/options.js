(function() {
  var KEYS = {
    model: 'ck_ollama_model',
    ollamaUrl: 'ck_ollama_url',
    numCtx: 'ck_num_ctx',
    numPredict: 'ck_num_predict',
    temperature: 'ck_temperature',
    workerUrl: 'ck_worker_url',
    apiKey: 'ck_api_key',
    turnsPerChunk: 'ck_turns_per_chunk',
    maxTextLen: 'ck_max_text_len',
    thinking: 'ck_thinking'
  };

  var DEFAULTS = {
    model: 'exaone3.5:7.8b',
    ollamaUrl: 'http://localhost:11434',
    numCtx: '6144',
    numPredict: '384',
    temperature: '0.3',
    workerUrl: 'https://aikeep24-web.hugh79757.workers.dev',
    apiKey: '',
    turnsPerChunk: '20',
    maxTextLen: '8000',
    thinking: 'false'
  };

  function setThinkUI(on) {
    var toggle = document.getElementById('thinkToggle');
    var knob = document.getElementById('thinkKnob');
    var label = document.getElementById('thinkLabel');
    if (!toggle) return;
    toggle.setAttribute('data-on', on ? 'true' : 'false');
    toggle.style.background = on ? '#86efac' : '#30363D';
    knob.style.left = on ? '22px' : '2px';
    knob.style.background = on ? '#0f172a' : '#8B949E';
    label.textContent = on ? 'ON' : 'OFF';
    label.style.color = on ? '#86efac' : '#f87171';
  }

  function load() {
    chrome.storage.local.get(Object.values(KEYS), function(data) {
      Object.keys(KEYS).forEach(function(field) {
        if (field === 'thinking') return;
        var el = document.getElementById(field);
        if (el) el.value = data[KEYS[field]] || DEFAULTS[field];
      });
      var thinkVal = data[KEYS.thinking] || DEFAULTS.thinking;
      setThinkUI(thinkVal === 'true');
    });

    var toggle = document.getElementById('thinkToggle');
    if (toggle) {
      toggle.addEventListener('click', function() {
        var isOn = toggle.getAttribute('data-on') === 'true';
        setThinkUI(!isOn);
      });
    }
  }

  function save() {
    var obj = {};
    Object.keys(KEYS).forEach(function(field) {
      if (field === 'thinking') return;
      var el = document.getElementById(field);
      if (el) obj[KEYS[field]] = el.value.trim();
    });
    var toggle = document.getElementById('thinkToggle');
    obj[KEYS.thinking] = toggle ? toggle.getAttribute('data-on') : 'false';
    chrome.storage.local.set(obj, function() {
      showStatus('Settings saved! Reload extension to apply.', 'ok');
    });
  }

  function testOllama() {
    var url = document.getElementById('ollamaUrl').value.trim();
    var model = document.getElementById('model').value.trim();
    showStatus('Testing connection...', 'ok');
    fetch(url + '/api/tags', {method: 'GET'})
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var models = (data.models || []).map(function(m) { return m.name; });
        var found = models.some(function(m) { return m.indexOf(model.split(':')[0]) >= 0; });
        if (found) {
          showStatus('Connected! Model "' + model + '" found. Available: ' + models.join(', '), 'ok');
        } else {
          showStatus('Connected but model "' + model + '" not found. Available: ' + models.join(', '), 'err');
        }
      })
      .catch(function(e) {
        showStatus('Connection failed: ' + e.message, 'err');
      });
  }

  function showStatus(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  document.getElementById('btnSave').addEventListener('click', save);
  document.getElementById('btnTest').addEventListener('click', testOllama);
  document.addEventListener('DOMContentLoaded', load);
  load();
})();