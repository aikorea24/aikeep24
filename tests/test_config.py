"""config.py 모듈 로드 및 설정값 테스트."""
import os
import sys

# config.py가 backend/.env를 읽으므로, import 전에 경로 설정
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'lib'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


def test_config_import():
    """config 모듈이 에러 없이 import 되는지 확인."""
    from config import OLLAMA_URL, OLLAMA_MODEL, WORKER_URL
    assert isinstance(OLLAMA_URL, str)
    assert len(OLLAMA_URL) > 0


def test_ollama_url_format():
    """OLLAMA_URL이 http(s)://로 시작하는지 확인."""
    from config import OLLAMA_URL
    assert OLLAMA_URL.startswith('http')


def test_ollama_api_endpoints():
    """API 엔드포인트가 OLLAMA_URL 기반으로 구성되는지 확인."""
    from config import OLLAMA_URL, OLLAMA_API_GENERATE, OLLAMA_API_TAGS
    assert OLLAMA_API_GENERATE == OLLAMA_URL + '/api/generate'
    assert OLLAMA_API_TAGS == OLLAMA_URL + '/api/tags'


def test_known_projects_list():
    """KNOWN_PROJECTS가 비어있지 않은 리스트인지 확인."""
    from config import KNOWN_PROJECTS
    assert isinstance(KNOWN_PROJECTS, list)
    assert len(KNOWN_PROJECTS) > 0
    assert 'AIKeep24' in KNOWN_PROJECTS
