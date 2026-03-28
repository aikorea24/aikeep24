"""D1 데이터베이스 상태 리포트 스크립트.

wrangler CLI를 통해 원격 D1(obsidian-db)에 쿼리하여
문서 수, 컬럼 구조, 콘텐츠 크기, 최근 동기화, 태그 분포 등을 출력한다.
"""
import json
import logging
import subprocess

logging.basicConfig(level=logging.INFO, format="%(message)s")
log: logging.Logger = logging.getLogger(__name__)

DB_NAME: str = "obsidian-db"


def run_query(sql: str) -> list[dict] | None:
    """wrangler CLI로 D1에 SQL을 실행하고 결과 행 목록을 반환한다.

    Args:
        sql: 실행할 SQL 문자열.

    Returns:
        list[dict]: 결과 행 목록. 실패 시 None.
    """
    result: subprocess.CompletedProcess[str] = subprocess.run(
        ["bunx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--json", "--command", sql],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        log.error("쿼리 실패: %s", result.stderr[:200])
        return None
    try:
        data: list = json.loads(result.stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("results", [])
        return []
    except json.JSONDecodeError:
        log.error("JSON 파싱 실패: %s", result.stdout[:200])
        return None


def main() -> None:
    """D1 데이터베이스 상태 리포트를 생성하여 터미널에 출력한다.

    출력 항목: 총 문서 수, 컬럼 목록, 콘텐츠 총 크기,
    최근 동기화 파일(10건), 날짜별 동기화 수(7일), 태그 분포(10건),
    가장 큰 문서(5건).
    """
    log.info("=" * 55)
    log.info("  ODS Database 상태 리포트")
    log.info("=" * 55)

    rows: list[dict] | None = run_query("SELECT COUNT(*) as total FROM notes;")
    if rows:
        log.info("\n총 문서 수: %d개", rows[0]["total"])

    rows = run_query("PRAGMA table_info(notes);")
    if rows:
        cols: list[str] = [r["name"] for r in rows]
        log.info("컬럼: %s", ", ".join(cols))

    rows = run_query("SELECT SUM(LENGTH(content)) as total_bytes FROM notes;")
    if rows and rows[0].get("total_bytes"):
        tb: int = rows[0]["total_bytes"]
        if tb > 1024 * 1024:
            log.info("콘텐츠 총 크기: %.1f MB", tb / 1024 / 1024)
        else:
            log.info("콘텐츠 총 크기: %.1f KB", tb / 1024)

    rows = run_query("SELECT file_name, title, synced_at FROM notes ORDER BY synced_at DESC LIMIT 10;")
    if rows:
        log.info("\n최근 동기화 파일 (최대 10개):")
        log.info("-" * 55)
        for r in rows:
            title: str = (r.get("title") or "")[:30]
            synced: str = r.get("synced_at", "?")
            log.info("  %s  %s", synced, title)

    rows = run_query("SELECT DATE(synced_at) as day, COUNT(*) as cnt FROM notes WHERE synced_at IS NOT NULL GROUP BY DATE(synced_at) ORDER BY day DESC LIMIT 7;")
    if rows:
        log.info("\n날짜별 동기화 수 (최근 7일):")
        log.info("-" * 55)
        for r in rows:
            day: str = r.get("day", "?")
            cnt: int = r.get("cnt", 0)
            bar: str = "#" * min(cnt, 50)
            log.info("  %s  %s %d개", day, bar, cnt)

    rows = run_query("SELECT tags, COUNT(*) as cnt FROM notes WHERE tags IS NOT NULL AND tags != \'\'  GROUP BY tags ORDER BY cnt DESC LIMIT 10;")
    if rows:
        log.info("\n태그 분포 (상위 10개):")
        log.info("-" * 55)
        for r in rows:
            log.info("  [%s] -> %d개", r["tags"], r["cnt"])

    rows = run_query("SELECT file_name, title, LENGTH(content) as size FROM notes ORDER BY LENGTH(content) DESC LIMIT 5;")
    if rows:
        log.info("\n가장 큰 문서 (상위 5개):")
        log.info("-" * 55)
        for r in rows:
            size: int = r.get("size", 0)
            title = (r.get("title") or "")[:35]
            if size and size > 1024:
                log.info("  %.1f KB  %s", size / 1024, title)
            else:
                log.info("  %d B   %s", size, title)

    log.info("\n" + "=" * 55)
    log.info("  리포트 완료")
    log.info("=" * 55)


if __name__ == "__main__":
    main()
