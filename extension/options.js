(function() {
  var KEYS = {
    backend: 'ck_backend',
    model: 'ck_ollama_model',
    ollamaUrl: 'ck_ollama_url',
    optiqModel: 'ck_optiq_model',
    optiqUrl: 'ck_optiq_url',
    neuronsModel: 'ck_neurons_model',
    neuronsUrl: 'ck_neurons_url',
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
    backend: 'ollama',
    model: 'exaone3.5:7.8b',
    ollamaUrl: 'http://localhost:11434',
    optiqModel: 'FakeRockert543/gemma-4-e4b-it-MLX-4bit',
    optiqUrl: 'http://localhost:8080',
    neuronsModel: 'mlx-community/gemma-3-4b-it-qat-4bit',
    neuronsUrl: 'http://localhost:8080',
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

  function applyBackendVisibility() {
    var backend = document.getElementById('backend').value;
    document.getElementById('ollamaGroup').classList.remove('active');
    document.getElementById('optiqGroup').classList.remove('active');
    document.getElementById('neuronsGroup').classList.remove('active');
    if (backend === 'optiq') {
      document.getElementById('optiqGroup').classList.add('active');
    } else if (backend === 'neurons') {
      document.getElementById('neuronsGroup').classList.add('active');
    } else {
      document.getElementById('ollamaGroup').classList.add('active');
    }
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
      applyBackendVisibility();
    });

    var toggle = document.getElementById('thinkToggle');
    if (toggle) {
      toggle.addEventListener('click', function() {
        var isOn = toggle.getAttribute('data-on') === 'true';
        setThinkUI(!isOn);
      });
    }

    var backendSel = document.getElementById('backend');
    if (backendSel) {
      backendSel.addEventListener('change', applyBackendVisibility);
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

  function testConnection() {
    var backend = document.getElementById('backend').value;
    if (backend === 'optiq') {
      testOpenAICompat('Optiq', document.getElementById('optiqUrl').value.trim(), document.getElementById('optiqModel').value.trim());
    } else if (backend === 'neurons') {
      testOpenAICompat('Neurons', document.getElementById('neuronsUrl').value.trim(), document.getElementById('neuronsModel').value.trim());
    } else {
      testOllama();
    }
  }

  function testOllama() {
    var url = document.getElementById('ollamaUrl').value.trim();
    var model = document.getElementById('model').value.trim();
    showStatus('Testing Ollama...', 'ok');
    fetch(url + '/api/tags', {method: 'GET'})
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var models = (data.models || []).map(function(m) { return m.name; });
        var found = models.some(function(m) { return m.indexOf(model.split(':')[0]) >= 0; });
        if (found) {
          showStatus('Ollama connected! Model "' + model + '" found. Available: ' + models.join(', '), 'ok');
        } else {
          showStatus('Ollama connected but "' + model + '" not found. Available: ' + models.join(', '), 'err');
        }
      })
      .catch(function(e) { showStatus('Ollama connection failed: ' + e.message, 'err'); });
  }

  function testOpenAICompat(name, url, model) {
    showStatus('Testing ' + name + '...', 'ok');
    fetch(url + '/v1/models', {method: 'GET'})
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var models = (data.data || []).map(function(m) { return m.id; });
        if (models.length > 0) {
          showStatus(name + ' connected! Available: ' + models.join(', '), 'ok');
        } else {
          showStatus(name + ' connected! (model list empty — server may still work)', 'ok');
        }
      })
      .catch(function(e) { showStatus(name + ' connection failed: ' + e.message, 'err'); });
  }

  function showStatus(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  document.addEventListener('DOMContentLoaded', function() {
    load();
    document.getElementById('btnSave').addEventListener('click', save);
    document.getElementById('btnTest').addEventListener('click', testConnection);
  });
})();
