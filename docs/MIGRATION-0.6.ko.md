# 0.5.x에서 0.6.0으로 이전

Community directory 규칙에 맞추기 위해 0.6.0부터 Obsidian plugin id가 `rag-obsidian`에서
`academic-paper-citation-manager`로 바뀝니다. GitHub 저장소와 기본 MCP 연결 이름
`rag-obsidian`은 그대로입니다.

## 기존 BRAT 또는 수동 설치

1. vault를 백업하고 plugin을 끈 뒤 Obsidian을 완전히 종료합니다.
2. plugin 폴더 이름을 바꿉니다.

   ```text
   <vault>/.obsidian/plugins/rag-obsidian
   → <vault>/.obsidian/plugins/academic-paper-citation-manager
   ```

   이렇게 하면 `data.json`, `chat.json`, 검색·인용 graph index가 보존됩니다.
3. Obsidian을 다시 엽니다. BRAT이 plugin을 추적하지 못하면 기존 BRAT 항목을 지우고
   `grotyx/rag-obsidian`을 다시 추가합니다. **Academic Paper Citation Manager**를 켭니다.
4. plugin 설정에서 library 폴더와 provider를 확인합니다. SecretStorage가 있는 Obsidian에서는
   0.6.0이 예전 key id의 API key를 새 id로 복사하며, rollback을 위해 예전 복사본은 지우지
   않습니다. provider가 key 누락을 알릴 때만 다시 입력하세요.
5. MCP bridge 경로에는 plugin 폴더명이 들어갑니다. MCP를 켜고 새 Claude Code 명령 또는
   Codex 설정을 복사해 기존 client 항목을 교체한 뒤 client를 다시 시작합니다.

CDN 실행 코드를 없애기 위해 실험적 Transformers.js embedding 옵션을 제거했습니다. 저장된
Transformers.js 선택은 기본 OpenAI 호환 embedding provider로 이전됩니다. key/model을 확인하고
검색 index를 다시 만들거나, local embedding에는 Ollama를 선택하세요.

두 plugin 폴더를 동시에 활성화하지 마세요. 되돌려야 한다면 Obsidian을 종료하고 폴더 이름을
원래대로 바꾸면 됩니다.

## 새 설치

이전 작업은 필요 없습니다. `<vault>/.obsidian/plugins/academic-paper-citation-manager/`에
설치하거나 Community 등록 승인 뒤 directory에서 설치하세요.

0.6.0은 선택적 live MCP 기능에 Node API가 포함되어 데스크톱 전용입니다.
