#!/usr/bin/env python3
"""ext_sessions backfill - 미처리 notes를 강화된 프롬프트로 요약"""

import subprocess
import json
import sys
import os
import re
import time
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from config import OLLAMA_API_GENERATE, OLLAMA_API_TAGS, OLLAMA_MODEL, KNOWN_PROJECTS as CFG_PROJECTS

WRANGLER_CWD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', 'web')
DB_NAME = 'obsidian-db'
OLLAMA_URL = OLLAMA_API_GENERATE
MODEL = OLLAMA_MODEL
TURNS_PER_CHUNK = 20
MAX_CHUNK_CHARS = 15000

KNOWN_PROJECTS = ['AIKeep24', 'TV-show', 'TAP', 'aikorea24', 'news-keyword-pro', 'KDE-keepalive']

def run_query(sql):
    """wrangler CLI로 D1에 SELECT SQL을 실행하고 결과를 반환한다.

    Args:
        sql: 실행할 SQL 문자열.

    Returns:
        list[dict] | None: 결과 행 목록. 실패 시 None.
    """
    result = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', sql],
        capture_output=True, text=True, timeout=120, cwd=WRANGLER_CWD
    )
    if result.returncode != 0:
        print('  DB error: ' + result.stderr[:300])
        return None
    try:
        data = json.loads(result.stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0].get('results', [])
        return []
    except json.JSONDecodeError:
        print('  JSON parse fail')
        return None

def run_update(sql):
    """wrangler CLI로 D1에 INSERT/UPDATE/DDL SQL을 실행한다.

    Args:
        sql: 실행할 SQL 문자열.

    Returns:
        bool: 실행 성공 여부.
    """
    result = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB_NAME, '--remote', '--command', sql],
        capture_output=True, text=True, timeout=120, cwd=WRANGLER_CWD
    )
    ok = result.returncode == 0 or 'Executed' in result.stdout
    if not ok:
        print('  UPDATE fail: ' + result.stderr[:300])
    return ok

def ollama_generate(prompt, timeout=300):
    """urllib로 Ollama API에 프롬프트를 전송하고 응답 텍스트를 반환한다.

    Args:
        prompt: LLM에 전달할 프롬프트 문자열.
        timeout: HTTP 요청 타임아웃(초). 기본 300.

    Returns:
        str | None: 응답 텍스트. 실패 시 None.
    """
    payload = json.dumps({
        'model': MODEL,
        'prompt': prompt,
        'stream': False,
        'options': {'temperature': 0.3, 'num_predict': 512, 'num_ctx': 4096}
    }).encode('utf-8')
    req = urllib.request.Request(OLLAMA_URL, data=payload, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8')).get('response', '').strip()
    except Exception as e:
        print('  Ollama error: ' + str(e))
        return None

def parse_json_block(text):
    """LLM 응답에서 JSON 블록을 추출하여 파싱한다.

    ```json``` 코드블록을 우선 탐색하고, 없으면 첫 { ~ 마지막 } 범위를 시도한다.

    Args:
        text: LLM 응답 전체 텍스트.

    Returns:
        dict | None: 파싱된 JSON 딕셔너리. 실패 시 None.
    """
    m = re.search(r'```json\s*\n(.*?)\n```', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    start = text.find('{')
    end = text.rfind('}') + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
    return None

def parse_checkpoint(text):
    """LLM 응답에서 checkpoint 블록을 추출한다.

    ```checkpoint``` 코드블록을 우선 탐색하고,
    없으면 "# 맥락", "# Context", "checkpoint" 마커를 찾는다.

    Args:
        text: LLM 응답 전체 텍스트.

    Returns:
        str: 체크포인트 텍스트. 없으면 빈 문자열.
    """
    m = re.search(r'```[Cc]heckpoint\s*\n(.*?)\n```', text, re.DOTALL)
    if m:
        return m.group(1).strip()
    for marker in ['# 맥락', '# Context', 'checkpoint']:
        idx = text.find(marker)
        if idx >= 0:
            return text[idx:idx+600].strip()
    return ''

def esc(text):
    """SQL 삽입용 텍스트 이스케이프. 작은따옴표를 두 개로 치환한다.

    list 입력 시 JSON 문자열로 변환한다.

    Args:
        text: 이스케이프할 값 (str, list, 기타).

    Returns:
        str: 이스케이프된 문자열. None/빈값이면 빈 문자열.
    """
    if not text:
        return ''
    if isinstance(text, list):
        text = json.dumps(text, ensure_ascii=False)
    if not isinstance(text, str):
        text = str(text)
    return text.replace("'", "''")

def split_turns(content):
    """대화 원문을 "---" 구분자로 분할하여 턴 목록을 반환한다.

    20자 이하의 짧은 조각은 무시한다.

    Args:
        content: 대화 전체 원문.

    Returns:
        list[str]: 턴 텍스트 목록.
    """
    parts = content.split('\n---\n')
    return [p.strip() for p in parts if p.strip() and len(p.strip()) > 20]

def chunk_turns(turns):
    """턴 목록을 TURNS_PER_CHUNK(20)개 또는 MAX_CHUNK_CHARS(15000)자 기준으로 청크 분할한다.

    Args:
        turns: split_turns()의 반환값.

    Returns:
        list[dict]: 각 항목은 {text, start, end} 딕셔너리.
    """
    chunks = []
    current = []
    current_len = 0
    start = 0
    for i, t in enumerate(turns):
        if current and (len(current) >= TURNS_PER_CHUNK or current_len + len(t) > MAX_CHUNK_CHARS):
            chunks.append({'text': '\n\n---\n\n'.join(current), 'start': start, 'end': i - 1})
            current = []
            current_len = 0
            start = i
        current.append(t)
        current_len += len(t)
    if current:
        chunks.append({'text': '\n\n---\n\n'.join(current), 'start': start, 'end': start + len(current) - 1})
    return chunks

def summarize_chunk(text, ci, total, retries=2):
    """단일 청크를 Ollama로 요약하여 JSON 메타데이터와 체크포인트를 반환한다.

    실패 시 retries 횟수만큼 5초 간격으로 재시도한다.

    Args:
        text: 청크 원문 텍스트.
        ci: 청크 인덱스 (0-based).
        total: 전체 청크 수.
        retries: 최대 재시도 횟수. 기본 2.

    Returns:
        tuple[dict|None, str]: (JSON 메타데이터, 체크포인트). 실패 시 (None, "").
    """
    if len(text) > MAX_CHUNK_CHARS:
        text = text[:MAX_CHUNK_CHARS]
    prompt = (
        '[SYSTEM] 반드시 아래 형식만 출력하세요. 설명이나 인사말 없이 바로 시작하세요.\n\n'
        '[FORMAT]\n'
        '```json\n'
        '{"summary":"2~3문장 요약","topics":["주제1","주제2"],"key_decisions":["결정1"],"tools":["기술1","기술2"],"project":"프로젝트명"}\n'
        '```\n\n'
        '```checkpoint\n'
        '현재 진행 상황 3~5문장\n'
        '```\n'
        '[/FORMAT]\n\n'
        '[RULES]\n'
        '- tools: 대화에서 언급된 기술/도구/프레임워크/언어를 모두 추출. 예: ["Python","Cloudflare D1","Chrome Extension","Ollama","EXAONE"]. 빈 배열 []은 기술 언급이 전혀 없을 때만 허용.\n'
        '- project: 기존 프로젝트=' + json.dumps(KNOWN_PROJECTS, ensure_ascii=False) + '. 해당 시 정확히 같은 이름 사용. 해당 없으면 간결한 새 이름 생성.\n'
        '[/RULES]\n\n'
        '전체 ' + str(total) + '개 구간 중 ' + str(ci + 1) + '번째 대화를 분석하세요:\n\n' + text
    )
    for attempt in range(retries + 1):
        raw = ollama_generate(prompt)
        if raw:
            result = parse_json_block(raw), parse_checkpoint(raw)
            if result[0]:
                return result
        label = f'  Chunk {ci+1}/{total} attempt {attempt+1}/{retries+1}'
        if attempt < retries:
            print(f'{label}: RETRY in 5s...')
            time.sleep(5)
        else:
            print(f'{label}: FAILED')
    return None, ''


def generate_final(chunk_results):
    """청크별 요약 결과를 통합하여 세션 전체 JSON 메타데이터를 생성한다.

    Args:
        chunk_results: [(json_dict, checkpoint_str), ...] 리스트.

    Returns:
        dict | None: 통합 JSON 딕셔너리. 실패 시 None.
    """
    combined = '\n'.join([
        '[구간' + str(i+1) + '] ' + json.dumps(fm, ensure_ascii=False)
        for i, (fm, cp) in enumerate(chunk_results) if fm
    ])
    prompt = (
        '[SYSTEM] 반드시 아래 형식만 출력하세요. 설명이나 인사말 없이 ```json 블록 하나만 출력.\n\n'
        '```json\n'
        '{"summary":"3~5문장 통합요약","topics":[],"key_decisions":[],"tools":[],"project":"","status":"진행중"}\n'
        '```\n\n'
        '[RULES]\n'
        '- tools: 각 구간의 tools을 병합하여 중복 제거한 최종 목록. 빈 배열 금지(기술 언급이 있었다면).\n'
        '- project: 기존 프로젝트=' + json.dumps(KNOWN_PROJECTS, ensure_ascii=False) + '. 해당 시 정확히 같은 이름 사용.\n'
        '- status: 반드시 다음 중 하나만 선택 -> 진행중 | 완료 | 보류 | 검토중.\n'
        '[/RULES]\n\n'
        '아래 구간별 요약을 통합하세요:\n\n' + combined
    )
    raw = ollama_generate(prompt, timeout=600)
    if not raw:
        return None
    return parse_json_block(raw)

def generate_checkpoint(fm):
    """통합 요약 JSON을 바탕으로 다음 세션용 체크포인트를 생성한다.

    summary와 중복되지 않도록 미해결 이슈, 다음 작업, 주의사항에 초점을 맞춘다.

    Args:
        fm: generate_final()이 반환한 통합 JSON 딕셔너리.

    Returns:
        str: 체크포인트 텍스트. 실패 시 빈 문자열.
    """
    prompt = (
        '[SYSTEM] 아래 요약을 바탕으로 "다음 대화를 시작할 때 AI에게 제공할 맥락 브리핑"을 작성하세요.\n'
        'summary와 중복되지 않게 작성하세요. summary는 "무엇을 했는지"이고, checkpoint는 "다음에 무엇을 해야 하는지"입니다.\n'
        '반드시 ```checkpoint 블록 하나만 출력하세요. 다른 텍스트 금지.\n\n'
        '```checkpoint\n'
        '1) 미해결 이슈/블로커 2) 다음 작업 단계 3) 주의사항/의존성. 300자 이내.\n'
        '```\n\n'
        '요약 데이터:\n' + json.dumps(fm, ensure_ascii=False)
    )
    raw = ollama_generate(prompt)
    if not raw:
        return ''
    cp = parse_checkpoint(raw)
    if not cp:
        cp = raw.replace('```checkpoint', '').replace('```', '').strip()
    return cp

def process_note(note_id, title, content):
    """단일 노트를 청크 분할 → Ollama 요약 → ext_sessions/ext_chunks에 저장한다.

    처리 순서: 턴 분할 → 청크 분할 → 청크별 요약 → 통합 요약 →
    체크포인트 생성 → ext_sessions INSERT → ext_chunks INSERT.

    Args:
        note_id: notes 테이블의 id.
        title: 대화 제목.
        content: 대화 전체 원문.

    Returns:
        bool: 처리 성공 여부.
    """
    turns = split_turns(content)
    if len(turns) < 2:
        print('  Skip: too few turns')
        return False

    chunks = chunk_turns(turns)
    print(f'  Turns: {len(turns)}, Chunks: {len(chunks)}')

    chunk_results = []
    for i, ch in enumerate(chunks):
        print(f'  Chunk {i+1}/{len(chunks)} ({len(ch["text"]):,} chars)...', end=' ', flush=True)
        fm, cp = summarize_chunk(ch['text'], i, len(chunks))
        if fm:
            print('OK')
            chunk_results.append((fm, cp, ch))
        else:
            print('FAIL')
            chunk_results.append((None, '', ch))
        time.sleep(1)

    valid = [(fm, cp, ch) for fm, cp, ch in chunk_results if fm]
    if not valid:
        print('  All chunks failed')
        return False

    print('  Final summary...', end=' ', flush=True)
    fm = generate_final([(f, c) for f, c, _ in valid])
    if not fm:
        print('FAIL')
        return False
    print('OK')

    print('  Checkpoint...', end=' ', flush=True)
    cp = generate_checkpoint(fm)
    print('OK' if cp else 'EMPTY')

    if fm.get('status', '') not in ['진행중', '완료', '보류', '검토중']:
        fm['status'] = '진행중'

    import uuid
    sid = str(uuid.uuid4())

    sql = (
        "INSERT INTO ext_sessions (session_id, title, source, url, summary, topics, key_decisions, tools, project, status, checkpoint, total_chunks, total_turns, note_id) "
        "VALUES ('" + sid + "', "
        "'" + esc(title) + "', 'genspark', '', "
        "'" + esc(fm.get('summary', '')) + "', "
        "'" + esc(json.dumps(fm.get('topics', []), ensure_ascii=False)) + "', "
        "'" + esc(json.dumps(fm.get('key_decisions', []), ensure_ascii=False)) + "', "
        "'" + esc(json.dumps(fm.get('tools', []), ensure_ascii=False)) + "', "
        "'" + esc(fm.get('project', '')) + "', "
        "'" + esc(fm.get('status', '진행중')) + "', "
        "'" + esc(cp) + "', "
        + str(len(chunks)) + ", " + str(len(turns)) + ", " + str(note_id) + ");"
    )

    if not run_update(sql):
        print('  Session insert FAIL')
        return False

    for i, (cfm, ccp, ch) in enumerate(chunk_results):
        csid = str(uuid.uuid4())
        csql = (
            "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, turn_start, turn_end, chunk_summary, chunk_checkpoint, chunk_topics, chunk_key_decisions) "
            "VALUES ('" + csid + "', '" + sid + "', " + str(i) + ", "
            + str(ch['start']) + ", " + str(ch['end']) + ", "
            "'" + esc(cfm.get('summary', '') if cfm else '') + "', "
            "'" + esc(ccp) + "', "
            "'" + esc(json.dumps(cfm.get('topics', []) if cfm else [], ensure_ascii=False)) + "', "
            "'" + esc(json.dumps(cfm.get('key_decisions', []) if cfm else [], ensure_ascii=False)) + "');"
        )
        run_update(csql)

    print(f'  DONE: {fm.get("project", "")} | {fm.get("summary", "")[:60]}')
    return True

def main():
    """메인 실행: Ollama 확인 → 미처리 노트 조회 → ext_sessions 소급 요약.

    genspark 태그가 있는 노트 중 ext_sessions에 없는 것을 크기 순으로 처리한다.
    """
    print('=' * 60)
    print('  ext_sessions backfill (강화 프롬프트)')
    print('=' * 60)

    try:
        urllib.request.urlopen(OLLAMA_API_TAGS, timeout=5)
        print('Ollama OK')
    except:
        print('Ollama not running')
        sys.exit(1)

    already = run_query("SELECT note_id FROM ext_sessions WHERE note_id IS NOT NULL")
    done_ids = set()
    if already:
        done_ids = {r['note_id'] for r in already}
    print(f'Already in ext_sessions: {len(done_ids)}')

    rows = run_query(
        "SELECT id, title, length(content) as size FROM notes "
        "WHERE tags LIKE '%genspark%' ORDER BY length(content) ASC"
    )
    if not rows:
        print('No notes found')
        return

    todo = [r for r in rows if r['id'] not in done_ids]
    print(f'Total notes: {len(rows)}, Done: {len(done_ids)}, Todo: {len(todo)}')

    if not todo:
        print('Nothing to do!')
        return

    ok = 0
    fail = 0
    for i, row in enumerate(todo):
        print(f'\n[{i+1}/{len(todo)}] id={row["id"]} {row["size"]:,} chars - {row["title"][:50]}')

        content_rows = run_query("SELECT content FROM notes WHERE id=" + str(row['id']))
        if not content_rows or not content_rows[0].get('content'):
            print('  Content fetch FAIL')
            fail += 1
            continue

        if process_note(row['id'], row['title'], content_rows[0]['content']):
            ok += 1
        else:
            fail += 1

    print(f'\n{"=" * 60}')
    print(f'  Done: {ok} ok / {fail} fail / {len(todo)} total')
    print(f'{"=" * 60}')

if __name__ == '__main__':
    main()
