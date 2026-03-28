"""JSON/checkpoint 파싱 함수 테스트."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'lib'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

# backfill-summaries.py는 하이픈이 있어서 importlib 사용
import importlib.util

def _load_module(name, filename):
    spec = importlib.util.spec_from_file_location(
        name,
        os.path.join(os.path.dirname(__file__), '..', 'scripts', filename)
    )
    mod = importlib.util.module_from_spec(spec)
    # requests/boto3 import 에러 방지: config만 필요
    spec.loader.exec_module(mod)
    return mod

bs = _load_module('backfill_summaries', 'backfill-summaries.py')


class TestParseJsonBlock:
    """parse_json_block 테스트."""

    def test_fenced_json(self):
        text = 'some text\n```json\n{"summary":"test","topics":[]}\n```\nmore'
        result = bs.parse_json_block(text)
        assert result is not None
        assert result['summary'] == 'test'

    def test_bare_json(self):
        text = 'prefix {"summary":"bare"} suffix'
        result = bs.parse_json_block(text)
        assert result is not None
        assert result['summary'] == 'bare'

    def test_no_json(self):
        text = 'no json here at all'
        result = bs.parse_json_block(text)
        assert result is None

    def test_invalid_json(self):
        text = '```json\n{invalid json}\n```'
        result = bs.parse_json_block(text)
        assert result is None

    def test_nested_json(self):
        text = '```json\n{"summary":"ok","topics":["a","b"],"key_decisions":[]}\n```'
        result = bs.parse_json_block(text)
        assert result['topics'] == ['a', 'b']


class TestParseCheckpointBlock:
    """parse_checkpoint_block 테스트."""

    def test_fenced_checkpoint(self):
        text = 'text\n```checkpoint\n현재 진행 상황입니다.\n```\nmore'
        result = bs.parse_checkpoint_block(text)
        assert '진행 상황' in result

    def test_marker_korean(self):
        text = 'some\n# 맥락 체크포인트\n프로젝트 진행중\nend'
        result = bs.parse_checkpoint_block(text)
        assert '맥락 체크포인트' in result

    def test_marker_english(self):
        text = 'some\n# Context Checkpoint\nProject ongoing\nend'
        result = bs.parse_checkpoint_block(text)
        assert 'Context Checkpoint' in result

    def test_no_checkpoint(self):
        text = 'no checkpoint marker anywhere'
        result = bs.parse_checkpoint_block(text)
        assert result == ''
