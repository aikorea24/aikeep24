"""AIKeep24 공통 설정 로더"""
import os
from pathlib import Path

def load_env():
    env_paths = [
        Path(__file__).parent.parent.parent / 'backend' / '.env',
        Path(__file__).parent.parent.parent / '.env',
    ]
    for p in env_paths:
        if p.exists():
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip())

load_env()

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_API_GENERATE = OLLAMA_URL + '/api/generate'
OLLAMA_API_TAGS = OLLAMA_URL + '/api/tags'
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'exaone3.5:7.8b')

WORKER_URL = os.getenv('WORKER_URL', 'https://aikeep24-web.hugh79757.workers.dev')
API_KEY = os.getenv('API_KEY', '')

R2_ENDPOINT = os.getenv('R2_ENDPOINT', '')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY', '')
R2_BUCKET = os.getenv('R2_BUCKET', 'obsidian-attachments')

# Known projects
KNOWN_PROJECTS = ['AIKeep24', 'TV-show', 'TAP', 'aikorea24', 'news-keyword-pro', 'KDE-keepalive']
