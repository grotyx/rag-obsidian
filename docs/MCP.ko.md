# Claude Code / Codex MCP 연결

[English](MCP.md) · **한국어**

Academic Paper Citation Manager 0.5.0부터 Claude Code와 Codex가 실행 중인 Obsidian vault를
직접 검색하고 Markdown 노트를 관리할 수 있습니다. 외부 AI가 논문을 찾고 초안을 쓰며,
플러그인은 라이브러리·검색 인덱스·인용 엔진과 안전한 파일 작업을 MCP 도구로 제공합니다.

## 동작 방식

```text
Claude Code / Codex
        │ MCP stdio
        ▼
mcp-bridge.cjs (Node 표준 라이브러리만 사용)
        │ 인증된 127.0.0.1 요청
        ▼
실행 중인 Obsidian 플러그인
        ├─ 라이브러리 / PubMed / 검색 인덱스
        ├─ Markdown 생성·수정·이동·휴지통
        └─ citeproc 원고 컴파일
```

- Obsidian Desktop이 열려 있고 해당 vault의 플러그인이 활성화되어 있어야 합니다.
- MCP 경로는 Obsidian의 **Chat with library LLM, 요약 LLM, LLM reranker를 호출하지 않습니다.**
  답변 작성과 판단은 Claude Code 또는 Codex가 담당합니다.
- `search_library`와 `rebuild_search_index`만 설정된 임베딩 공급자를 사용할 수 있습니다.
- 별도 daemon, 계정, 원격 MCP 서버는 없습니다. 로컬 서버는 `127.0.0.1`의 임의 포트에서만
  열리고 플러그인 종료 시 함께 닫힙니다.
- MCP 기능은 데스크톱 전용입니다. 나머지 플러그인 기능과 모바일 지원은 그대로 유지됩니다.

## 연결하기

1. Obsidian Desktop에서 사용할 vault를 엽니다.
2. **Settings → Academic Paper Citation Manager → External AI (MCP)** 로 이동합니다.
3. **Enable MCP access**를 켭니다.
4. 같은 화면에서 Claude Code 명령 또는 Codex 설정을 복사합니다.
5. 외부 클라이언트를 다시 시작하거나 MCP 서버 목록을 새로 고칩니다.

설정 화면의 복사 버튼을 쓰는 것이 가장 안전합니다. 경로에 공백이나 따옴표가 있어도 현재
vault에 맞게 escape된 값을 만듭니다. 수동 설정 형식은 다음과 같습니다.

### Claude Code

```bash
claude mcp add --transport stdio rag-obsidian -- node '/absolute/path/to/mcp-bridge.cjs' --vault '/absolute/path/to/vault'
```

확인은 Claude Code에서 `/mcp`를 열거나 다음 명령을 사용합니다.

```bash
claude mcp list
```

### Codex

Codex 설정 파일에 아래 항목을 추가합니다. 실제 경로는 설정 화면에서 복사하십시오.

```toml
[mcp_servers.rag-obsidian]
command = "node"
args = ["/absolute/path/to/mcp-bridge.cjs", "--vault", "/absolute/path/to/vault"]
```

한 클라이언트에 여러 vault를 연결하려면 이름을 `research-vault`, `teaching-vault`처럼 서로
다르게 하고 각 vault에서 복사한 bridge/vault 경로를 사용합니다.

## 권장 사용 흐름

### 기존 논문을 근거로 답변 받기

```text
Obsidian 라이브러리에서 척추 내시경 수술의 재입원 위험 요인을 찾아줘.
먼저 library_status를 확인하고, 필요하면 search_library를 여러 번 사용해.
근거가 있는 주장마다 반환된 citekey로 [@citekey]를 붙이고 사용한 논문 목록도 보여줘.
```

### PubMed에서 찾아 저장하기

```text
PubMed에서 2023년 이후 cervical myelopathy frailty 논문을 찾아줘.
search_pubmed 결과를 먼저 표로 보여주고 아직 저장되지 않은 항목은 내가 선택한 뒤
명시적인 PMID로 add_reference를 호출해. 저장 후 search_library로 확인해줘.
```

`add_reference`는 제목 같은 모호한 입력을 받지 않습니다. DOI, `PMID:12345`, arXiv ID,
OpenAlex work ID처럼 명시적인 식별자만 허용하므로 잘못된 논문이 자동 저장되는 것을 줄입니다.

### 인용 가능한 초안 쓰기

```text
Manuscripts/Review.md를 읽고 "Outcomes" 절을 보강해줘.
관련 근거는 search_library로 찾고 [@citekey]를 사용해.
수정 직전에 read_note로 최신 hash를 받은 다음 replace_in_note로 정확히 한 부분만 바꿔.
마지막에 compile_manuscript로 인용이 렌더링된 사본을 만들어줘.
```

## 제공 도구

| 도구 | 역할 | 외부 호출/변경 |
|---|---|---|
| `library_status` | vault, 플러그인 버전, 인덱스 상태 확인 | 없음 |
| `search_library` | Obsidian과 같은 BM25+벡터 인덱스 검색 | 임베딩 가능, 읽기 전용 |
| `rebuild_search_index` | 검색 인덱스 전체 재구축 | 임베딩 가능, 인덱스 변경 |
| `list_references` | 문헌 메타데이터 필터·페이지 조회 | 읽기 전용 |
| `get_reference` | citekey로 메타데이터와 노트 조회 | 읽기 전용 |
| `list_tags` | 문헌 태그와 개수 조회 | 읽기 전용 |
| `search_pubmed` | PubMed 검색 | 네트워크, 읽기 전용 |
| `add_reference` | 명시적 식별자로 문헌 노트 추가 | 네트워크, 노트 생성 |
| `list_notes` | vault의 Markdown 노트 목록 조회 | 읽기 전용 |
| `read_note` | 노트를 구간별로 읽고 SHA-256 hash 반환 | 읽기 전용 |
| `create_note` | 새 Markdown 노트와 상위 폴더 생성 | 노트 생성 |
| `update_note` | hash가 일치할 때 노트 전체 교체 | 노트 수정 |
| `replace_in_note` | 정확히 한 번 나타나는 문자열만 교체 | 노트 수정 |
| `move_note` | Obsidian API로 노트 이동·이름 변경 | 노트 이동 |
| `trash_note` | 노트를 Obsidian 휴지통으로 이동 | 복구 가능한 삭제 |
| `compile_manuscript` | `[@citekey]`와 참고문헌을 렌더링한 사본 생성 | 출력 노트 생성/갱신 |

## 수정과 삭제의 안전 규칙

- 접근 대상은 vault 내부의 `.md` 파일뿐입니다. 절대 경로, `..`, URL-encoded traversal,
  Obsidian 설정 폴더는 거부합니다.
- 심볼릭 링크는 실제 경로까지 확인합니다. vault 밖을 가리키면 목록·검색·읽기·쓰기에서 제외됩니다.
- `create_note`는 기존 파일을 덮어쓰지 않습니다.
- 수정·이동·휴지통 작업은 `read_note`가 돌려준 전체 노트 SHA-256 `hash`가 필요합니다.
  다른 창이나 동기화가 내용을 바꾸면 `CONTENT_CHANGED`로 중단되므로 다시 읽은 뒤 판단해야 합니다.
- `replace_in_note`의 `old_text`가 0번 또는 2번 이상 나타나면 중단됩니다.
- `move_note`는 목적지가 있으면 중단되며 Obsidian의 링크 업데이트 설정을 따릅니다.
- `trash_note`는 영구 삭제하지 않고 Obsidian의 설정에 따른 휴지통으로 보냅니다. 외부 AI
  클라이언트의 destructive-tool 승인 화면도 확인하십시오.
- 읽기는 한 번에 최대 50,000자, 쓰기는 최대 2,000,000자로 제한됩니다.
- 동시에 들어온 변경은 순서대로 처리됩니다.

## 인증과 로컬 파일

활성화할 때마다 256-bit 임시 token을 만들고, bridge가 읽는 discovery 파일을 운영체제의
임시 폴더에 권한 `0600`으로 저장합니다. token은 Claude/Codex 설정에 기록되지 않습니다.
**Restart and rotate token**은 기존 연결을 끊고 token을 교체합니다. **Stop server** 또는
플러그인 비활성화는 discovery 파일을 지우고 포트를 닫습니다.

생성되는 `mcp-bridge.cjs`는 플러그인 폴더에 있으며 Node 표준 라이브러리만 사용합니다.
vault 내용, API key, MCP token을 로그로 출력하지 않습니다. 같은 사용자 계정에서 임시 파일과
프로세스를 읽을 수 있는 악성 프로그램까지 방어하는 보안 경계는 아닙니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| bridge가 Obsidian을 찾지 못함 | 정확한 vault가 Obsidian Desktop에 열려 있고 MCP가 켜져 있는지 확인 후 재시작 |
| `ECONNREFUSED` 또는 인증 실패 | 설정에서 **Restart and rotate token**, 외부 클라이언트 재시작 |
| `INDEX_NOT_READY` | 임베딩 설정 확인 후 `rebuild_search_index` 호출 |
| `CONTENT_CHANGED` | `read_note`로 다시 읽고 새 hash와 내용을 검토한 뒤 재시도 |
| `INVALID_PATH` | vault 상대 `.md` 경로인지, 설정 폴더/외부 심볼릭 링크가 아닌지 확인 |
| `ALREADY_EXISTS` | 새 경로를 사용하거나 기존 출력은 읽어서 `expected_output_hash` 전달 |
| PubMed 제한/오류 | 플러그인 설정의 PubMed API key와 contact e-mail 확인 |
| 모바일에서 MCP가 보이지 않음 | 의도된 동작입니다. MCP 서버는 Obsidian Desktop에서만 실행됩니다. |

연결을 완전히 제거하려면 Claude Code/Codex에서 `rag-obsidian` MCP 항목을 삭제하고 Obsidian의
**Enable MCP access**를 끄면 됩니다.
