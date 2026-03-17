# AIKeep24

> **AI 대화의 맥락을 잃지 않도록, 로컬 LLM이 자동으로 요약·태그·저장하는 크롬 확장**
>
> _A Chrome extension that uses a local LLM to automatically summarize, tag, and store AI conversation context_

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/aikorea24/aikeep24/blob/main/LICENSE)
[![Phase](https://img.shields.io/badge/Phase-4%20Complete-brightgreen)](https://github.com/aikorea24/aikeep24)
[![Platform](https://img.shields.io/badge/Platform-Genspark-green)](https://www.genspark.ai/)
[![Search](https://img.shields.io/badge/Search-Vector%20%2B%20Metadata-purple)](https://github.com/aikorea24/aikeep24)

**GitHub**: [https://github.com/aikorea24/aikeep24](https://github.com/aikorea24/aikeep24)
**By**: [AI Korea 24](https://aikorea24.kr/)

---

## 문제 / The Problem

AI와 대화를 많이 하면 두 가지 문제가 생깁니다. 첫째, 새 세션을 열면 이전 대화의 맥락을 자동으로 이어받지 못합니다. 이전 대화 목록은 남아 있지만, 그 내용을 새 세션에서 활용하려면 직접 찾아서 복사해야 합니다. 둘째, 대화가 수십 개 쌓이면 "그때 그 아키텍처 결정이 어느 대화에 있었지?"를 찾기 어렵습니다. 기존 도구들(Pactify, Chat Memo, SaveAIChats)은 원문을 통째로 저장하기만 해서, 검색과 맥락 재활용이 불가능합니다.

AIKeep24는 대화를 요약·태깅하고, 세션 간 맥락을 자동 주입할 수 있는 **영구 기억**입니다.

AI chat platforms keep conversation history, but two problems remain. First, opening a new session doesn't carry over context from previous ones — you have to manually find and copy relevant information. Second, as conversations pile up, finding "which session had that architecture decision?" becomes nearly impossible. Existing tools like Pactify, Chat Memo, and SaveAIChats store raw transcripts without structure, making search and context reuse impractical.

AIKeep24 provides **permanent memory** — summarized, tagged, and searchable across sessions with automatic context injection.

---

## 해결 / The Solution

AIKeep24는 다릅니다. 대화를 실시간으로 감지하고, 로컬에서 돌아가는 LLM(EXAONE 3.5 7.8B)이 구간별로 요약하면서 프로젝트명·토픽·기술스택·핵심결정을 자동 태깅합니다. 저장된 요약은 Cloudflare Vectorize + bge-m3 임베딩을 통해 의미 기반 검색이 가능합니다. 클라우드 API를 쓰지 않으므로 비용이 들지 않고, 대화 내용이 외부 서버로 나가지 않습니다.

AIKeep24 detects conversation turns in real time and uses a local LLM (EXAONE 3.5 7.8B via Ollama) to summarize each segment, automatically tagging project names, topics, tech stack, and key decisions. Saved summaries are searchable via semantic vector search powered by Cloudflare Vectorize + bge-m3 embeddings. No cloud API costs, no data leaving your machine.

---

## Quick Start

    git clone https://github.com/aikorea24/aikeep24.git && cd aikeep24
    OLLAMA_ORIGINS='*' ollama serve & ollama pull exaone3.5:7.8b
    cd backend/web && npx wrangler secret put API_KEY && npx wrangler deploy

Then: chrome://extensions → Developer mode → Load unpacked → extension/ folder. Open Genspark and start chatting.

---

## 스크린샷 / Screenshots

### 크롬 확장 버튼 (RUN / INJ / BRW)

![Buttons](docs/screenshots/aikeep24-buttons.jpg)

### BRW 패널 — 프로젝트 탐색

![BRW Panel](docs/screenshots/brw-panel.jpg)

### AIKeep24-web 벡터 검색

![Web Search](docs/screenshots/aikeep24-web-search.jpg)

### AIKeep24-web 세션 목록

![Web Sessions](docs/screenshots/aikeep24-web-sessions.jpg)

### AIKeep24-web 세션 상세 (청크 목록)

![Session Detail](docs/screenshots/aikeep24-web-session-detail.jpg)

---

## 핵심 기능 / Core Features

### 실시간 대화 감지 + 청크 단위 저장

크롬에서 AI와 대화하면 확장이 턴을 감지하고, 20턴 단위로 청크를 분할하여 로컬 LLM이 각 청크를 요약합니다. **각 청크는 완료 즉시 D1에 저장**되므로 긴 대화 도중에도 데이터가 유실되지 않습니다.

The extension detects conversation turns, splits them into 20-turn chunks, and summarizes each locally. Each chunk is saved to D1 immediately upon completion.

### 벡터 검색 + 메타데이터 하이브리드

Cloudflare Vectorize와 Workers AI(bge-m3, 1024차원, 100개+ 언어)를 사용한 의미 기반 검색입니다. 프로젝트 드롭다운과 기간 필터를 조합할 수 있습니다.

Semantic search powered by Cloudflare Vectorize and Workers AI (bge-m3, 1024 dimensions, 100+ languages). Combine with project dropdown and date range filters.

### 맥락 주입 / Context Injection

**INJ** 버튼으로 축적된 맥락 요약을 입력창에 자동 주입합니다. 짧게 누르면 Light 모드, 길게 누르면 Full 모드.

Press **INJ** to auto-inject context. Short press for Light mode (checkpoint + key decisions); long press for Full mode (all chunk summaries).

### 체크포인트 체이닝

**BRW** 버튼으로 이전 세션의 맥락을 불러와 주입합니다. "어제 어디까지 했지?"가 필요 없어집니다.

Use **BRW** to load previous session context from D1. No more "where did we leave off?"

### 자동 트리거

탭 전환이나 2분 비활동 시 자동 요약. 50턴 미저장 감지 시 즉시 자동 저장.

Auto-triggers on tab switch or 2-minute idle. Immediate auto-save when 50+ unsaved turns detected.

### 원문 보존

청크별 원문 대화도 함께 저장되어 나중에 확인할 수 있습니다.

Raw conversation text is stored alongside summaries.

---

### 버튼 가이드 / Button Guide

크롬 확장은 대화창 하단에 3개 버튼을 표시합니다.

The Chrome extension displays 3 buttons at the bottom of the chat interface.

### RUN — 수동 요약 실행 / Manual Summary

| 동작 / Action | 설명 / Description |
|---|---|
| 클릭 / Click | 미저장 턴을 즉시 요약하고 D1에 저장 / Summarize unsaved turns and save to D1 |
| 텍스트 변화 / Text | RUN → RUN(3): 괄호 안은 청크 수 / Number in parentheses = chunk count |
| 자동 실행 / Auto | 탭 전환, 2분 비활동, 50턴 미저장 시 / Tab switch, 2min idle, 50+ unsaved turns |
| 실행 중 / Running | 비활성화 + "RUNNING..." 표시 / Disabled + "RUNNING..." displayed |

### INJ — 맥락 주입 / Context Injection

| 동작 / Action | 설명 / Description |
|---|---|
| 짧게 클릭 / Short click | Light: 체크포인트 + 핵심결정을 클립보드에 복사 / Copy checkpoint + key decisions to clipboard |
| 길게 누르기 / Long press | Full: 전체 청크 요약 + 체크포인트를 클립보드에 복사 / Copy all chunk summaries + checkpoint to clipboard |
| 사용법 / Usage | 복사된 내용을 대화 입력창에 붙여넣기(Cmd+V) / Paste copied content into chat input (Cmd+V) |

### BRW — 프로젝트 탐색 / Browse Projects

| 동작 / Action | 설명 / Description |
|---|---|
| 클릭 / Click | 현재 대화의 청크 목록 표시 / Show chunk list for current conversation |
| ALL SESSIONS | 전체 세션 목록 (프로젝트별) / All sessions grouped by project |
| 청크 클릭 / Chunk click | 원문을 클립보드에 복사 / Copy raw content to clipboard |

---

## 아키텍처 / Architecture

    Browser (Genspark)
      → content.js (turn detection, 20-turn chunking)
      → background.js → localhost:11434 (EXAONE 3.5 7.8B)
      → chunk summary + checkpoint
      → background.js → Cloudflare Worker (Bearer auth)
      → D1 (ext_sessions + ext_chunks)
      → Workers AI (bge-m3, 1024 dims)
      → Vectorize (vector index)

---

## 파일 구조 / File Structure

    aikeep24/
    ├── extension/
    │   ├── manifest.json        # Chrome MV3
    │   ├── content.js           # UI, detection, chunking, Ollama (910 lines)
    │   └── background.js        # Message handlers (171 lines)
    ├── backend/web/
    │   ├── worker.js            # Cloudflare Worker + search UI (744 lines)
    │   └── wrangler.toml        # D1 + Vectorize + AI bindings
    ├── scripts/
    │   ├── backfill-summaries.py
    │   ├── sync-obsidian-to-d1.py
    │   └── check-db-status.py
    ├── sql/
    │   ├── create-tables.sql
    │   └── useful-queries.sql
    ├── README.md
    ├── LICENSE                  # AGPL-3.0
    └── .gitignore

---

## 사전 준비 / Prerequisites

| 항목 | 세부 |
|---|---|
| OS | macOS (Apple Silicon M2/M4) / Linux |
| RAM | 16GB+ 권장 |
| Browser | Chrome |
| LLM | Ollama + EXAONE 3.5 7.8B (4.7GB) |
| Cloud | Cloudflare 무료 계정 |
| Runtime | Node.js 18+ |

---

## 설치 / Installation

**1. Clone**

    git clone https://github.com/aikorea24/aikeep24.git
    cd aikeep24

**2. Ollama + EXAONE**

    OLLAMA_ORIGINS='*' ollama serve &
    sleep 3
    ollama pull exaone3.5:7.8b

**3. Cloudflare Backend**

    cd backend/web
    npx wrangler d1 create obsidian-db
    npx wrangler d1 execute obsidian-db --remote --file=../../sql/create-tables.sql
    npx wrangler vectorize create aikeep24-vectors --dimensions=1024 --metric=cosine
    npx wrangler secret put API_KEY
    npx wrangler deploy

**4. Chrome Extension**

chrome://extensions → Developer mode ON → Load unpacked → extension/ folder

**5. API Key**

확장의 Service Worker 콘솔에서:

    chrome.storage.local.set({ck_api_key: 'YOUR_API_KEY_HERE'});

---

## 기존 도구와의 차이 / Comparison

| | Pactify | Chat Memo | SaveAIChats | **AIKeep24** |
|---|---|---|---|---|
| 저장 | Notion 원문 | 로컬 원문 | 폴더+원문 | **LLM 요약+태깅** |
| 검색 | Notion 의존 | 키워드 | 키워드 | **벡터+필터** |
| 맥락 주입 | 없음 | 없음 | 없음 | **INJ+BRW** |
| 비용 | 무료~유료 | 무료 | 무료 | **무료** |
| 프라이버시 | Notion 경유 | 로컬 | 로컬 | **완전 로컬** |
| 다국어 | 제한적 | 없음 | 없음 | **100개+언어** |

---

## D1 스키마 / Database Schema

**ext_sessions**

    session_id TEXT PRIMARY KEY
    title, source, url, summary TEXT
    topics, key_decisions, tech_stack TEXT  -- JSON arrays
    project, status, checkpoint TEXT
    total_chunks, total_turns INTEGER
    created_at, synced_at TIMESTAMP

**ext_chunks**

    chunk_id TEXT PRIMARY KEY
    session_id TEXT NOT NULL  -- FK → ext_sessions
    chunk_index INTEGER
    turn_start, turn_end INTEGER
    chunk_summary, chunk_checkpoint TEXT
    chunk_topics, chunk_key_decisions TEXT  -- JSON arrays
    raw_content, project TEXT
    -- Vector: summary+checkpoint → bge-m3 (1024d) → Vectorize

---

## 프로젝트 진화 / How This Project Evolved

이 프로젝트는 처음 계획과 크게 달라졌습니다. 그 과정 자체가 바이브코딩의 현실을 보여줍니다.

**Phase 1 — 발견**: Obsidian 노트를 D1에 동기화하는 도구로 시작. 117개 노트를 로컬 LLM으로 요약하면서 "이걸 실시간 대화에 적용하면?"이라는 아이디어 탄생.

**Phase 2 — 구현**: 크롬 확장으로 Genspark 대화 실시간 감지, 20턴 청크 분할, EXAONE 요약, D1 저장. CORS 해결, 체크포인트 시스템 구축.

**Phase 3 — 안정화**: Ollama 큐, 타임아웃 재시도, 자동 트리거, burst 감지, 청크 단위 실시간 저장, Browse 버튼, 검색 UI, 할루시네이션 수정.

**Phase 4 — 프로덕션**: 벡터 검색(Vectorize + bge-m3), Web UI 리팩토링, 서버사이드 필터링, 기간 필터, 청크 덮어쓰기 근본 해결(D1 API 직접 읽기).

**프롬프트 한 줄의 교훈**: + 연산자 하나가 빠져서 전체 요약이 "고객 행동 예측 시스템"이라는 존재하지 않는 프로젝트를 생성했습니다. 프롬프트 엔지니어링에서 문법 오류는 로직 오류보다 찾기 어렵습니다.

---

## 왜 오픈소스인가 / Why Open Source

**신뢰**: AI 대화를 캡처하는 도구는 본질적으로 민감합니다. 코드 공개로 "내 대화가 어디로 가는 거지?"라는 의심을 제거합니다.

**커뮤니티**: AI 서비스별 DOM 셀렉터 유지보수를 사용자 커뮤니티가 분담합니다.

**피드백**: 오픈소스는 관심만 있으면 바로 써보고 이슈를 열어줍니다.

---

## 현재 상태 / Current Status

**Phase 4 Complete** — Production Ready

- 120 세션, 793 청크, 12,525 턴, 90 프로젝트 저장
- 벡터 검색 (Vectorize + bge-m3, 1024차원)
- 서버사이드 필터링 + 기간 필터
- 원문 보존, 할루시네이션 방지 프롬프트
- 청크 덮어쓰기 근본 해결
- 총 코드 1,825줄
- 120 sessions, 793 chunks, 12,525 turns, 90 projects
- Vector search, server-side filtering, date range
- Raw content preservation, anti-hallucination prompt
- Chunk overwrite fundamentally resolved
- 1,825 lines of code

---

## 로드맵 / Roadmap

**멀티 플랫폼** — Claude.ai, ChatGPT, Gemini DOM 셀렉터 분리

**프로젝트 메모리** — 프로젝트별 누적 지식 문서 자동 생성

**내보내기** — Markdown/JSON 내보내기 (Obsidian, Notion 등)

**로컬 전용 모드** — Cloudflare 없이 SQLite로 동작

**세션 관리** — 검색 UI에서 세션 삭제/편집

**Chrome Web Store** — 로컬 전용 모드 완성 후 등록

---

## 알려진 한계 / Known Limitations

**Genspark 전용** — 현재 Genspark DOM에만 대응. Claude.ai, ChatGPT는 로드맵.

**Apple Silicon + 16GB 권장** — EXAONE 3.5 7.8B(4.7GB) 로컬 실행 기준.

**로컬 LLM 할루시네이션** — 4턴 미만 짧은 대화에서 발생 가능. 방지 프롬프트 적용됨.

**Cloudflare 설정 필요** — D1, Vectorize, Worker 배포 필요. 로컬 전용 모드로 제거 예정.

**EXAONE 라이선스** — 비상업적 사용만 허용(1.1-NC). 상업 사용 시 Llama 3, Mistral, Gemma로 교체 가능.

---

## 기여 / Contributing

이슈와 PR을 환영합니다. 특히:

- **AI 플랫폼 DOM 셀렉터** — Claude.ai, ChatGPT, Gemini 턴 감지
- **로컬 LLM 테스트** — Llama 3, Mistral, Gemma 요약 품질 비교
- **번역** — UI/문서 다국어 지원
- **버그 리포트**

---

## 기술 스택 / Tech Stack

- **Extension**: Chrome MV3, MutationObserver, Neo-brutalism UI
- **Local LLM**: Ollama + EXAONE 3.5 7.8B (Q4_K_M, 4.7GB)
- **Vector Search**: Cloudflare Vectorize + Workers AI bge-m3 (1024d)
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Languages**: JavaScript (extension + Worker), Python (scripts)

---

## 라이선스 / License

[AGPL-3.0](https://github.com/aikorea24/aikeep24/blob/main/LICENSE)

개인 사용 자유. 상업적 사용 문의: info@aikorea24.kr

Free for personal use. Commercial licensing: info@aikorea24.kr

---

## 연락처 / Contact

- **Email**: info@aikorea24.kr
- **Web**: [aikorea24.kr](https://aikorea24.kr/)
- **GitHub**: [AI Korea 24](https://github.com/aikorea24)

---

_Built with curiosity, late nights, and conversations with AI._

_호기심과 밤샘과 AI와의 대화로 만들었습니다._
