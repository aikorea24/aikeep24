"""sync-obsidian-to-d1.py의 parse_md, sql_escape 테스트."""
import sys
import os
import importlib.util

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'lib'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


def _load_sync():
    """sync 모듈에서 parse_md, sql_escape만 테스트 (boto3 클라이언트 초기화 우회)."""
    # boto3 클라이언트가 모듈 로드 시 초기화되므로, 필요한 환경변수 설정
    os.environ.setdefault('R2_ENDPOINT', 'https://test.r2.cloudflarestorage.com')
    os.environ.setdefault('R2_ACCESS_KEY_ID', 'test')
    os.environ.setdefault('R2_SECRET_ACCESS_KEY', 'test')
    spec = importlib.util.spec_from_file_location(
        'sync',
        os.path.join(os.path.dirname(__file__), '..', 'scripts', 'sync-obsidian-to-d1.py')
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

sync = _load_sync()


class TestParseMd:
    """parse_md() 테스트."""

    def test_with_frontmatter(self):
        raw = '---\ntitle: My Note\ndate: 2025-01-01\ntags: test\n---\nBody text here.'
        title, date_val, tags, fm, body = sync.parse_md(raw, 'test.md')
        assert title == 'My Note'
        assert date_val == '2025-01-01'
        assert tags == 'test'
        assert body == 'Body text here.'

    def test_without_frontmatter(self):
        raw = 'Just plain body text without frontmatter.'
        title, date_val, tags, fm, body = sync.parse_md(raw, 'my-file.md')
        assert title == 'my-file'
        assert date_val == ''
        assert body == raw

    def test_title_fallback_to_filename(self):
        raw = '---\ndate: 2025-01-01\n---\nBody only.'
        title, _, _, _, _ = sync.parse_md(raw, 'path/to/note.md')
        assert title == 'note'


class TestSqlEscape:
    """sql_escape() 테스트."""

    def test_single_quote(self):
        assert sync.sql_escape("it's") == "it''s"

    def test_none(self):
        assert sync.sql_escape(None) == ''

    def test_empty(self):
        assert sync.sql_escape('') == ''

    def test_no_escape_needed(self):
        assert sync.sql_escape('hello') == 'hello'
