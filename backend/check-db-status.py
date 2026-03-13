import subprocess
import json

DB_NAME = "obsidian-db"

def run_query(sql):
    result = subprocess.run(
        ["bunx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--json", "--command", sql],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        print(f"쿼리 실패: {result.stderr[:200]}")
        return None
    try:
        data = json.loads(result.stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("results", [])
        return []
    except json.JSONDecodeError:
        print(f"JSON 파싱 실패: {result.stdout[:200]}")
        return None

def main():
    print("=" * 55)
    print("  ODS Database 상태 리포트")
    print("=" * 55)

    rows = run_query("SELECT COUNT(*) as total FROM notes;")
    if rows:
        print(f"\n총 문서 수: {rows[0]['total']}개")

    rows = run_query("PRAGMA table_info(notes);")
    if rows:
        cols = [r["name"] for r in rows]
        print(f"컬럼: {', '.join(cols)}")

    rows = run_query("SELECT SUM(LENGTH(content)) as total_bytes FROM notes;")
    if rows and rows[0].get("total_bytes"):
        tb = rows[0]["total_bytes"]
        if tb > 1024 * 1024:
            print(f"콘텐츠 총 크기: {tb / 1024 / 1024:.1f} MB")
        else:
            print(f"콘텐츠 총 크기: {tb / 1024:.1f} KB")

    rows = run_query("SELECT file_name, title, synced_at FROM notes ORDER BY synced_at DESC LIMIT 10;")
    if rows:
        print(f"\n최근 동기화 파일 (최대 10개):")
        print("-" * 55)
        for r in rows:
            title = (r.get("title") or "")[:30]
            synced = r.get("synced_at", "?")
            print(f"  {synced}  {title}")

    rows = run_query("SELECT DATE(synced_at) as day, COUNT(*) as cnt FROM notes WHERE synced_at IS NOT NULL GROUP BY DATE(synced_at) ORDER BY day DESC LIMIT 7;")
    if rows:
        print(f"\n날짜별 동기화 수 (최근 7일):")
        print("-" * 55)
        for r in rows:
            day = r.get("day", "?")
            cnt = r.get("cnt", 0)
            bar = "#" * min(cnt, 50)
            print(f"  {day}  {bar} {cnt}개")

    rows = run_query("SELECT tags, COUNT(*) as cnt FROM notes WHERE tags IS NOT NULL AND tags != '' GROUP BY tags ORDER BY cnt DESC LIMIT 10;")
    if rows:
        print(f"\n태그 분포 (상위 10개):")
        print("-" * 55)
        for r in rows:
            print(f"  [{r['tags']}] -> {r['cnt']}개")

    rows = run_query("SELECT file_name, title, LENGTH(content) as size FROM notes ORDER BY LENGTH(content) DESC LIMIT 5;")
    if rows:
        print(f"\n가장 큰 문서 (상위 5개):")
        print("-" * 55)
        for r in rows:
            size = r.get("size", 0)
            title = (r.get("title") or "")[:35]
            if size and size > 1024:
                print(f"  {size/1024:.1f} KB  {title}")
            else:
                print(f"  {size} B   {title}")

    print("\n" + "=" * 55)
    print("  리포트 완료")
    print("=" * 55)

if __name__ == "__main__":
    main()
