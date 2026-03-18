# AIKeep24 Dev Context

> 다음 세션 시작 시 AI에게 이 문서를 읽게 하세요.
> "dev 브랜치 코드 읽고, docs/dev-context.md도 읽어줘"

## 브랜치 전략
- **main**: 공개 버전. README와 코드 일치. CPY 버튼 없음.
- **dev**: 개인 개발 버전. CPY 버튼 포함. 크롬 확장은 로컬 로드이므로 dev에서 작업.
- 공개할 때: main에 merge + README 업데이트.

## 버튼 구조 (dev 브랜치, content.js createUI)
- **RUN** (#86efac 초록): 수동 요약. 길게 누르면 확장 리로드.
- **INJ** (#93c5fd 파랑): 맥락 주입. 짧게=Light, 길게=Full.
- **CPY** (#ffd166 노랑): 최근 AI 응답의 코드블록 일괄 복사. (dev만)
- **BRW** (#c4a7e7 보라): 프로젝트 탐색 + 이전 세션 맥락 주입.

## Genspark DOM 구조
- AI 응답: `.conversation-item-desc` (user 클래스 없는 것)
- 사용자: `.conversation-item-desc.user`
- 코드블록: `<pre><code class="hljs hljs language-{lang}">`
- Genspark 자체 Copy: `<button class="hljs-copy-button">Copy</button>` — code 내부 첫 자식
- 코드블록 텍스트 앞에 "Copy" 문자열 포함 → 추출 시 `.textContent.replace(/^Copy/, '').trim()` 필요
- MutationObserver 타겟: `.conversation-content` || `.chat-wrapper` || `document.body`
- 채팅 ID: URL의 `?id=` 파라미터

## 핵심 아키텍처
- 턴 감지: MutationObserver → checkForNewTurns() (1초 디바운스)
- 청크 분할: 20턴 단위 (CONFIG.TURNS_PER_CHUNK)
- 요약: Ollama localhost:11434 → EXAONE 3.5 7.8B
- 저장: 청크 완료 즉시 Worker → D1 + Vectorize(bge-m3, 1024d)
- 자동 트리거: 2분 idle 또는 50턴 미저장 시
- Worker URL: https://aikeep24-web.hugh79757.workers.dev

## 파일 크기 (dev 기준)
- content.js: ~43KB, ~910 lines (CPY 포함)
- background.js: ~6KB, ~171 lines
- worker.js: ~744 lines (검색 UI 포함)
- manifest.json: MV3, genspark.ai 매칭

## 논의된 향후 방향 (미구현)
- 로컬 HTTP 서버로 프로젝트 파일을 확장에서 읽어 세션 시작 시 전체 코드 컨텍스트 주입
- Claude Code 대체 워크플로우: BRW(맥락 주입) → 대화 → CPY(코드 복사) → 실행 → 피드백 → 자동 저장
- Phase 4 로드맵: 멀티 플랫폼, 프로젝트 메모리, 내보내기, 세션 삭제/편집, 로컬 전용 모드

## 작업 규칙
- 수정 전 반드시 백업: cp content.js content.js.bak
- 절대경로 사용
- 확인 → 분석 → 수정 → 검증 순서
- zsh 호환: heredoc은 `cat > /tmp/script.py << 'EOF'` 패턴
