---
tags:
  - aikeep24
  - technical
  - architecture
  - chrome-extension
  - cloudflare
aliases:
  - AIKeep24 기술문서
  - CK 아키텍처
created: 2026-04-03
updated: 2026-04-04
version: v0.9.5
---

# AIKeep24 기술 문서

> v0.9.5 | 분석 기준: dev 브랜치 최신 커밋 (2026-04-04)

## 1. 시스템 아키텍처

### 1.1 전체 데이터 흐름

브라우저 DOM에서 MutationObserver(observer.js)가 변경을 감지하면, extractTurns()(dom-parser.js)가 플랫폼별 셀렉터(Genspark/ChatGPT/Claude)로 턴을 추출한다. computeTurnHash()(dom-parser.js)가 마지막 턴 앞 100자의 FNV-1a 해시를 chrome.storage.local의 이전 해시와 비교하여 변경 여부를 판단한다.

변경이 감지되면 summarizeAll()(summarizer.js)이 20턴 단위로 청킹하고(마지막 청크가 5턴 이하면 이전 청크에 병합), 8000자 초과 시 절단한다. 각 청크는 callOllama()(ollama.js)를 통해 content script -> chrome.runtime.sendMessage -> background.js -> fetch(localhost:11434/api/generate) -> Ollama 경로로 LLM 요약된다. 직렬 큐로 한 번에 1개만 처리하며 탭별 대기열을 유지한다.

LLM 응답은 parseJson() + parseCheckpoint()(ollama.js)로 파싱되고, 각 청크 완료 즉시 saveChunk()(api.js -> background.js -> Worker)로 D1 저장 + Vectorize 임베딩된다. chrome.storage에 진행 턴 수가 기록되어 중단 시 이어서 처리할 수 있다. 모든 청크 완료 후 saveToWorker()로 세션 메타데이터가 통합 저장되며, topics/decisions/tools 등 배열이 중복 제거되어 병합된다.

최종 데이터는 Cloudflare D1(ext_sessions/ext_chunks 테이블)과 Cloudflare Vectorize(bge-m3 1024d 벡터 인덱스, chunk_summary+checkpoint 임베딩)에 저장된다.

### 1.2 모듈 의존 관계

manifest.json content_scripts 로드 순서: config.js -> dom-parser.js -> ollama.js -> api.js -> summarizer.js -> ui.js -> observer.js -> content.js

각 모듈의 역할:
- **config.js**: CK 네임스페이스 정의, CONFIG 객체, 유틸(hashText, tryParseJSON), chrome.storage에서 사용자 설정 로드(loadSettings)
- **dom-parser.js**: CK.CONFIG.PLATFORMS 참조하여 멀티플랫폼 DOM 파싱
- **ollama.js**: CK.CONFIG(MODEL, TEMPERATURE, NUM_CTX, NUM_PREDICT, THINKING) 참조하여 LLM 호출 + 파싱
- **api.js**: CK.CONFIG.WORKER_URL 참조, background.js에 메시지 전송. saveChunk, saveToWorker, saveSnap, fetchSession 등
- **summarizer.js**: extractTurns, formatChunk, callOllama, parseJson, parseCheckpoint, saveChunk, saveToWorker, computeTurnHash 호출. 요약 엔진 + INJ 빌더
- **ui.js**: summarizeAll, fetchSession*, vectorSearch, buildContext, saveSnap 호출. UI + BRW 패널 + SNAP 버튼
- **observer.js**: extractTurns, computeTurnHash, summarizeAll 호출. 변경 감지 + 오토런
- **content.js**: loadSettings -> init() -> observer, ensureUI, checkForNewTurns. 진입점
- **background.js**: 독립 service worker. content script와 chrome.runtime.onMessage로 통신. Ollama 큐, save_chunk, save_session, save_snap 핸들러

## 2. 확장 프로그램 (Chrome Extension)

### 2.1 플랫폼 지원

| 플랫폼 | 호스트 매칭 | 턴 셀렉터 | 역할 감지 방식 |
|--------|-----------|----------|--------------|
| Genspark | genspark.ai | .conversation-item-desc | classList (user 포함 여부) |
| ChatGPT | chatgpt.com | [data-message-author-role] | attribute 값 직접 읽기 |
| Claude | claude.ai | 없음 (부모 구조 탐색) | [data-testid=user-message] 존재 여부 |

플랫폼 추가 시 config.js의 CK.CONFIG.PLATFORMS에 항목 추가.

### 2.2 변경 감지 메커니즘

**해시 기반 감지** (dom-parser.js:computeTurnHash): 마지막 턴의 텍스트 앞 100자를 FNV-1a 해시하여 ck_last_hash_{chatId}에 저장. 이전 해시와 동일하면 변경 없음으로 판단하여 불필요한 LLM 호출 방지.

**DOM 압축 대응** (summarizer.js): Genspark은 긴 대화에서 오래된 턴을 DOM에서 제거(압축)함. lastTurn > allTurns.length이면 DOM 압축 상태로 판단하고 lastTurn = allTurns.length로 보정. 사용자에게 스크롤 올려서 압축 해제 후 RUN 안내 필요.

**버스트 감지** (observer.js:checkForNewTurns): 한 번에 +50턴 이상 감지되면 페이지 로드/복원으로 판단하여 자동 실행 차단. 수동 RUN만 허용.

### 2.3 자동 실행 (AutoRun)

트리거 조건: 마지막 새 턴 감지 후 5분(300,000ms) 동안 추가 턴 없음. observer.js:scheduleAutoRun -> setTimeout -> 해시 비교 -> summarizeAll().

안전장치: CK.enabled === false이면 차단, CK.isRunning === true이면 차단, CK.autoRunTriggered === true이면 차단(동일 세션 중복 방지), 해시 동일하면 차단.

### 2.4 청킹 알고리즘

입력은 newTurns(마지막 저장 이후 새 턴 배열)이며, TURNS_PER_CHUNK = 20(기본값, 옵션에서 변경 가능)이다. 20턴씩 slice하여 chunks 배열을 생성하고, 마지막 청크가 5턴 이하이면 이전 청크에 병합한다. formatChunk()으로 [USER]\n텍스트\n\n---\n\n[ASSISTANT]\n텍스트 형식으로 변환하고, 8000자(MAX_TEXT_LEN, 옵션에서 변경 가능) 초과 시 절단한다.

### 2.5 LLM 프롬프트 설계

summarizer.js:buildPrompt가 생성하는 프롬프트는 [SYSTEM] 형식 지시(JSON + checkpoint만 출력), [FORMAT] JSON 스키마(summary, topics, decisions, unresolved, next_steps, tools, project, files_modified) + checkpoint 형식, [RULES] 반할루시네이션 규칙(원문에 실제로 등장하는 내용만 요약) + project는 KNOWN_PROJECTS에서 매칭 + files_modified는 개발 대화가 아니면 빈 배열, [CONTENT] 청크 텍스트 순서로 구성된다.

**Thinking 모드 제어**: ollama.js에서 CK.CONFIG.THINKING === false이면 payload에 think: false를 추가. Qwen3 등 thinking 모델의 내부 추론을 비활성화하여 요약 속도 2~3배 향상.

### 2.6 JSON 파싱 전략

ollama.js:parseJson은 3단계 폴백을 사용한다. 1단계: json 코드블록 내부 추출 -> JSON.parse. 2단계: 첫 { ~ 마지막 } 범위 추출 -> JSON.parse. 3단계: 모든 {...} 블록을 개별 파싱 -> 키 병합(2개 이상 키일 때만 채택).

ollama.js:parseCheckpoint도 3단계 폴백이다. 1단계: checkpoint 코드블록 내부 추출. 2단계: Checkpoint(대소문자 무관) 코드블록. 3단계: # 맥락, # Context, checkpoint 마커 검색 -> 이후 600자.

### 2.7 INJ (컨텍스트 주입)

**SNAP 우선**: D1의 checkpoint에 SNAP 원문(최근 10턴)이 저장되어 있고 100자 이상이면 LLM 요약 대신 SNAP 원문을 최우선으로 주입한다. (v0.9.5에서 SNAP 클릭 시 클립보드 복사와 동시에 D1 checkpoint에 저장하도록 개선)

**Light 모드** (짧은 클릭): 현재 세션의 checkpoint + decisions. **Full 모드** (길게 누르기): 같은 프로젝트의 최근 5개 세션 통합.

summarizer.js:buildContext 출력 형식: [CONTEXT INJECTION] Project: {name} | Status: {status} -> [RECENT PROGRESS] 청크별 요약 -> [DECISIONS] -> [UNRESOLVED] -> [TOOLS] -> 위 맥락을 참고하여 이어서 작업해주세요.

summarizer.js:buildProjectContext는 최신 세션부터 역순으로 4000자까지 채운다.

### 2.8 SNAP (v0.9.5)

SNAP 버튼 클릭 시 마지막 10턴의 원문을 [SNAP CONTEXT - Recent N turns] 형식으로 클립보드에 복사한다. 동시에 CK.saveSnap()을 통해 D1의 해당 세션 checkpoint 필드에 저장한다. 이를 통해 다음 세션에서 INJ 시 LLM 요약이 아닌 실제 최근 대화 원문이 주입되어 맥락 정확도가 크게 향상된다.

SNAP -> D1 저장 경로: ui.js(btnSnap.onclick) -> CK.saveSnap(api.js) -> chrome.runtime.sendMessage({type: save_snap}) -> background.js -> fetch(/api/session/snap) -> Worker(handleSaveSnap) -> D1 UPDATE ext_sessions SET checkpoint.

### 2.9 Ollama 요청 큐

background.js의 직렬 큐 구현: ollamaQueue 배열(FIFO)과 ollamaRunning boolean으로 동작한다. content script -> sendMessage({type:ollama, payload}) -> 큐에 push. processOllamaQueue()가 큐에서 shift -> ollamaFetchWithRetry() 호출. 완료 시 callback 호출 -> ollamaRunning = false -> 다음 항목 처리. 실패 시 1회 자동 재시도(retriesLeft=1). AbortController로 120초 타임아웃.

### 2.10 옵션 페이지

options.html + options.js로 chrome.storage.local에 설정을 저장한다:

| 키 | 기본값 | 설명 |
|----|-------|------|
| ck_ollama_model | exaone3.5:7.8b | Ollama 모델명 |
| ck_ollama_url | http://localhost:11434 | Ollama 서버 URL |
| ck_num_ctx | 6144 | 컨텍스트 크기 |
| ck_num_predict | 384 | 최대 생성 토큰 |
| ck_temperature | 0.3 | 생성 온도 |
| ck_worker_url | https://aikeep24-web... | Worker URL |
| ck_api_key | (빈 문자열) | Bearer 인증 키 |
| ck_turns_per_chunk | 20 | 청크당 턴 수 |
| ck_max_text_len | 8000 | 청크 최대 텍스트 길이 |
| ck_thinking | false | Thinking 모드 (true/false) |

설정 변경 시 config.js:loadSettings가 content script 초기화 시 로드하고, background.js:storage.onChanged가 service worker에 실시간 반영한다.

## 3. 백엔드 (Cloudflare Worker)

### 3.1 모듈 구조

backend/web/ 아래에 worker.js(라우터 44줄), middleware.js(CORS+인증 30줄), handlers/notes.js(노트 CRUD 65줄), handlers/sessions.js(세션/청크 저장 128줄), handlers/search.js(검색 109줄), views/dashboard.js(웹 대시보드 353줄)로 구성된다.

### 3.2 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | / | 웹 대시보드 HTML |
| POST | /api/upload | 노트 업로드 |
| GET | /api/search?q= | 노트 텍스트 검색 |
| GET | /api/notes | 전체 노트 목록 |
| GET | /api/noteid/{id} | ID로 노트 조회 |
| GET | /api/note/{fname} | 파일명으로 노트 조회 |
| DELETE | /api/note/{fname} | 노트 삭제 |
| GET | /api/vector-search?q=&limit=&project=&from=&to= | 시맨틱 벡터 검색 |
| GET | /api/vector-test?q= | 임베딩 테스트 |
| POST | /api/session/chunk | 청크 단위 저장 + 벡터화 |
| POST | /api/session | 세션 통합 저장 |
| GET | /api/sessions?limit= | 세션 목록 |
| GET | /api/session/{sid} | 세션 상세 + 청크 |
| POST | /api/session/snap | 스냅샷 저장 |
| GET | /api/sessions/search?q=&project=&status=&from=&to=&url= | 세션 조건 검색 |
| GET | /api/sessions/projects | 프로젝트별 세션 수 |
| GET | /api/sessions/latest?project= | 프로젝트 최신 세션 |

### 3.3 인증

모든 API 엔드포인트(/ 제외)에 Bearer 토큰 인증 적용. wrangler secret put API_KEY로 설정. middleware.js:checkAuth가 Authorization: Bearer {API_KEY}를 검증한다.

### 3.4 벡터화 파이프라인

sessions.js:vectorizeChunk에서 chunk_summary + chunk_checkpoint를 결합하고, 10자 이하이면 임베딩을 생략한다. Workers AI(@cf/baai/bge-m3)를 호출하여 1024차원 벡터를 얻고, Vectorize.upsert({id: chunkId, values: vector, metadata: {session_id, chunk_index, project}})로 저장한다.

검색 시(search.js:handleVectorSearch) 쿼리 텍스트를 bge-m3로 임베딩하고, Vectorize.query(vector, topK: limit*3)로 후보를 가져온 뒤, D1에서 chunk 메타데이터를 조회하고 project/date 필터를 적용하여 limit개까지 반환한다.

### 3.5 세션 저장 로직 (v0.9.5 수정)

handleSaveSession에서 클라이언트가 보낸 session_id(chatId)를 우선 조회한다. 없으면 URL로 검색한다. 기존에는 URL로만 검색하여 saveChunk가 만든 세션과 saveToWorker가 만든 세션이 분리되어 같은 URL에 중복 세션이 생성되는 문제가 있었다. v0.9.5에서 summarizer.js의 saveToWorker payload에 session_id: chatId를 추가하고, Worker에서 clientSessionId를 우선 매칭하도록 수정하여 해결.

새 세션 INSERT 시에도 clientSessionId가 있으면 이를 사용하고, 없을 때만 crypto.randomUUID()를 생성한다. 청크 ID도 clientSessionId + -chunk- + index 형식으로 일관되게 생성하여 ON CONFLICT DO UPDATE가 정상 동작한다.

## 4. 데이터베이스 스키마

### 4.1 ext_sessions

| 컬럼 | 타입 | 설명 |
|------|------|------|
| session_id | TEXT PK | UUID(확장) 또는 URL path 기반 chatId |
| title | TEXT | 대화 제목 |
| source | TEXT | genspark, chatgpt, claude |
| url | TEXT | 원본 대화 URL |
| summary | TEXT | 통합 요약 |
| topics | TEXT | JSON 배열 |
| key_decisions | TEXT | JSON 배열 |
| tools | TEXT | JSON 배열 (tech stack) |
| tech_stack | TEXT | JSON 배열 (레거시, tools와 중복) |
| project | TEXT | 프로젝트명 |
| status | TEXT | 진행중, 완료, 보류, 검토중 |
| checkpoint | TEXT | 다음 세션용 맥락 브리핑 또는 SNAP 원문 |
| total_chunks | INTEGER | 청크 수 |
| total_turns | INTEGER | 총 턴 수 |
| note_id | INTEGER | notes 테이블 FK (백필 시) |
| created_at | TIMESTAMP | 생성일 |
| synced_at | TIMESTAMP | 동기화일 |
| updated_at | TIMESTAMP | 수정일 |

### 4.2 ext_chunks

| 컬럼 | 타입 | 설명 |
|------|------|------|
| chunk_id | TEXT PK | {session_id}-chunk-{index} 또는 UUID |
| session_id | TEXT | FK -> ext_sessions |
| chunk_index | INTEGER | 청크 순번 |
| turn_start | INTEGER | 시작 턴 번호 |
| turn_end | INTEGER | 끝 턴 번호 |
| chunk_summary | TEXT | 청크 요약 |
| chunk_checkpoint | TEXT | 청크 체크포인트 |
| chunk_topics | TEXT | JSON 배열 |
| chunk_key_decisions | TEXT | JSON 배열 |
| raw_content | TEXT | 원본 대화 텍스트 |
| project | TEXT | 프로젝트명 |
| created_at | TIMESTAMP | 생성일 |

Vectorize에서 chunk_summary + chunk_checkpoint -> bge-m3 1024d로 임베딩된다.

### 4.3 conversation_sessions / conversation_chunks (백필용)

backfill-summaries.py가 사용하는 별도 테이블. session_id가 INTEGER AUTOINCREMENT. note_id로 notes 테이블과 연결. 확장 프로그램은 이 테이블을 사용하지 않음.

### 4.4 notes

Obsidian에서 sync된 마크다운 노트 저장 테이블. sync-obsidian-to-d1.py가 R2를 경유하여 D1에 업로드.

## 5. Python 스크립트

### 5.1 공통 설정 (scripts/lib/config.py)

.env 파일에서 환경변수 로드. backend/.env -> 프로젝트 루트 .env 순서로 탐색. OLLAMA_URL, OLLAMA_MODEL, WORKER_URL, R2_* 등을 export.

### 5.2 backfill-ext.py

notes 테이블에서 tags LIKE '%genspark%'인 미처리 노트를 가져와 ext_sessions / ext_chunks에 소급 요약 저장. Ollama 확인 -> 기처리 note_id 조회 -> 미처리 노트 순회 -> 턴 분할 -> 청크 분할 -> 청크별 요약(재시도 2회) -> 통합 요약 -> 체크포인트 생성 -> ext_sessions INSERT -> ext_chunks INSERT. UUID 기반 session_id. KNOWN_PROJECTS 프롬프트에 포함.

### 5.3 backfill-summaries.py

동일 로직이지만 conversation_sessions / conversation_chunks에 저장. INTEGER AUTOINCREMENT session_id. ON CONFLICT DO UPDATE 지원(재실행 시 덮어쓰기). notes 테이블에도 요약 결과를 UPDATE.

### 5.4 sync-obsidian-to-d1.py

로컬 Obsidian 볼트의 .md 파일을 R2에 업로드하고 D1 notes 테이블에 메타데이터 저장.

### 5.5 check-db-status.py

D1 테이블 행 수, 최근 세션 목록 등 상태 확인 유틸리티.

## 6. Cloudflare 바인딩

wrangler.toml에서 name = aikeep24-web, main = worker.js, compatibility_date = 2024-01-01로 설정.

D1 바인딩: binding = DB, database_name = obsidian-db. Vectorize 바인딩: binding = VECTORIZE, index_name = aikeep24-vectors (1024d, cosine). AI 바인딩: binding = AI (@cf/baai/bge-m3).

## 7. 알려진 제약 사항 및 기술 부채

### 7.1 아키텍처 제약

**Manifest V3 제한**: content_scripts에 ES modules 사용 불가. IIFE + window.CK 네임스페이스로 모듈 간 통신. manifest.json의 js 배열 순서가 의존성 순서.

**Ollama 직렬 처리**: 동시에 1개 요청만 처리. 멀티탭 사용 시 큐 대기 발생. Apple Silicon 16GB 기준 7~8B 모델 1개만 로드 가능.

**D1 읽기 제한**: Cloudflare D1 무료 플랜 5M rows/day read, 100K rows/day write. 대규모 사용 시 제한에 걸릴 수 있음.

### 7.2 기술 부채

**SQL 인젝션 위험 (Python 스크립트)**: esc() 함수가 작은따옴표만 이스케이프. wrangler CLI가 parameterized query를 지원하지 않아 문자열 연결 방식 사용. Worker 코드는 D1 SDK의 .bind() 사용하여 안전.

**중복 테이블**: ext_sessions/ext_chunks(확장용) vs conversation_sessions/conversation_chunks(백필용). 스키마가 미세하게 다름(UUID vs AUTOINCREMENT, 필드명 차이).

**tech_stack vs tools 중복**: ext_sessions에 두 필드 모두 존재. 확장 프로그램은 tools를 사용하고, 백필 스크립트는 tech_stack을 사용.

**KNOWN_PROJECTS 하드코딩**: config.js와 backfill-ext.py 양쪽에 하드코딩. 프로젝트 추가 시 두 곳 모두 수정 필요.

### 7.3 DOM 의존성

각 플랫폼의 DOM 구조 변경 시 셀렉터 업데이트 필요. Genspark(.conversation-item-desc)은 변경 이력 없음. ChatGPT([data-message-author-role])는 비교적 안정적. Claude([data-testid=user-message] + 부모 탐색 10레벨)는 취약.

### 7.4 해결된 이슈 (v0.9.5)

**세션 중복 생성**: saveToWorker가 session_id를 보내지 않아 Worker가 URL로 검색 -> 못 찾거나 race condition으로 같은 URL에 세션 2개 생성 -> fetchLastTurnFromD1(chatId)이 잘못된 턴 수를 반환 -> 재실행 허용. saveToWorker에 session_id: chatId 추가 + Worker에서 clientSessionId 우선 매칭으로 해결. D1 중복 세션 123건 정리.

**SNAP 맥락 누락**: SNAP이 클립보드 복사만 하고 D1에 저장하지 않아 INJ에 반영되지 않음. SNAP 클릭 시 D1 checkpoint에도 저장하도록 개선.

## 8. 배포 및 운영

### 8.1 Worker 배포

cd backend/web && npx wrangler deploy

### 8.2 확장 프로그램 배포

개발: chrome://extensions/ -> Load unpacked -> extension/ 폴더. 업데이트: manifest.json version 변경 -> 확장 새로고침.

### 8.3 Ollama 실행

OLLAMA_ORIGINS='*' ollama serve &

OLLAMA_ORIGINS='*'가 없으면 Chrome 확장에서 HTTP 403 발생. 매번 맥북 재시작 후 실행 필요.

### 8.4 백필 실행

cd /Users/twinssn/Projects/AIKeep24 && python3 scripts/backfill-ext.py (ext 테이블) 또는 python3 scripts/backfill-summaries.py (conversation 테이블)

## 9. 파일별 코드 규모

| 파일 | 줄 수 | 역할 |
|------|------|------|
| extension/config.js | 83 | 설정 + 유틸 + loadSettings |
| extension/dom-parser.js | 120 | 멀티플랫폼 DOM 파싱 |
| extension/ollama.js | 70 | LLM 호출 + 파싱 |
| extension/api.js | 129 | Worker API 클라이언트 + saveSnap |
| extension/summarizer.js | 349 | 요약 엔진 + INJ 빌더 |
| extension/ui.js | 424 | UI + BRW 패널 + SNAP D1 저장 |
| extension/observer.js | 123 | 변경 감지 + 오토런 |
| extension/content.js | 49 | 진입점 |
| extension/background.js | 196 | Service worker + Ollama 큐 + save_snap |
| extension/options.js | 104 | 설정 저장/로드 |
| backend/web/worker.js | 44 | 라우터 |
| backend/web/middleware.js | 30 | CORS + 인증 |
| backend/web/handlers/notes.js | 65 | 노트 CRUD |
| backend/web/handlers/sessions.js | 128 | 세션/청크 저장 |
| backend/web/handlers/search.js | 109 | 검색 |
| backend/web/views/dashboard.js | 353 | 웹 대시보드 |
| scripts/backfill-ext.py | ~280 | 백필 (ext 테이블) |
| scripts/backfill-summaries.py | ~350 | 백필 (conversation 테이블) |
| scripts/lib/config.py | ~40 | 공통 설정 로더 |
| **합계** | **~3,200+** | |
