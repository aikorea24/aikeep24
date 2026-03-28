export const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <link rel="icon" type="image/png" href="data:image/png;base64,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">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AIKeep24</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,'Pretendard',sans-serif;background:#0D1117;color:#E6EDF3;padding:16px;max-width:640px;margin:0 auto}
  h1{font-size:1.5em;margin-bottom:14px;color:#7AA2F7;letter-spacing:-0.5px}
  .key-area{display:flex;gap:6px;align-items:center;margin-bottom:10px}
  .key-area input{flex:1;padding:10px;border:1px solid #30363D;border-radius:8px;background:#161B22;color:#E6EDF3;font-size:12px}
  .key-area button{width:auto;padding:10px 14px;font-size:12px;margin:0;white-space:nowrap}
  .key-status{font-size:11px;text-align:right;margin:-6px 0 10px;color:#565F89}
  .key-status.saved{color:#9ECE6A}
  .tab-bar{display:flex;gap:6px;margin-bottom:16px}
  .tab{flex:1;padding:11px;text-align:center;background:#161B22;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#8B949E;transition:all .2s;border:1px solid transparent}
  .tab:hover{background:#1F2937;color:#C0CAF5}
  .tab.active{background:#7AA2F7;color:#fff;border-color:#7AA2F7}
  .section{display:none}.section.active{display:block}
  input,select{width:100%;padding:10px;margin:6px 0;border:1px solid #30363D;border-radius:8px;background:#161B22;color:#E6EDF3;font-size:14px;transition:border-color .2s}
  input:focus,select:focus{outline:none;border-color:#7AA2F7}
  button{width:100%;padding:12px;margin:8px 0;border:none;border-radius:8px;background:#7AA2F7;color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s}
  button:hover{background:#5D8BF4}
  button:active{background:#4C7CF0}
  .btn-sm{font-size:13px;padding:8px 12px;background:#161B22;border:1px solid #7AA2F7;color:#7AA2F7}
  .btn-sm:hover{background:#1F2937}
  .card{background:#161B22;padding:16px;margin:10px 0;border-radius:10px;cursor:pointer;transition:all .2s;border-left:4px solid #30363D}
  .card:hover{background:#1F2937;border-left-color:#7AA2F7;transform:translateX(2px)}
  .card h3{color:#E6EDF3;font-size:.95em;margin:0 0 8px 0;display:flex;justify-content:space-between;align-items:center}
  .card p{color:#8B949E;font-size:.85em;margin:4px 0}
  .card .project-badge{background:#7AA2F733;color:#7AA2F7;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;border:1px solid #7AA2F744}
  .card .status-badge{font-size:10px;padding:2px 8px;border-radius:8px;margin-left:6px}
  .card .status-badge.done{background:#1B4332;color:#9ECE6A}
  .card .status-badge.progress{background:#3D2E00;color:#E0AF68}
  .card .summary{color:#C0CAF5;font-size:13px;line-height:1.5;margin:6px 0 10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .card .meta-row{display:flex;gap:12px;color:#565F89;font-size:11px;margin-top:8px;align-items:center}
  .card .meta-row span{display:flex;align-items:center;gap:3px}
  .chunk-card{background:#0D1117;padding:12px 16px;margin:6px 0;border-radius:8px;cursor:pointer;border-left:3px solid #E0AF68;transition:all .2s}
  .chunk-card:hover{background:#1A1F2E;transform:translateX(2px)}
  .chunk-card .chunk-label{color:#E0AF68;font-size:11px;font-weight:600;margin-bottom:4px}
  .chunk-card .chunk-summary{color:#8B949E;font-size:12px;line-height:1.4}
  .score-bar{display:inline-block;height:4px;border-radius:2px;margin-left:6px;vertical-align:middle}
  .ses-date-group{color:#565F89;font-size:12px;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid #30363D}
  .msg{padding:10px;margin:8px 0;border-radius:8px;text-align:center}
  .msg.ok{background:#1B4332;color:#9ECE6A}.msg.err{background:#3D0000;color:#F7768E}
  .empty-state{text-align:center;padding:40px 20px;color:#565F89}
  .empty-state .icon{font-size:32px;margin-bottom:8px}
  .empty-state p{font-size:13px;line-height:1.5}
  .loading{text-align:center;padding:40px;color:#565F89}
  .filter-row{display:flex;gap:6px;margin-bottom:8px}
  .filter-row>*{flex:1}

  .modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:1000;justify-content:center;align-items:flex-start;padding:20px;overflow-y:auto}
  .modal-overlay.active{display:flex}
  .modal{background:#161B22;border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;margin:auto;border:1px solid #30363D}
  .modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #30363D;flex-shrink:0}
  .modal-header h2{font-size:1.1em;color:#7AA2F7;flex:1;margin-right:10px;word-break:break-word}
  .modal-close{background:#30363D;border:none;color:#E6EDF3;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
  .modal-close:hover{background:#484F58}
  .modal-meta{padding:12px 16px;border-bottom:1px solid #30363D;font-size:12px;color:#565F89;flex-shrink:0}
  .modal-meta span{margin-right:12px}
  .modal-meta .tag{background:#7AA2F733;color:#7AA2F7;padding:2px 8px;border-radius:4px;font-size:11px}
  .modal-body{padding:16px;overflow-y:auto;flex:1}
  .modal-body pre{white-space:pre-wrap;word-break:break-word;font-family:'JetBrains Mono','Fira Code',monospace;font-size:13px;line-height:1.7;color:#C0CAF5}
  .modal-search{display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #30363D;flex-shrink:0}
  .modal-search input{flex:1;padding:8px;border:1px solid #30363D;border-radius:6px;background:#0D1117;color:#E6EDF3;font-size:13px}
  .modal-search-btn{width:32px;height:32px;border:1px solid #30363D;border-radius:6px;background:#0D1117;color:#E6EDF3;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0}
  .modal-actions{padding:12px 16px;border-top:1px solid #30363D;display:flex;gap:8px;flex-shrink:0}
  .modal-actions button{flex:1;padding:10px;font-size:13px;margin:0}
  .btn-secondary{background:#30363D;color:#8B949E}
  .btn-secondary:hover{background:#484F58}
  .btn-danger{background:#F7768E}.btn-danger:hover{background:#E5566E}
  mark.hl{background:#7AA2F755;color:#fff;border-radius:2px;padding:0 1px}
  mark.hl.current{background:#E0AF68;color:#000}
  #noteSearchCount{font-size:11px;color:#565F89;white-space:nowrap;min-width:40px;text-align:center}
</style>
</head>
<body>
<h1>AIKeep24</h1>

<div class="key-area">
  <input id="apiKey" type="password" placeholder="API Key" />
  <button class="btn-sm" onclick="toggleKey()">Show</button>
  <button class="btn-sm" onclick="saveKey()">Save</button>
</div>
<div class="key-status" id="keyStatus"></div>

<div class="tab-bar">
  <div class="tab active" onclick="showTab('search',this)">Search</div>
  <div class="tab" onclick="showTab('sessions',this)">Sessions</div>
</div>

<div id="search" class="section active">
  <input id="searchQ" placeholder="Search conversations..." onkeydown="if(event.key==='Enter')doSearch()" />
  <div class="filter-row">
    <select id="searchProject"><option value="">All Projects</option></select>
    <input id="searchFrom" type="date" style="font-size:12px" />
    <input id="searchTo" type="date" style="font-size:12px" />
  </div>
  <button onclick="doSearch()">Search</button>
  <div id="searchResults">
    <div class="empty-state"><div class="icon">&#128269;</div><p>Enter a keyword to search across all conversations using vector similarity.</p></div>
  </div>
</div>

<div id="sessions" class="section">
  <div class="filter-row">
    <input id="sesQ" placeholder="Keyword" style="flex:2" onkeydown="if(event.key==='Enter')loadSessions()" />
    <button class="btn-sm" onclick="loadSessions()" style="width:auto;padding:8px 14px;flex:0">Go</button>
  </div>
  <div class="filter-row">
    <select id="sesProject"><option value="">All Projects</option></select>
    <select id="sesStatus">
      <option value="">All Status</option>
      <option value="진행중">진행중</option>
      <option value="완료">완료</option>
      <option value="보류">보류</option>
    </select>
  </div>
  <div class="filter-row">
    <input id="sesFrom" type="date" style="font-size:12px" />
    <input id="sesTo" type="date" style="font-size:12px" />
  </div>
  <div id="sesResults">
    <div class="empty-state"><div class="icon">&#128203;</div><p>Click Go or enter a keyword to browse sessions.</p></div>
  </div>
</div>

<div class="modal-overlay" id="sessionModal" onclick="if(event.target===this)closeSessionModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="smTitle">...</h2>
      <button class="modal-close" onclick="closeSessionModal()">&#10005;</button>
    </div>
    <div class="modal-meta" id="smMeta"></div>
    <div class="modal-body" id="smBody"><div class="loading">Loading...</div></div>
  </div>
</div>

<div class="modal-overlay" id="noteModal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="modalTitle">...</h2>
      <button class="modal-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-meta" id="modalMeta"></div>
    <div class="modal-search">
      <input id="noteSearchInput" placeholder="Search in note..." oninput="highlightSearch()" />
      <span id="noteSearchCount"></span>
      <button class="modal-search-btn" onclick="jumpSearch(-1)">&#9650;</button>
      <button class="modal-search-btn" onclick="jumpSearch(1)">&#9660;</button>
    </div>
    <div class="modal-body" id="modalBody"><div class="loading">Loading...</div></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="copyContent()">Copy</button>
    </div>
  </div>
</div>

<script>
const BASE=location.origin;
let currentNoteName='';

const keyInput=document.getElementById('apiKey');
const keyStatusEl=document.getElementById('keyStatus');

function h(k){return{'Authorization':'Bearer '+k,'Content-Type':'application/json'}}
function getKey(){return keyInput.value.trim()||localStorage.getItem('ck_api_key')||''}
function saveKey(){const k=keyInput.value.trim();if(!k)return;localStorage.setItem('ck_api_key',k);keyStatusEl.textContent='Key saved';keyStatusEl.className='key-status saved';loadProjects()}
function toggleKey(){keyInput.type=keyInput.type==='password'?'text':'password'}

function showTab(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  if(id==='sessions')loadSessions();
}

async function loadProjects(){
  const k=getKey();if(!k)return;
  try{
    const r=await fetch(BASE+'/api/sessions/projects',{headers:h(k)});
    const d=await r.json();
    const projects=d.projects||d.results||[];
    ['searchProject','sesProject'].forEach(id=>{
      const sel=document.getElementById(id);
      const val=sel.value;
      sel.innerHTML='<option value="">All Projects</option>';
      projects.forEach(p=>{if(p&&p.project)sel.innerHTML+='<option value="'+p.project+'">'+p.project+'</option>'});
      sel.value=val;
    });
  }catch(e){console.error('loadProjects:',e)}
}

async function doSearch(){
  const k=getKey();if(!k){alert('Enter API key first');return}
  const q=document.getElementById('searchQ').value.trim();
  const project=document.getElementById('searchProject').value;
  const from=document.getElementById('searchFrom').value;
  const to=document.getElementById('searchTo').value;
  const resultsDiv=document.getElementById('searchResults');
  if(!q){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128269;</div><p>Enter a search term.</p></div>';return}
  resultsDiv.innerHTML='<div class="loading">Searching...</div>';
  try{
    let url=BASE+'/api/vector-search?q='+encodeURIComponent(q)+'&limit=15';
    if(project)url+='&project='+encodeURIComponent(project);
    if(from)url+='&from='+encodeURIComponent(from);
    if(to)url+='&to='+encodeURIComponent(to);
    const r=await fetch(url,{headers:h(k)});
    const d=await r.json();
    const results=d.results||[];
    if(!results.length){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128269;</div><p>No matching results. Try different keywords.</p></div>';return}
    let html='<div style="color:#565F89;font-size:12px;margin:8px 0">'+results.length+' results</div>';
    results.forEach(r=>{
      const score=r.score||0;
      const pct=Math.round(score*100);
      const barColor=score>0.6?'#9ECE6A':score>0.4?'#E0AF68':'#F7768E';
      html+='<div class="card" onclick="openSession(&quot;'+r.session_id+'&quot;)">'
        +'<h3><span>'+(r.project||r.session_id.substring(0,8))+'</span><span class="project-badge">'+pct+'% match</span></h3>'
        +'<div class="summary">'+escH(r.chunk_summary||'')+'</div>'
        +'<div class="meta-row"><span>Chunk '+(r.chunk_index+1)+'</span><span>Turns '+(r.turn_start||0)+'-'+(r.turn_end||0)+'</span>'
        +'<span><span class="score-bar" style="width:'+pct+'px;background:'+barColor+'"></span></span></div></div>';
    });
    resultsDiv.innerHTML=html;
  }catch(e){resultsDiv.innerHTML='<div class="msg err">Search error: '+e.message+'</div>'}
}

async function loadSessions(){
  const k=getKey();if(!k)return;
  const q=document.getElementById('sesQ').value.trim();
  const project=document.getElementById('sesProject').value;
  const status=document.getElementById('sesStatus').value;
  const from=document.getElementById('sesFrom').value;
  const to=document.getElementById('sesTo').value;
  const resultsDiv=document.getElementById('sesResults');
  resultsDiv.innerHTML='<div class="loading">Loading...</div>';
  try{
    let url=BASE+'/api/sessions/search?limit=50';
    if(q)url+='&q='+encodeURIComponent(q);
    if(project)url+='&project='+encodeURIComponent(project);
    if(status)url+='&status='+encodeURIComponent(status);
    if(from)url+='&from='+encodeURIComponent(from);
    if(to)url+='&to='+encodeURIComponent(to);
    const r=await fetch(url,{headers:h(k)});
    const d=await r.json();
    let sessions=d.sessions||[];
    if(!sessions.length){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128203;</div><p>No sessions found.</p></div>';return}
    let html='<div style="color:#565F89;font-size:12px;margin:8px 0">'+sessions.length+' sessions</div>';
    let lastDate='';
    sessions.forEach(s=>{
      const d=(s.created_at||'').substring(0,10);
      if(d!==lastDate){html+='<div class="ses-date-group">'+d+'</div>';lastDate=d}
      const statusClass=s.status==='완료'?'done':s.status==='보류'?'blocked':'progress';
      html+='<div class="card" onclick="openSession(&quot;'+s.session_id+'&quot;)">'
        +'<h3><span>'+(s.project||s.title||s.session_id.substring(0,8))+'</span>'
        +'<span><span class="status-badge '+statusClass+'">'+(s.status||'진행중')+'</span></span></h3>'
        +'<div class="summary">'+escH(s.summary||'')+'</div>'
        +'<div class="meta-row"><span>'+(s.total_turns||0)+' turns</span><span>'+(s.total_chunks||0)+' chunks</span></div></div>';
    });
    resultsDiv.innerHTML=html;
  }catch(e){resultsDiv.innerHTML='<div class="msg err">Error: '+e.message+'</div>'}
}

async function openSession(sid){
  const k=getKey();
  const modal=document.getElementById('sessionModal');
  const body=document.getElementById('smBody');
  const title=document.getElementById('smTitle');
  const meta=document.getElementById('smMeta');
  modal.classList.add('active');
  body.innerHTML='<div class="loading">Loading...</div>';
  try{
    const r=await fetch(BASE+'/api/session/'+sid,{headers:h(k)});
    const d=await r.json();
    title.textContent=d.project||d.title||sid.substring(0,12);
    meta.innerHTML='<span>'+d.status+'</span><span>'+(d.total_turns||0)+' turns</span><span>'+(d.created_at||'').substring(0,10)+'</span>';
    const chunks=(d.chunks||[]).sort((a,b)=>(a.chunk_index||0)-(b.chunk_index||0));
    if(!chunks.length){body.innerHTML='<div class="empty-state"><p>No chunks</p></div>';return}
    let html='';
    chunks.forEach((c,i)=>{
      const hasRaw=c.raw_content&&c.raw_content.length>0;
      html+='<div class="chunk-card" data-cidx="'+i+'">'
        +'<div class="chunk-label">Chunk '+(c.chunk_index+1)+' (turns '+(c.turn_start||0)+'-'+(c.turn_end||0)+')'+(hasRaw?' <span style="color:#9ECE6A;font-size:10px">[RAW '+c.raw_content.length+' chars]</span>':'')+'</div>'
        +'<div class="chunk-summary">'+escH(c.chunk_summary||'')+'</div>'
        +'</div>';
    });
    body.innerHTML=html;
    body.querySelectorAll('.chunk-card').forEach((el,i)=>{
      el.onclick=function(){
        const c=chunks[i];
        const text=c.raw_content||c.chunk_summary||'';
        navigator.clipboard.writeText(text).then(()=>{
          el.style.borderLeftColor='#9ECE6A';
          const label=el.querySelector('.chunk-label');
          if(label)label.textContent+=' (copied!)';
          setTimeout(()=>{el.style.borderLeftColor='#E0AF68'},1500);
        });
      };
    });
  }catch(e){body.innerHTML='<div class="msg err">'+e.message+'</div>'}
}

function closeSessionModal(){document.getElementById('sessionModal').classList.remove('active')}

function closeModal(){document.getElementById('noteModal').classList.remove('active')}

function escH(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function copyContent(){
  const body=document.getElementById('modalBody');
  navigator.clipboard.writeText(body.innerText).then(()=>{
    const btn=document.querySelector('.modal-actions .btn-secondary');
    if(btn){btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy',1500)}
  });
}

let searchHits=[],searchIdx=-1;
function highlightSearch(){
  var q=document.getElementById('noteSearchInput').value.trim();
  var body=document.getElementById('modalBody');
  var counter=document.getElementById('noteSearchCount');
  var pre=body.querySelector('pre');
  if(!pre)return;
  var raw=pre.textContent||'';
  if(!q){pre.innerHTML=escH(raw);counter.textContent='';searchHits=[];return}
  var parts=raw.split(new RegExp('('+q+')','i'));
  var idx=0;searchHits=[];
  var html=parts.map(function(p,pi){if(pi%2===1){searchHits.push(idx);idx++;return'<mark class="hl" id="hl'+idx+'">'+escH(p)+'</mark>'}return escH(p)}).join('');
  pre.innerHTML=html;
  counter.textContent=searchHits.length?searchHits.length+' found':'0';
  searchIdx=-1;if(searchHits.length)jumpSearch(1);
}

function jumpSearch(dir){
  if(!searchHits.length)return;
  searchIdx+=dir;
  if(searchIdx>=searchHits.length)searchIdx=0;
  if(searchIdx<0)searchIdx=searchHits.length-1;
  document.querySelectorAll('mark.hl').forEach(m=>m.classList.remove('current'));
  const el=document.getElementById('hl'+(searchIdx+1));
  if(el){el.classList.add('current');el.scrollIntoView({block:'center'})}
  document.getElementById('noteSearchCount').textContent=(searchIdx+1)+'/'+searchHits.length;
}

(function init(){
  const saved=localStorage.getItem('ck_api_key');
  if(saved){keyInput.value=saved;keyStatusEl.textContent='Key loaded';keyStatusEl.className='key-status saved';loadProjects();loadSessions()}
})();
</script>
</body>
</html>`;
