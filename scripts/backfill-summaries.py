#!/usr/bin/env python3
"""ODS - AI 대화 소급 요약 v3 (sessions + chunks 구조)"""

import json
import logging
import os
import re
import subprocess
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(message)s")
log: logging.Logger = logging.getLogger(__name__)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from config import OLLAMA_API_GENERATE, OLLAMA_API_TAGS, OLLAMA_MODEL

SCRIPT_DIR: str = os.path.dirname(os.path.abspath(__file__))
WRANGLER_CWD: str = os.path.join(SCRIPT_DIR, "..", "backend")
DB_NAME: str = "obsidian-db"
OLLAMA_URL: str = OLLAMA_API_GENERATE
MODEL: str = OLLAMA_MODEL
TURNS_PER_CHUNK: int = 20
MAX_CHUNK_CHARS: int = 15000

def run_query(sql: str, timeout: int = 120) -> list[dict] | None:
    """wrangler CLI로 D1에 SELECT SQL을 실행하고 결과를 반환한다.

    Args:
        sql: 실행할 SQL 문자열.
        timeout: subprocess 타임아웃(초). 기본 120.

    Returns:
        list[dict] | None: 결과 행 목록. 실패 시 None.
    """
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--remote", "--json", "--command", sql],
        capture_output=True, text=True, timeout=timeout,
        cwd=WRANGLER_CWD
    )
    if result.returncode != 0:
        log.error("  DB error: %s", result.stderr[:200])
        return None
    try:
        data = json.loads(result.stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("results", [])
        return []
    except json.JSONDecodeError:
        log.error("  JSON parse fail: %s", result.stdout[:200])
        return None

def run_update(sql: str, timeout: int = 120) -> bool:
    """wrangler CLI로 D1에 INSERT/UPDATE/DDL SQL을 실행한다.

    Args:
        sql: 실행할 SQL 문자열.
        timeout: subprocess 타임아웃(초). 기본 120.

    Returns:
        bool: 실행 성공 여부.
    """
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--remote", "--command", sql],
        capture_output=True, text=True, timeout=timeout,
        cwd=WRANGLER_CWD
    )
    ok = result.returncode == 0 or "Executed" in result.stdout
    if not ok:
        log.error("  UPDATE fail: %s", result.stderr[:200])
    return ok

def check_ollama() -> bool:
    """Ollama 서버 연결 및 모델 설치 여부를 확인한다.

    Returns:
        bool: 지정 모델이 설치되어 있으면 True.
    """
    try:
        resp = requests.get(
            OLLAMA_API_TAGS, timeout=5
        )
        models = [m["name"] for m in resp.json().get("models", [])]
        found = any(MODEL.split(":")[0] in m for m in models)
        if found:
            log.info("Ollama OK: %s", MODEL)
        else:
            log.warning("Model not found. Installed: %s", models)
        return found
    except Exception as e:
        log.error("Ollama fail: %s", e)
        return False

def ollama_generate(prompt: str, timeout: int = 600) -> str | None:
    """Ollama API로 프롬프트를 전송하고 응답 텍스트를 반환한다.

    Args:
        prompt: LLM에 전달할 프롬프트 문자열.
        timeout: HTTP 요청 타임아웃(초). 기본 600.

    Returns:
        str | None: 응답 텍스트. 실패 시 None.
    """
    try:
        resp = requests.post(OLLAMA_URL, json={
            "model": MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 512,
                "num_ctx": 4096
            }
        }, timeout=timeout)
        return resp.json().get("response", "").strip()
    except Exception as e:
        log.error("  Ollama error: %s", e)
        return None

def parse_json_block(text: str) -> dict | None:
    """LLM 응답에서 JSON 블록을 추출하여 파싱한다.

    ```json``` 코드블록을 우선 탐색하고, 없으면 첫 { ~ 마지막 } 범위를 시도한다.

    Args:
        text: LLM 응답 전체 텍스트.

    Returns:
        dict | None: 파싱된 JSON 딕셔너리. 실패 시 None.
    """
    m = re.search(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
    return None

def parse_checkpoint_block(text: str) -> str:
    """LLM 응답에서 checkpoint 블록을 추출한다.

    ```checkpoint``` 코드블록을 우선 탐색하고,
    없으면 "# 맥락 체크포인트" 또는 "# Context Checkpoint" 마커를 찾는다.

    Args:
        text: LLM 응답 전체 텍스트.

    Returns:
        str: 체크포인트 텍스트. 없으면 빈 문자열.
    """
    m = re.search(
        r"```checkpoint\s*\n(.*?)\n```", text, re.DOTALL
    )
    if m:
        return m.group(1).strip()
    for marker in ["# 맥락 체크포인트", "# Context Checkpoint"]:
        idx = text.find(marker)
        if idx >= 0:
            return text[idx:idx + 600].strip()
    return ""

def split_into_turns(content: str) -> list[str]:
    """대화 원문을 "---" 구분자로 분할하여 턴 목록을 반환한다.

    20자 이하의 짧은 조각은 무시한다.

    Args:
        content: 대화 전체 원문.

    Returns:
        list[str]: 턴 텍스트 목록.
    """
    parts = content.split("\n---\n")
    turns = []
    for p in parts:
        text = p.strip()
        if text and len(text) > 20:
            turns.append(text)
    return turns

def chunk_turns(turns: list[str]) -> list[dict]:
    """턴 목록을 TURNS_PER_CHUNK(20)개 또는 MAX_CHUNK_CHARS(15000)자 기준으로 청크 분할한다.

    Args:
        turns: split_into_turns()의 반환값.

    Returns:
        list[dict]: 각 항목은 {text, turn_start, turn_end} 딕셔너리.
    """
    chunks = []
    current = []
    current_len = 0
    start_idx = 0
    for i, t in enumerate(turns):
        if (current and
                (len(current) >= TURNS_PER_CHUNK
                 or current_len + len(t) > MAX_CHUNK_CHARS)):
            chunks.append({
                "text": "\n\n---\n\n".join(current),
                "turn_start": start_idx,
                "turn_end": i - 1
            })
            current = []
            current_len = 0
            start_idx = i
        current.append(t)
        current_len += len(t)
    if current:
        chunks.append({
            "text": "\n\n---\n\n".join(current),
            "turn_start": start_idx,
            "turn_end": start_idx + len(current) - 1
        })
    return chunks

def summarize_chunk(chunk_text: str, chunk_idx: int, total_chunks: int) -> tuple[dict | None, str | None]:
    """단일 청크를 Ollama로 요약하여 JSON 메타데이터와 체크포인트를 반환한다.

    MAX_CHUNK_CHARS 초과 시 잘라서 전송한다.

    Args:
        chunk_text: 청크 원문 텍스트.
        chunk_idx: 청크 인덱스 (0-based).
        total_chunks: 전체 청크 수.

    Returns:
        tuple[dict|None, str|None]: (JSON 메타데이터, 체크포인트). 실패 시 (None, None).
    """
    if len(chunk_text) > MAX_CHUNK_CHARS:
        chunk_text = chunk_text[:MAX_CHUNK_CHARS] + "\n...(잘림)"

    prompt = (
        "당신은 AI 대화 기록 분석 전문가입니다.\n"
        "아래는 전체 " + str(total_chunks) + "개 구간 중 "
        + str(chunk_idx + 1) + "번째입니다.\n\n"
        "두 가지를 출력하세요.\n\n"
        "출력1: 이 구간의 JSON 요약을 ```json``` 블록 안에:\n"
        '{"summary":"2~3문장 한국어 요약",'
        '"topics":["주제1","주제2"],'
        '"key_decisions":["결정1"],'
        '"action_items":["할일1"],'
        '"tech_stack":["기술1"],'
        '"project":"프로젝트명"}\n\n'
        "출력2: 이 구간까지의 체크포인트를 "
        "```checkpoint``` 블록 안에 3~5문장 한국어로.\n\n"
        "규칙:\n"
        "- 반드시 아래 대화 원문에 실제로 등장하는 내용만 요약하세요. 원문에 없는 내용을 추가하거나 지어내면 안 됩니다.\n"
        "- summary: 원문에서 실제로 논의된 구체적 주제와 결론을 2~3문장으로.\n"
        "- topics: 대화에서 실제로 다룬 주제만 추출.\n"
        "- tech_stack: 대화에서 실제로 언급된 기술, 도구, 서비스만 추출. 예: [\"Python\",\"Cloudflare D1\",\"Ollama\"]\n"
        "- project: 기존 프로젝트=[AIKeep24, TV-show, TAP, aikorea24, news-keyword-pro, KDE-keepalive]. 해당 시 정확히 같은 이름 사용. 해당 없으면 간결한 새 이름 생성.\n"
        "- 실제 결정된 것만 key_decisions에\n"
        "- 모르는 항목은 빈 배열 []\n"
        "- 능동 표현 사용\n\n"
        "대화:\n" + chunk_text
    )
    raw = ollama_generate(prompt)
    if not raw:
        return None, None
    fm = parse_json_block(raw)
    cp = parse_checkpoint_block(raw)
    if not fm:
        fm = {"summary": "[PARSE_FAILED] JSON 파싱 실패 - 재처리 필요", "topics": [],
               "key_decisions": [], "action_items": [],
               "tech_stack": [], "project": ""}
    return fm, cp

def generate_final(chunk_data_list: list[tuple[dict, str]], title: str) -> tuple[dict | None, str | None]:
    """청크별 분석 결과를 통합하여 세션 전체 요약과 체크포인트를 생성한다.

    Args:
        chunk_data_list: [(json_dict, checkpoint_str), ...] 리스트.
        title: 대화 제목.

    Returns:
        tuple[dict|None, str|None]: (통합 JSON, 통합 체크포인트). 실패 시 (None, None).
    """
    parts = []
    for i, (fm, cp) in enumerate(chunk_data_list):
        block = "[구간 " + str(i + 1) + "]\n"
        block += "요약: " + json.dumps(
            fm, ensure_ascii=False) + "\n"
        block += "체크포인트: " + (cp or "") + "\n"
        parts.append(block)
    combined = "\n".join(parts)

    prompt = (
        '"' + title + '" 대화의 구간별 분석입니다.\n\n'
        + combined + "\n\n"
        "이것들을 통합하여 두 가지를 출력하세요.\n\n"
        "출력1: 통합 JSON을 ```json``` 블록 안에:\n"
        '{"summary":"전체 3~5문장 요약",'
        '"topics":["중복제거된 주제들"],'
        '"key_decisions":["시간순 결정사항들"],'
        '"action_items":["할일들"],'
        '"tech_stack":["기술들"],'
        '"project":"프로젝트명",'
        '"status":"진행중 또는 완료 또는 보류"}\n\n'
        "출력2: 맥락 체크포인트를 ```checkpoint``` 블록 안에.\n"
        "형식:\n"
        "# 맥락 체크포인트\n"
        "## 프로젝트\n[이름]: [한줄설명]\n"
        "## 현재 상황\n[2~3문장]\n"
        "## 핵심 결정사항\n- [결정1]\n"
        "## 진행 중\n[1~2문장]\n"
        "## 다음 단계\n[1~2문장]\n"
        "## 주의사항\n[제약조건]\n\n"
        "규칙: 500자 이내, 기술용어 축약금지, 능동표현"
    )
    raw = ollama_generate(prompt, timeout=600)
    if not raw:
        return None, None
    fm = parse_json_block(raw)
    cp = parse_checkpoint_block(raw)
    if not fm:
        fm = {"summary": raw[:500], "topics": [],
               "key_decisions": [], "action_items": [],
               "tech_stack": [], "project": "", "status": ""}
    return fm, cp

def esc(text: str | list | None) -> str:
    """SQL 삽입용 텍스트 이스케이프. 작은따옴표를 두 개로 치환한다.

    list 입력 시 쉼표로 연결한 문자열로 변환한다.

    Args:
        text: 이스케이프할 값 (str, list, 기타).

    Returns:
        str: 이스케이프된 문자열. None/빈값이면 빈 문자열.
    """
    if not text:
        return ""
    if isinstance(text, list):
        text = ", ".join(str(x) for x in text)
    if not isinstance(text, str):
        text = str(text)
    return text.replace("'", "''")

def init_tables() -> None:
    """conversation_sessions, conversation_chunks 테이블과 notes 컬럼을 생성한다.

    이미 존재하면 무시한다 (IF NOT EXISTS / ALTER 실패 허용).
    """
    run_update(
        "CREATE TABLE IF NOT EXISTS conversation_sessions ("
        "session_id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "note_id INTEGER NOT NULL, "
        "title TEXT, "
        "source TEXT DEFAULT 'genspark', "
        "summary TEXT, "
        "topics TEXT, "
        "key_decisions TEXT, "
        "action_items TEXT, "
        "tech_stack TEXT, "
        "project TEXT, "
        "status TEXT, "
        "checkpoint TEXT, "
        "total_chunks INTEGER DEFAULT 0, "
        "total_turns INTEGER DEFAULT 0, "
        "created_at TIMESTAMP DEFAULT (datetime('now')), "
        "UNIQUE(note_id));"
    )
    run_update(
        "CREATE TABLE IF NOT EXISTS conversation_chunks ("
        "chunk_id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "session_id INTEGER NOT NULL, "
        "chunk_index INTEGER NOT NULL, "
        "turn_start INTEGER, "
        "turn_end INTEGER, "
        "chunk_summary TEXT, "
        "chunk_checkpoint TEXT, "
        "chunk_topics TEXT, "
        "chunk_key_decisions TEXT, "
        "created_at TIMESTAMP DEFAULT (datetime('now')), "
        "UNIQUE(session_id, chunk_index));"
    )
    cols = ["summary", "topics", "key_decisions", "project",
            "action_items", "tech_stack", "status", "checkpoint"]
    for col in cols:
        run_update(
            "ALTER TABLE notes ADD COLUMN "
            + col + " TEXT DEFAULT '';"
        )
    log.info("Tables ready")

def is_processed(note_id: int) -> bool:
    """해당 note_id가 이미 conversation_sessions에 존재하는지 확인한다.

    Args:
        note_id: notes 테이블의 id.

    Returns:
        bool: 이미 처리된 경우 True.
    """
    rows = run_query(
        "SELECT session_id FROM conversation_sessions "
        "WHERE note_id=" + str(note_id)
    )
    return rows is not None and len(rows) > 0

def process_note(note_id: int, title: str, content: str) -> bool:
    """단일 노트를 청크 분할 → Ollama 요약 → D1 저장까지 처리한다.

    처리 순서: 턴 분할 → 청크 분할 → 청크별 요약 → 통합 요약 →
    conversation_sessions INSERT → conversation_chunks INSERT → notes UPDATE.

    Args:
        note_id: notes 테이블의 id.
        title: 대화 제목.
        content: 대화 전체 원문.

    Returns:
        bool: 처리 성공 여부.
    """
    log.info("\n" + "=" * 60)
    log.info("[%d] %s", note_id, title)
    log.info("Size: %s chars", f"{len(content):,}")

    turns = split_into_turns(content)
    log.info("Turns: %d", len(turns))
    if len(turns) < 2:
        log.warning("  Too few turns, skip")
        return False

    chunks = chunk_turns(turns)
    log.info("Chunks: %d", len(chunks))

    chunk_data = []
    for i, ch in enumerate(chunks):
        log.info("  Chunk %d/%d (turns %d-%d, %s chars)...", i + 1, len(chunks), ch["turn_start"], ch["turn_end"], f'{len(ch["text"]):,}')
        fm, cp = summarize_chunk(ch["text"], i, len(chunks))
        if fm:
            chunk_data.append((fm, cp or "", ch))
            log.info("    OK: %s", fm.get("summary", "")[:60])
        else:
            chunk_data.append((
                {"summary": "", "topics": [],
                 "key_decisions": [], "action_items": [],
                 "tech_stack": [], "project": ""},
                "", ch
            ))
            log.warning("    FAIL")
        time.sleep(1)

    valid = [(fm, cp, ch) for fm, cp, ch in chunk_data
             if fm.get("summary")]
    if not valid:
        log.error("  All chunks failed")
        return False

    log.info("  Final summary...")
    final_fm, final_cp = generate_final(
        [(fm, cp) for fm, cp, ch in valid], title
    )
    if not final_fm:
        log.error("  Final summary failed")
        return False

    s_sql = (
        "INSERT INTO conversation_sessions "
        "(note_id, title, source, summary, topics, "
        "key_decisions, action_items, tech_stack, "
        "project, status, checkpoint, "
        "total_chunks, total_turns) VALUES ("
        + str(note_id) + ", "
        "'" + esc(title) + "', 'genspark', "
        "'" + esc(final_fm.get("summary", "")) + "', "
        "'" + esc(json.dumps(
            final_fm.get("topics", []),
            ensure_ascii=False)) + "', "
        "'" + esc(json.dumps(
            final_fm.get("key_decisions", []),
            ensure_ascii=False)) + "', "
        "'" + esc(json.dumps(
            final_fm.get("action_items", []),
            ensure_ascii=False)) + "', "
        "'" + esc(json.dumps(
            final_fm.get("tech_stack", []),
            ensure_ascii=False)) + "', "
        "'" + esc(final_fm.get("project", "")) + "', "
        "'" + esc(final_fm.get("status", "")) + "', "
        "'" + esc(final_cp or "") + "', "
        + str(len(chunks)) + ", "
        + str(len(turns))
        + ") ON CONFLICT(note_id) DO UPDATE SET "
        "summary=excluded.summary, "
        "topics=excluded.topics, "
        "key_decisions=excluded.key_decisions, "
        "action_items=excluded.action_items, "
        "tech_stack=excluded.tech_stack, "
        "project=excluded.project, "
        "status=excluded.status, "
        "checkpoint=excluded.checkpoint, "
        "total_chunks=excluded.total_chunks, "
        "total_turns=excluded.total_turns;"
    )
    if not run_update(s_sql):
        log.error("  Session insert fail")
        return False

    sid_rows = run_query(
        "SELECT session_id FROM conversation_sessions "
        "WHERE note_id=" + str(note_id)
    )
    if not sid_rows:
        log.error("  Session ID fetch fail")
        return False
    session_id = sid_rows[0]["session_id"]

    for i, (fm, cp, ch) in enumerate(chunk_data):
        c_sql = (
            "INSERT INTO conversation_chunks "
            "(session_id, chunk_index, turn_start, turn_end, "
            "chunk_summary, chunk_checkpoint, "
            "chunk_topics, chunk_key_decisions) VALUES ("
            + str(session_id) + ", " + str(i) + ", "
            + str(ch["turn_start"]) + ", "
            + str(ch["turn_end"]) + ", "
            "'" + esc(fm.get("summary", "")) + "', "
            "'" + esc(cp) + "', "
            "'" + esc(json.dumps(
                fm.get("topics", []),
                ensure_ascii=False)) + "', "
            "'" + esc(json.dumps(
                fm.get("key_decisions", []),
                ensure_ascii=False)) + "'"
            ") ON CONFLICT(session_id, chunk_index) "
            "DO UPDATE SET "
            "chunk_summary=excluded.chunk_summary, "
            "chunk_checkpoint=excluded.chunk_checkpoint, "
            "chunk_topics=excluded.chunk_topics, "
            "chunk_key_decisions=excluded.chunk_key_decisions;"
        )
        run_update(c_sql)

    n_sql = (
        "UPDATE notes SET "
        "summary='" + esc(final_fm.get("summary", "")) + "', "
        "topics='" + esc(json.dumps(
            final_fm.get("topics", []),
            ensure_ascii=False)) + "', "
        "key_decisions='" + esc(json.dumps(
            final_fm.get("key_decisions", []),
            ensure_ascii=False)) + "', "
        "action_items='" + esc(json.dumps(
            final_fm.get("action_items", []),
            ensure_ascii=False)) + "', "
        "tech_stack='" + esc(json.dumps(
            final_fm.get("tech_stack", []),
            ensure_ascii=False)) + "', "
        "project='" + esc(final_fm.get("project", "")) + "', "
        "status='" + esc(final_fm.get("status", "")) + "', "
        "checkpoint='" + esc(final_cp or "") + "' "
        "WHERE id=" + str(note_id) + ";"
    )
    run_update(n_sql)

    log.info("  DONE: %s", final_fm.get("summary", "")[:80])
    log.info("  Project: %s", final_fm.get("project", ""))
    log.info("  Chunks saved: %d", len(chunk_data))
    return True

def main() -> None:
    """메인 실행: Ollama 확인 → 테이블 초기화 → 미처리 노트 순회 → 소급 요약.

    genspark 태그가 있는 노트 중 아직 처리되지 않은 것을 크기 순으로 처리한다.
    """
    log.info("=" * 60)
    log.info("  ODS Backfill v3 (sessions + chunks)")
    log.info("=" * 60)

    if not check_ollama():
        log.error("ollama serve 먼저 실행하세요")
        sys.exit(1)

    init_tables()

    rows = run_query(
        "SELECT id, title, length(content) as size "
        "FROM notes "
        "WHERE tags LIKE '%genspark%' "
        "ORDER BY length(content) ASC"
    )
    if not rows:
        log.warning("No notes found")
        return

    todo = []
    for r in rows:
        if not is_processed(r["id"]):
            todo.append(r)

    print("Total: " + str(len(rows))
          + ", Already done: " + str(len(rows) - len(todo))
          + ", Todo: " + str(len(todo)))

    success = 0
    fail = 0
    for i, row in enumerate(todo):
        print("\n[" + str(i + 1) + "/" + str(len(todo))
              + "] id=" + str(row["id"])
              + " " + "{:,}".format(row["size"]) + " chars")

        content_rows = run_query(
            "SELECT content FROM notes WHERE id="
            + str(row["id"])
        )
        if not content_rows or not content_rows[0].get("content"):
            log.error("  Content fetch fail")
            fail += 1
            continue

        if process_note(
            row["id"], row["title"],
            content_rows[0]["content"]
        ):
            success += 1
        else:
            fail += 1

    print("\n" + "=" * 60)
    print("  Done: " + str(success) + " ok / "
          + str(fail) + " fail / "
          + str(len(todo)) + " total")
    print("=" * 60)

if __name__ == "__main__":
    main()
