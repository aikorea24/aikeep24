#!/usr/bin/env python3
"""ODS - Obsidian D1 Sync (R2 → D1, 변경분만 동기화)"""

import os
import sys
import subprocess
import re
import json
import boto3
from datetime import datetime
from dotenv import load_dotenv

# stdout/stderr 안전 처리 (대시보드 원격 실행 시 fd 없을 수 있음)
try:
    sys.stdout.fileno()
except (OSError, AttributeError):
    import io
    LOG_PATH = os.path.expanduser("~/.ods_sync.log")
    _log = open(LOG_PATH, "a", encoding="utf-8")
    sys.stdout = _log
    sys.stderr = _log

# 환경 설정
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(SCRIPT_DIR, '.env'))

DB_NAME = "obsidian-db"
HASH_FILE = os.path.expanduser("~/.ods_hashes.json")

# R2 클라이언트
s3 = boto3.client('s3',
    endpoint_url=os.getenv('R2_ENDPOINT'),
    aws_access_key_id=os.getenv('R2_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('R2_SECRET_ACCESS_KEY'),
    region_name='auto'
)
BUCKET = os.getenv('R2_BUCKET', 'obsidian-attachments')

success = 0
fail = 0
skip = 0

def load_hashes():
    if os.path.exists(HASH_FILE):
        with open(HASH_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_hashes(hashes):
    with open(HASH_FILE, "w", encoding="utf-8") as f:
        json.dump(hashes, f, ensure_ascii=False, indent=2)

def list_r2_files():
    """R2에서 .md 파일 목록과 메타데이터 가져오기"""
    files = {}
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith('.md'):
                files[key] = {
                    'size': obj['Size'],
                    'modified': obj['LastModified'].strftime("%Y-%m-%d %H:%M:%S")
                }
    return files

def download_md(key):
    """R2에서 .md 파일 내용 다운로드"""
    response = s3.get_object(Bucket=BUCKET, Key=key)
    return response['Body'].read().decode('utf-8')

def parse_md(raw, filename):
    frontmatter = ""
    title = ""
    date_val = ""
    tags = ""
    body = raw

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", raw, re.DOTALL)
    if match:
        frontmatter = match.group(1)
        body = match.group(2)
        for line in frontmatter.splitlines():
            if line.startswith("title:"):
                title = line.split(":", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("date:"):
                date_val = line.split(":", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("tags:"):
                tags = line.split(":", 1)[1].strip().strip('"').strip("'")

    if not title:
        title = os.path.splitext(os.path.basename(filename))[0]

    return title, date_val, tags, frontmatter, body

def sql_escape(text):
    if not text:
        return ""
    return text.replace("'", "''")

def sync_file(key, raw):
    global success, fail
    try:
        title, date_val, tags, fm, body = parse_md(raw, key)

        max_len = 50000
        if len(body) > max_len:
            body = body[:max_len] + "\n\n... (잘림)"

        sql = (
            f"INSERT INTO notes (file_name, title, date, tags, frontmatter, content, synced_at) "
            f"VALUES ('{sql_escape(key)}', '{sql_escape(title)}', '{sql_escape(date_val)}', "
            f"'{sql_escape(tags)}', '{sql_escape(fm)}', '{sql_escape(body)}', datetime('now')) "
            f"ON CONFLICT(file_name) DO UPDATE SET "
            f"title=excluded.title, date=excluded.date, tags=excluded.tags, "
            f"frontmatter=excluded.frontmatter, content=excluded.content, synced_at=datetime('now');"
        )

        result = subprocess.run(
            ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--command", sql],
            capture_output=True, text=True, timeout=60,
            cwd=os.path.join(SCRIPT_DIR, 'web')
        )

        if "Executed" in result.stdout or result.returncode == 0:
            print(f"✅ {key}")
            success += 1
            return True
        else:
            print(f"❌ {key} — {result.stderr[:100]}")
            fail += 1
            return False

    except Exception as e:
        print(f"❌ {key} — {str(e)[:100]}")
        fail += 1
        return False

def main():
    global success, fail, skip

    print("=== ODS: R2 → D1 Sync ===\n")

    # R2에서 .md 파일 목록 가져오기
    print("R2 파일 목록 조회 중...")
    r2_files = list_r2_files()
    print(f"R2에 .md 파일 {len(r2_files)}개 발견\n")

    old_hashes = load_hashes()
    new_hashes = {}

    for key, meta in r2_files.items():
        mtime = meta['modified']

        # 이전 기록과 수정시각 비교
        old = old_hashes.get(key, {})
        if isinstance(old, dict) and old.get("modified") == mtime:
            new_hashes[key] = old
            skip += 1
            continue

        # 변경됨 → R2에서 다운로드 후 D1에 동기화
        raw = download_md(key)
        parsed_title, _, _, _, _ = parse_md(raw, key)
        if sync_file(key, raw):
            new_hashes[key] = {
                "title": parsed_title,
                "modified": mtime,
                "synced": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
        else:
            new_hashes[key] = old if old else {"title": key, "modified": mtime, "synced": "실패"}

    # R2에서 삭제된 파일은 D1에서도 제거
    deleted = set(old_hashes.keys()) - set(r2_files.keys())
    for rel in deleted:
        esc = sql_escape(rel)
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote",
             "--command", f"DELETE FROM notes WHERE file_name='{esc}';"],
            capture_output=True, text=True, timeout=30,
            cwd=os.path.join(SCRIPT_DIR, 'web')
        )
        print(f"🗑️  {rel} (삭제됨)")

    save_hashes(new_hashes)

    print(f"\n=== 완료: ✅ {success}개 동기화 / ⏭️  {skip}개 변경없음 / ❌ {fail}개 실패 / 🗑️  {len(deleted)}개 삭제 ===")

if __name__ == "__main__":
    main()
