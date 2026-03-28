"""esc, sql_escape, split_into_turns, chunk_turns 테스트."""
import sys
import os
import importlib.util

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'lib'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

def _load_module(name, filename):
    spec = importlib.util.spec_from_file_location(
        name,
        os.path.join(os.path.dirname(__file__), '..', 'scripts', filename)
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

bs = _load_module('backfill_summaries', 'backfill-summaries.py')


class TestEsc:
    """esc() 이스케이프 함수 테스트."""

    def test_none(self):
        assert bs.esc(None) == ''

    def test_empty(self):
        assert bs.esc('') == ''

    def test_single_quote(self):
        assert bs.esc("it's") == "it''s"

    def test_list_input(self):
        result = bs.esc(['a', 'b'])
        assert 'a' in result
        assert "'" not in result or "''" in result

    def test_non_string(self):
        result = bs.esc(123)
        assert result == '123'


class TestSplitIntoTurns:
    """split_into_turns() 테스트."""

    def test_basic_split(self):
        content = 'First turn with enough text.\n---\nSecond turn also enough.'
        turns = bs.split_into_turns(content)
        assert len(turns) == 2

    def test_short_turn_filtered(self):
        content = 'Long enough turn content here.\n---\nshort\n---\nAnother long turn text.'
        turns = bs.split_into_turns(content)
        assert len(turns) == 2  # 'short'은 20자 미만이라 제거

    def test_empty_content(self):
        turns = bs.split_into_turns('')
        assert len(turns) == 0


class TestChunkTurns:
    """chunk_turns() 테스트."""

    def test_single_chunk(self):
        turns = ['Turn ' + str(i) + ' with enough content.' for i in range(5)]
        chunks = bs.chunk_turns(turns)
        assert len(chunks) == 1
        assert chunks[0]['turn_start'] == 0
        assert chunks[0]['turn_end'] == 4

    def test_multiple_chunks(self):
        turns = ['Turn content number ' + str(i) + ' padding.' for i in range(25)]
        chunks = bs.chunk_turns(turns)
        assert len(chunks) >= 2
        # 연속성 확인: 첫 청크 end + 1 == 둘째 청크 start
        assert chunks[1]['turn_start'] == chunks[0]['turn_end'] + 1
