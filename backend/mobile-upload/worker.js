export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Content-Type, Authorization" }
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.API_KEY}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    async function getUniqueName(db, fileName, content) {
      const existing = await db.prepare("SELECT file_name, content FROM notes WHERE file_name = ?").bind(fileName).first();
      if (!existing) return fileName;
      if (existing.content && existing.content.trim() === content.trim()) return fileName;
      const base = fileName.replace(/\.md$/, "");
      const rows = await db.prepare("SELECT file_name FROM notes WHERE file_name LIKE ?").bind(base + "%").all();
      const names = new Set((rows.results || []).map(r => r.file_name));
      let n = 1; let newName;
      do { newName = base + "-" + n + ".md"; n++; } while (names.has(newName));
      return newName;
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      try {
        let { file_name, title, date, tags, frontmatter, content, folder } = await request.json();
        if (!file_name || !content) return Response.json({ error: "file_name과 content 필수" }, { status: 400, headers: corsHeaders });
        if (folder) file_name = folder + "/" + file_name;
        const uniqueName = await getUniqueName(env.DB, file_name, content);
        const finalTitle = title || uniqueName.replace(/\.md$/, "").split("/").pop();
        await env.DB.prepare(
          "INSERT INTO notes (file_name, title, date, tags, frontmatter, content, synced_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(file_name) DO UPDATE SET title=excluded.title, date=excluded.date, tags=excluded.tags, frontmatter=excluded.frontmatter, content=excluded.content, synced_at=datetime('now')"
        ).bind(uniqueName, finalTitle, date || "", tags || "", frontmatter || "", content).run();
        const renamed = uniqueName !== file_name;
        return Response.json({ ok: true, file_name: uniqueName, renamed, original: renamed ? file_name : undefined }, { headers: corsHeaders });
      } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: corsHeaders }); }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const results = await env.DB.prepare(
        "SELECT file_name, title, date, tags, substr(content, 1, 200) as preview FROM notes WHERE content LIKE ? OR title LIKE ? ORDER BY synced_at DESC LIMIT 30"
      ).bind(`%${q}%`, `%${q}%`).all();
      return Response.json(results, { headers: corsHeaders });
    }

    if (url.pathname === "/api/notes" && request.method === "GET") {
      const results = await env.DB.prepare(
        "SELECT file_name, title, date, tags, synced_at FROM notes ORDER BY synced_at DESC LIMIT 50"
      ).all();
      return Response.json(results, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/note/") && request.method === "GET") {
      const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
      const result = await env.DB.prepare("SELECT * FROM notes WHERE file_name = ?").bind(fname).first();
      if (!result) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
      return Response.json(result, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/note/") && request.method === "DELETE") {
      const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
      await env.DB.prepare("DELETE FROM notes WHERE file_name = ?").bind(fname).run();
      return Response.json({ ok: true, deleted: fname }, { headers: corsHeaders });
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  }
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ODS Mobile</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#eee;padding:16px;max-width:600px;margin:0 auto}
  h1{font-size:1.4em;margin-bottom:12px;color:#7c83ff}
  .key-area{display:flex;gap:6px;align-items:center;margin-bottom:12px}
  .key-area input{flex:1;padding:10px;border:1px solid #333;border-radius:8px;background:#16213e;color:#eee;font-size:12px}
  .key-area button{width:auto;padding:10px 14px;font-size:12px;margin:0;white-space:nowrap}
  .key-status{font-size:11px;text-align:right;margin:-8px 0 10px;color:#666}
  .key-status.saved{color:#95d5b2}
  .tab-bar{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}
  .tab{flex:1;padding:10px;text-align:center;background:#16213e;border-radius:8px;cursor:pointer;font-size:13px;min-width:70px}
  .tab.active{background:#7c83ff;color:#fff}
  .section{display:none}.section.active{display:block}
  input,textarea{width:100%;padding:10px;margin:6px 0;border:1px solid #333;border-radius:8px;background:#16213e;color:#eee;font-size:14px}
  textarea{height:150px;font-family:monospace}
  button{width:100%;padding:12px;margin:8px 0;border:none;border-radius:8px;background:#7c83ff;color:#fff;font-size:16px;cursor:pointer}
  button:active{background:#5a62d9}
  .btn-sm{font-size:13px;padding:8px;background:#16213e;border:1px solid #7c83ff;color:#7c83ff}
  .card{background:#16213e;padding:12px;margin:8px 0;border-radius:8px;cursor:pointer;transition:background .2s}
  .card:hover{background:#1e2a4a}
  .card h3{color:#7c83ff;font-size:1em}.card p{color:#aaa;font-size:.85em;margin-top:4px}
  .msg{padding:10px;margin:8px 0;border-radius:8px;text-align:center}
  .msg.ok{background:#1b4332;color:#95d5b2}.msg.err{background:#3d0000;color:#ff6b6b}
  .dropzone{border:2px dashed #7c83ff;border-radius:12px;padding:30px;text-align:center;color:#7c83ff;margin:10px 0;cursor:pointer}
  .dropzone:hover,.dropzone.dragover{background:#16213e}
  .dropzone input{display:none}
  .file-list{margin:10px 0;max-height:300px;overflow-y:auto}
  .file-item{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#16213e;border-radius:6px;margin:4px 0;font-size:13px}
  .file-item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .file-item .status{margin-left:8px;white-space:nowrap}
  .file-item .renamed{color:#ffd166;font-size:11px;display:block}
  .progress{width:100%;height:6px;background:#16213e;border-radius:3px;margin:8px 0;overflow:hidden}
  .progress-bar{height:100%;background:#7c83ff;width:0%;transition:width .3s;border-radius:3px}
  .count{text-align:center;color:#aaa;font-size:13px;margin:8px 0}
  .folder-input{display:flex;gap:6px;align-items:center}
  .folder-input input{flex:1}.folder-input label{font-size:12px;color:#aaa;white-space:nowrap}

  /* 모달 스타일 */
  .modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:1000;justify-content:center;align-items:flex-start;padding:20px;overflow-y:auto}
  .modal-overlay.active{display:flex}
  .modal{background:#16213e;border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;margin:auto}
  .modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #333;flex-shrink:0}
  .modal-header h2{font-size:1.1em;color:#7c83ff;flex:1;margin-right:10px;word-break:break-word}
  .modal-close{background:#333;border:none;color:#eee;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
  .modal-close:hover{background:#555}
  .modal-meta{padding:12px 16px;border-bottom:1px solid #333;font-size:12px;color:#888;flex-shrink:0}
  .modal-meta span{margin-right:12px}
  .modal-meta .tag{background:#7c83ff33;color:#7c83ff;padding:2px 8px;border-radius:4px;font-size:11px}
  .modal-body{padding:16px;overflow-y:auto;flex:1}
  .modal-body pre{white-space:pre-wrap;word-break:break-word;font-family:-apple-system,monospace;font-size:14px;line-height:1.7;color:#ddd}
  .modal-actions{padding:12px 16px;border-top:1px solid #333;display:flex;gap:8px;flex-shrink:0}
  .modal-actions button{flex:1;padding:10px;font-size:13px;margin:0}
  .btn-danger{background:#ff6b6b}
  .btn-danger:active{background:#cc5555}
  .modal-header-right{display:flex;align-items:center;gap:4px}
  .btn-more{background:none;border:none;font-size:1.4rem;cursor:pointer;padding:4px 10px;border-radius:6px;color:#aaa}
  .btn-more:hover{background:#333}
  .more-menu-wrap{position:relative}
  .more-menu{display:none;position:absolute;right:0;top:110%;background:#2a2a2a;border:1px solid #444;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:100;min-width:100px;overflow:hidden}
  .more-menu.show{display:block}
  .more-menu button{display:block;width:100%;padding:12px 16px;border:none;background:none;text-align:left;font-size:.95rem;cursor:pointer;white-space:nowrap;color:#ff6b6b}
  .more-menu button:hover{background:#333}

  .btn-secondary{background:#333;color:#aaa}
  .loading{text-align:center;padding:40px;color:#888}
  .modal-search{display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #333;flex-shrink:0}
  .modal-search input{flex:1;padding:8px;border:1px solid #333;border-radius:6px;background:#1a1a2e;color:#eee;font-size:13px}
  .modal-search-btn{width:32px;height:32px;border:1px solid #333;border-radius:6px;background:#1a1a2e;color:#eee;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0}
  .modal-search-btn:active{background:#333}
  #noteSearchCount{font-size:11px;color:#888;white-space:nowrap;min-width:40px;text-align:center}
  mark.hl{background:#7c83ff55;color:#fff;border-radius:2px;padding:0 1px}
  mark.hl.current{background:#ffd166;color:#000}

/* 더보기 메뉴 */

</style>
</head>
<body>
<h1>ODS Mobile</h1>

<div class="key-area">
  <input id="apiKey" type="password" placeholder="API Key" />
  <button class="btn-sm" onclick="toggleKey()">보기</button>
  <button class="btn-sm" onclick="saveKey()">저장</button>
</div>
<div class="key-status" id="keyStatus"></div>

<div class="tab-bar">
  <div class="tab active" onclick="showTab('upload',this)">파일 업로드</div>
  <div class="tab" onclick="showTab('paste',this)">붙여넣기</div>
  <div class="tab" onclick="showTab('search',this)">검색</div>
  <div class="tab" onclick="showTab('list',this)">목록</div>
</div>

<div id="upload" class="section active">
  <div class="folder-input"><label>폴더:</label><input id="folderName" placeholder="예: genspark (비우면 루트)" /></div>
  <div class="dropzone" id="dropzone" onclick="document.getElementById('fileInput').click()">
    <input type="file" id="fileInput" multiple accept=".md,.txt,.markdown" />
    여기를 탭하거나 파일을 드래그하세요
  </div>
  <div class="file-list" id="fileList"></div>
  <div class="progress" id="progressWrap" style="display:none"><div class="progress-bar" id="progressBar"></div></div>
  <div class="count" id="uploadCount"></div>
  <button onclick="uploadFiles()" id="uploadBtn" style="display:none">D1에 저장</button>
  <div id="uploadMsg"></div>
</div>

<div id="paste" class="section">
  <input id="pFileName" placeholder="파일명 (예: 메모.md)" />
  <input id="pTitle" placeholder="제목" />
  <input id="pTags" placeholder="태그" />
  <textarea id="pContent" placeholder="내용 붙여넣기..."></textarea>
  <button onclick="pasteUpload()">D1에 저장</button>
  <div id="pasteMsg"></div>
</div>

<div id="search" class="section">
  <input id="searchQ" placeholder="검색어" onkeydown="if(event.key==='Enter')doSearch()" />
  <button onclick="doSearch()">검색</button>
  <div id="searchResults"></div>
</div>

<div id="list" class="section">
  <button onclick="loadList()">최근 노트 불러오기</button>
  <div id="listResults"></div>
</div>

<!-- 노트 상세보기 모달 -->
<div class="modal-overlay" id="noteModal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="modalTitle">...</h2>
      <div class="modal-header-right">
        <div class="more-menu-wrap">
          <button class="btn-more" onclick="toggleMoreMenu(event)" title="더보기">⋮</button>
          <div class="more-menu" id="moreMenu">
            <button onclick="deleteNote();toggleMoreMenu(event)">🗑 삭제</button>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
    </div>
    <div class="modal-meta" id="modalMeta"></div>
    <div class="modal-search">
      <input id="noteSearchInput" placeholder="노트 내 검색..." oninput="highlightSearch()" />
      <span id="noteSearchCount"></span>
      <button class="modal-search-btn" onclick="jumpSearch(-1)">▲</button>
      <button class="modal-search-btn" onclick="jumpSearch(1)">▼</button>
    </div>
    <div class="modal-body" id="modalBody">
      <div class="loading">불러오는 중...</div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="copyContent()">내용 복사</button>
    </div>
  </div>
</div>

<script>
const BASE=location.origin;
let selectedFiles=[];
let currentNoteName="";

const keyInput=document.getElementById('apiKey');
const keyStatusEl=document.getElementById('keyStatus');

(function loadKey(){
  const saved=localStorage.getItem('ods_api_key');
  if(saved){keyInput.value=saved;keyStatusEl.textContent='키 저장됨';keyStatusEl.className='key-status saved';}
})();

function getKey(){return keyInput.value;}

function saveKey(){
  const k=keyInput.value.trim();
  if(!k){keyStatusEl.textContent='키를 입력하세요';keyStatusEl.className='key-status';return;}
  localStorage.setItem('ods_api_key',k);
  keyStatusEl.textContent='키 저장됨';
  keyStatusEl.className='key-status saved';
}

function toggleKey(){
  keyInput.type=keyInput.type==='password'?'text':'password';
}

function showTab(name,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(name).classList.add('active');
}

function parseMd(text,fileName){
  let fm="",title="",date="",tags="",body=text;
  const m=text.match(/^---\\s*\\n([\\s\\S]*?)\\n---\\s*\\n?([\\s\\S]*)/);
  if(m){fm=m[1];body=m[2];fm.split("\\n").forEach(line=>{
    if(line.startsWith("title:"))title=line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g,"");
    if(line.startsWith("date:"))date=line.split(":").slice(1).join(":").trim();
    if(line.startsWith("tags:"))tags=line.split(":").slice(1).join(":").trim();
  });}
  if(!title)title=fileName.replace(/\\.md$/,"");
  if(!date)date=new Date().toISOString().split("T")[0];
  return{title,date,tags,frontmatter:fm,content:body};
}

document.getElementById('fileInput').addEventListener('change',e=>{selectedFiles=Array.from(e.target.files);renderFileList();});
const dz=document.getElementById('dropzone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');selectedFiles=Array.from(e.dataTransfer.files).filter(f=>f.name.endsWith('.md')||f.name.endsWith('.txt'));renderFileList();});

function renderFileList(){
  document.getElementById('fileList').innerHTML=selectedFiles.map((f,i)=>'<div class="file-item" id="fi-'+i+'"><span class="name">'+f.name+'</span><span class="status" id="fs-'+i+'">대기</span></div>').join('');
  document.getElementById('uploadBtn').style.display=selectedFiles.length?'block':'none';
  document.getElementById('uploadCount').textContent=selectedFiles.length+'개 선택';
}

async function uploadFiles(){
  const total=selectedFiles.length;let ok=0,fail=0,renamed=0;
  const folder=document.getElementById('folderName').value.trim();
  document.getElementById('progressWrap').style.display='block';
  for(let i=0;i<total;i++){
    const f=selectedFiles[i];const se=document.getElementById('fs-'+i);const ie=document.getElementById('fi-'+i);se.textContent='...';
    try{const text=await f.text();const p=parseMd(text,f.name);
      const r=await fetch(BASE+'/api/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getKey()},body:JSON.stringify({file_name:f.name,folder:folder,...p})});
      const j=await r.json();
      if(j.ok){if(j.renamed){se.textContent='✅';ie.innerHTML+='<span class="renamed">-> '+j.file_name+'</span>';renamed++;}else{se.textContent='✅';}ok++;}
      else{se.textContent='❌';fail++;}
    }catch(e){se.textContent='❌';fail++;}
    document.getElementById('progressBar').style.width=((i+1)/total*100)+'%';
  }
  let msg='✅ '+ok+'개 성공';if(renamed)msg+=' ('+renamed+'개 이름변경)';if(fail)msg+=' / ❌ '+fail+'개 실패';
  document.getElementById('uploadMsg').innerHTML='<div class="msg ok">'+msg+'</div>';
}

async function pasteUpload(){
  const fn=document.getElementById('pFileName').value||'untitled.md';
  const data={file_name:fn.endsWith('.md')?fn:fn+'.md',title:document.getElementById('pTitle').value,tags:document.getElementById('pTags').value,content:document.getElementById('pContent').value,frontmatter:"",date:new Date().toISOString().split('T')[0]};
  try{const r=await fetch(BASE+'/api/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getKey()},body:JSON.stringify(data)});
    const j=await r.json();let msg=j.ok?'✅ '+j.file_name:'❌ '+j.error;if(j.renamed)msg+=' (이름변경)';
    document.getElementById('pasteMsg').innerHTML='<div class="msg '+(j.ok?'ok':'err')+'">'+msg+'</div>';
  }catch(e){document.getElementById('pasteMsg').innerHTML='<div class="msg err">❌ '+e.message+'</div>';}
}

function escapeHtml(t){
  if(!t)return '';
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function doSearch(){
  const q=document.getElementById('searchQ').value;
  try{const r=await fetch(BASE+'/api/search?q='+encodeURIComponent(q),{headers:{'Authorization':'Bearer '+getKey()}});
    const j=await r.json();const res=j.results||[];
    document.getElementById('searchResults').innerHTML=res.length?res.map(n=>'<div class="card" onclick="openNote(\\''+escapeHtml(n.file_name.replace(/'/g,"\\\\'"))+'\\')"><h3>'+escapeHtml(n.title)+'</h3><p>'+escapeHtml(n.file_name)+'</p><p>'+escapeHtml((n.preview||'').substring(0,100))+'...</p></div>').join(''):'<div class="msg err">결과 없음</div>';
  }catch(e){document.getElementById('searchResults').innerHTML='<div class="msg err">❌ '+e.message+'</div>';}
}

async function loadList(){
  try{const r=await fetch(BASE+'/api/notes',{headers:{'Authorization':'Bearer '+getKey()}});
    const j=await r.json();const res=j.results||[];
    document.getElementById('listResults').innerHTML=res.map(n=>'<div class="card" onclick="openNote(\\''+escapeHtml(n.file_name.replace(/'/g,"\\\\'"))+'\\')"><h3>'+escapeHtml(n.title)+'</h3><p>'+escapeHtml(n.file_name)+' | '+(n.synced_at||'')+'</p></div>').join('');
  }catch(e){document.getElementById('listResults').innerHTML='<div class="msg err">❌ '+e.message+'</div>';}
}

// --- 모달: 노트 상세보기 ---
async function openNote(fileName){
  currentNoteName=fileName;
  const modal=document.getElementById('noteModal');
  const titleEl=document.getElementById('modalTitle');
  const metaEl=document.getElementById('modalMeta');
  const bodyEl=document.getElementById('modalBody');

  titleEl.textContent='불러오는 중...';
  metaEl.innerHTML='';
  bodyEl.innerHTML='<div class="loading">불러오는 중...</div>';
  modal.classList.add('active');
  document.body.style.overflow='hidden';

  try{
    const r=await fetch(BASE+'/api/note/'+encodeURIComponent(fileName),{headers:{'Authorization':'Bearer '+getKey()}});
    if(!r.ok){bodyEl.innerHTML='<div class="msg err">노트를 찾을 수 없습니다</div>';return;}
    const note=await r.json();

    titleEl.textContent=note.title||note.file_name;

    let meta='<span>📁 '+escapeHtml(note.file_name)+'</span>';
    if(note.date)meta+='<span>📅 '+escapeHtml(note.date)+'</span>';
    if(note.synced_at)meta+='<span>🔄 '+escapeHtml(note.synced_at)+'</span>';
    if(note.tags)meta+='<br><span class="tag">'+escapeHtml(note.tags)+'</span>';
    metaEl.innerHTML=meta;

    noteRawContent=note.content||'';
    bodyEl.innerHTML='<pre>'+escapeHtml(noteRawContent)+'</pre>';
    document.getElementById('noteSearchInput').value='';
    document.getElementById('noteSearchCount').textContent='';
  }catch(e){
    bodyEl.innerHTML='<div class="msg err">❌ '+e.message+'</div>';
  }
}

let noteSearchMatches=[];
let noteSearchIdx=-1;
let noteRawContent='';

function highlightSearch(){
  const q=document.getElementById('noteSearchInput').value.trim();
  const body=document.getElementById('modalBody');
  const countEl=document.getElementById('noteSearchCount');
  noteSearchMatches=[];
  noteSearchIdx=-1;

  if(!q||!noteRawContent){
    body.innerHTML='<pre>'+escapeHtml(noteRawContent)+'</pre>';
    countEl.textContent='';
    return;
  }

  const escaped=escapeHtml(noteRawContent);
  const qEsc=q.replace(/[-\/\^*+?.()|[\]{}]/g, '\$&');
  const regex=new RegExp('('+qEsc+')','gi');
  let idx=0;
  const highlighted=escaped.replace(regex,function(m){
    return '<mark class="hl" data-idx="'+idx+++'">'+m+'</mark>';
  });

  body.innerHTML='<pre>'+highlighted+'</pre>';
  noteSearchMatches=body.querySelectorAll('mark.hl');
  countEl.textContent=noteSearchMatches.length?noteSearchMatches.length+'건':'0건';

  if(noteSearchMatches.length>0){
    noteSearchIdx=0;
    noteSearchMatches[0].classList.add('current');
    noteSearchMatches[0].scrollIntoView({block:'center',behavior:'smooth'});
  }
}

function jumpSearch(dir){
  if(!noteSearchMatches.length)return;
  noteSearchMatches[noteSearchIdx]?.classList.remove('current');
  noteSearchIdx=(noteSearchIdx+dir+noteSearchMatches.length)%noteSearchMatches.length;
  noteSearchMatches[noteSearchIdx].classList.add('current');
  noteSearchMatches[noteSearchIdx].scrollIntoView({block:'center',behavior:'smooth'});
  document.getElementById('noteSearchCount').textContent=(noteSearchIdx+1)+'/'+noteSearchMatches.length;
}

function closeModal(){
  document.getElementById('noteModal').classList.remove('active');
  document.body.style.overflow='';
  currentNoteName='';
  noteRawContent='';
  noteSearchMatches=[];
  noteSearchIdx=-1;
}

function copyContent(){
  const pre=document.querySelector('#modalBody pre');
  if(!pre)return;
  navigator.clipboard.writeText(pre.textContent).then(()=>{
    const btn=document.querySelector('.modal-actions .btn-secondary');
    const orig=btn.textContent;btn.textContent='✅ 복사됨';
    setTimeout(()=>btn.textContent=orig,1500);
  });
}

async function deleteNote(){
  if(!currentNoteName)return;
  if(!confirm('정말 삭제하시겠습니까?\\n'+currentNoteName))return;
  try{
    const r=await fetch(BASE+'/api/note/'+encodeURIComponent(currentNoteName),{method:'DELETE',headers:{'Authorization':'Bearer '+getKey()}});
    const j=await r.json();
    if(j.ok){closeModal();loadList();doSearch();}
    else{alert('삭제 실패: '+(j.error||''));}
  }catch(e){alert('삭제 실패: '+e.message);}
}

// ESC 키로 모달 닫기
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
</script>
</body>
</html>`;
