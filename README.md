# Context Keeper

AI 대화 맥락을 자동으로 요약·분류·저장하는 오픈소스 도구.

## 문제

- AI 대화가 코딩/질문/잡담이 뒤섞인 채로 저장됨
- 긴 대화에서 AI가 앞부분을 잊어버림
- 나중에 "그때 그 대화"를 찾을 수 없음

## 해결

- Chunked Summary로 구간별 요약
- 로컬 LLM(EXAONE 3.5 + Ollama)으로 비용 0
- 브라우저 확장으로 실시간 감지·저장

## 기술 스택

Cloudflare D1/Workers/R2, Ollama, Chrome Extension

## 라이선스

TBD
