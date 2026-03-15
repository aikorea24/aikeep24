#!/usr/bin/env python3
"""ODS - AI 대화 소급 요약 v3 (sessions + chunks 구조)"""

import subprocess
import json
import sys
import os
import re
import time
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WRANGLER_CWD = os.path.join(SCRIPT_DIR, "web")
DB_NAME = "obsidian-db"
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "exaone3.5:7.8b"
TURNS_PER_CHUNK = 50
MAX_CHUNK_CHARS = 30000

def run_query(sql, timeout=120):
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--remote", "--json", "--command", sql],
        capture_output=True, text=True, timeout=timeout,
        cwd=WRANGLER_CWD
    )
    if result.returncode != 0:
        print("  DB error: " + result.stderr[:200])
        return None
    try:
        data = json.loads(result.stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("results", [])
        return []
    except json.JSONDecodeError:
        print("  JSON parse fail: " + result.stdout[:200])
        return None

def run_update(sql, timeout=120):
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--remote", "--command", sql],
        capture_output=True, text=True, timeout=timeout,
        cwd=WRANGLER_CWD
    )
    ok = result.returncode == 0 or "Executed" in result.stdout
    if not ok:
        print("  UPDATE fail: " + result.stderr[:200])
    return ok

def check_ollama():
    try:
        resp = requests.get(
            "http://localhost:11434/api/tags", timeout=5
        )
        models = [m["name"] for m in resp.json().get("models", [])]
        found = any(MODEL.split(":")[0] in m for m in models)
        if found:
            print("Ollama OK: " + MODEL)
        else:
            print("Model not found. Installed: " + str(models))
        return found
    except Exception as e:
        print("Ollama fail: " + str(e))
        return False

def ollama_generate(prompt, timeout=600):
    try:
        resp = requests.post(OLLAMA_URL, json={
            "model": MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 2048,
                "num_ctx": 16384
            }
        }, timeout=timeout)
        return resp.json().get("response", "").strip()
    except Exception as e:
        print("  Ollama error: " + str(e))
        return None

def parse_json_block(text):
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

def parse_checkpoint_block(text):
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

def split_into_turns(content):
    parts = content.split("\n---\n")
    turns = []
    for p in parts:
        text = p.strip()
        if text and len(text) > 20:
            turns.append(text)
    return turns

def chunk_turns(turns):
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

def summarize_chunk(chunk_text, chunk_idx, total_chunks):
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
        fm = {"summary": raw[:300], "topics": [],
               "key_decisions": [], "action_items": [],
               "tech_stack": [], "project": ""}
    return fm, cp

def generate_final(chunk_data_list, title):
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

def esc(text):
    if not text:
        return ""
    if isinstance(text, list):
        text = ", ".join(str(x) for x in text)
    if not isinstance(text, str):
        text = str(text)
    return text.replace("'", "''")

def init_tables():
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
    print("Tables ready")

def is_processed(note_id):
    rows = run_query(
        "SELECT session_id FROM conversation_sessions "
        "WHERE note_id=" + str(note_id)
    )
    return rows is not None and len(rows) > 0

def process_note(note_id, title, content):
    print("\n" + "=" * 60)
    print("[" + str(note_id) + "] " + title)
    print("Size: " + "{:,}".format(len(content)) + " chars")

    turns = split_into_turns(content)
    print("Turns: " + str(len(turns)))
    if len(turns) < 2:
        print("  Too few turns, skip")
        return False

    chunks = chunk_turns(turns)
    print("Chunks: " + str(len(chunks)))

    chunk_data = []
    for i, ch in enumerate(chunks):
        print("  Chunk " + str(i + 1) + "/" + str(len(chunks))
              + " (turns " + str(ch["turn_start"])
              + "-" + str(ch["turn_end"])
              + ", " + "{:,}".format(len(ch["text"]))
              + " chars)...")
        fm, cp = summarize_chunk(ch["text"], i, len(chunks))
        if fm:
            chunk_data.append((fm, cp or "", ch))
            print("    OK: " + fm.get("summary", "")[:60])
        else:
            chunk_data.append((
                {"summary": "", "topics": [],
                 "key_decisions": [], "action_items": [],
                 "tech_stack": [], "project": ""},
                "", ch
            ))
            print("    FAIL")
        time.sleep(1)

    valid = [(fm, cp, ch) for fm, cp, ch in chunk_data
             if fm.get("summary")]
    if not valid:
        print("  All chunks failed")
        return False

    print("  Final summary...")
    final_fm, final_cp = generate_final(
        [(fm, cp) for fm, cp, ch in valid], title
    )
    if not final_fm:
        print("  Final summary failed")
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
        print("  Session insert fail")
        return False

    sid_rows = run_query(
        "SELECT session_id FROM conversation_sessions "
        "WHERE note_id=" + str(note_id)
    )
    if not sid_rows:
        print("  Session ID fetch fail")
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

    print("  DONE: " + final_fm.get("summary", "")[:80])
    print("  Project: " + final_fm.get("project", ""))
    print("  Chunks saved: " + str(len(chunk_data)))
    return True

def main():
    print("=" * 60)
    print("  ODS Backfill v3 (sessions + chunks)")
    print("=" * 60)

    if not check_ollama():
        print("\nollama serve 먼저 실행하세요")
        sys.exit(1)

    init_tables()

    rows = run_query(
        "SELECT id, title, length(content) as size "
        "FROM notes "
        "WHERE tags LIKE '%genspark%' "
        "ORDER BY length(content) ASC"
    )
    if not rows:
        print("No notes found")
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
            print("  Content fetch fail")
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
