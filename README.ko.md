# Academic Paper Citation Manager

[![version](https://img.shields.io/badge/version-0.4.13-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed)](https://obsidian.md)

[English](README.md) · **한국어**

> Obsidian용 AI 네이티브 **인용 관리 도구** — PubMed 검색, AI 요약, 주제 자동 태깅,
> 저널 스타일 인용까지. **마크다운 노트가 곧 데이터베이스**인 Zotero / EndNote 대체.

모든 레퍼런스는 [CSL-JSON](https://citationstyles.org/) frontmatter를 가진 평범한 `.md`
노트라, 라이브러리가 이식성 있고 미래에도 안전하며 온전히 내 것입니다. 외부 앱·계정·
백엔드 필요 없이 vault 하나로 끝.

---

## ✨ 기능

**📥 수집**
- Obsidian 안에서 **PubMed 키워드 검색** → 논문 선택 → 노트.
- **DOI / PMID / arXiv**, 또는 **논문 제목**으로 추가 (자동 조회).
- 기존 라이브러리 **임포트** — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON**.

**🧠 AI 요약**
- LLM이 **섹션별 영어 요약**(Background / Methods / Results / Conclusions)과
  **간결한 한글 요약**을 각 노트에 작성.
- open access 논문은 **본문 전체**(PubMed Central), 그 외는 abstract 기반.

**🏷️ 정리**
- 모든 노트에 **MeSH 주제 태그** 자동 부여 → Obsidian **그래프 뷰**에서 주제별로 묶임.
- **인용 그래프**(OpenAlex): 라이브러리 내 인용/피인용, *"자주 인용되는데 빠진 논문"* 추천.
- 읽기 상태, **대시보드**, 중복 찾기, 인용수, 철회 확인.

**✍️ 인용·집필**
- `@` 입력 → 자동완성으로 `[@citekey]` 삽입.
- **"Update bibliography"**가 실제 **저널 스타일**(citeproc-js / CSL)로 `## References`
  생성; in-text 표시도 그에 맞춤(`[1]`, 위첨자, 또는 저자–연도).
- 노트의 `csl:` frontmatter로 **논문별 스타일** 지정.
- **Compile manuscript** → 인용이 풀린 사본 → **`.docx`** 변환.

**🔎 검색·챗**
- 하이브리드 **의미 검색**(BM25 + 벡터) + 라이브러리 근거 기반 **챗** (`[n]` 출처).

---

## 📦 설치

> 아직 커뮤니티 플러그인 스토어에 없어서 Obsidian 플러그인 검색에는 나오지 않습니다.
> 편한 방법을 고르세요 — **방법 A는 터미널이 필요 없습니다.**

### 방법 A — BRAT (권장: 설치와 자동 업데이트)

[BRAT](https://github.com/TfTHacker/obsidian42-brat)은 GitHub에서 바로 플러그인을 설치하고
새 릴리스가 나오면 자동으로 갱신해 줍니다.

1. Obsidian → **설정 → 커뮤니티 플러그인** → 탐색 → **BRAT** 설치 후 활성화
2. 명령 팔레트(`Ctrl/Cmd-P`) → **BRAT: Add a beta plugin for testing**
3. `grotyx/rag-obsidian` 붙여넣기 → **Add plugin**
4. **설정 → 커뮤니티 플러그인**에서 **Academic Paper Citation Manager** 활성화

### 방법 B — 릴리스 파일 내려받기 (터미널·BRAT 없이)

[최신 릴리스](https://github.com/grotyx/rag-obsidian/releases/latest)에서 `main.js`,
`manifest.json`, `styles.css` 세 파일을 받아 아래 폴더에 넣습니다(없으면 만드세요).

```text
<보관함>/.obsidian/plugins/rag-obsidian/
```

Obsidian을 새로고침한 뒤 **설정 → 커뮤니티 플러그인**에서 활성화합니다. 업데이트하려면
세 파일을 다시 받으면 됩니다.

### 방법 C — 직접 빌드

[Node.js 18+](https://nodejs.org) 와 [git](https://git-scm.com) 필요.

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# .env 편집 → VAULT_PLUGIN_DIR 를 <내 vault>/.obsidian/plugins/rag-obsidian 로

npm run deploy              # 빌드 + 플러그인을 vault로 복사
```

이후 Obsidian: **Settings → Community plugins → 플러그인 활성화** → 다시 로드(`Ctrl/Cmd-R`).

### 방법 D — 클라우드 동기화 vault (둘째 PC는 빌드 불필요)

vault가 OneDrive / iCloud / Dropbox / Obsidian Sync에 있으면 빌드된 플러그인이 vault
**안에**(`<vault>/.obsidian/plugins/rag-obsidian/`) 같이 따라옵니다. 다른 PC에선 동기화된
vault를 열고 활성화만 — Node·빌드 불필요.

---

## 🚀 빠른 시작 (5분)

1. Obsidian **다시 로드**(`Ctrl/Cmd-R`) 후 플러그인 활성화 확인.
2. **AI provider 설정** — Settings → 플러그인 탭 → 아래 **Provider** 참고.
3. **논문 추가** — 리본 **🔍 Search PubMed** → 주제 입력 → 결과 선택 → **Add**.
   각각 AI 요약 + 주제 태그가 달린 `References/` 노트가 됨.
4. **집필·인용** — 아무 노트에서 `@` 입력 → 레퍼런스 선택 → `[@citekey]`.
5. **참고문헌** — `Ctrl/Cmd-P` → **Update bibliography** → 선택한 저널 스타일로
   `## References` 생성.

> 인용 워크플로는 **임베딩이 필요 없습니다.** 의미 검색·챗은 선택이며, 한 번
> **Rebuild search index**가 필요합니다.

---

## ⚙️ Provider

모두 Obsidian `requestUrl` 경유 (데스크톱·모바일):

**설치 직후 채팅과 임베딩 모두 OpenAI 호환 프로바이더가 OpenRouter를 향하도록 맞춰져 있습니다.**
키 하나로 채팅·논문 요약·임베딩이 전부 돌아가고, 로컬에 설치할 것도 없습니다. 키만 넣으면 끝이고
나머지는 선택입니다.

> OpenRouter 모델 id에는 공급자 접두어가 붙습니다(`openai/…`, `deepseek/…`). base URL을
> `https://api.openai.com/v1`로 바꿔 OpenAI에 직접 붙어도 되며, 그때는 접두어를 뺍니다.

- **LLM**(챗 + 요약): OpenAI / 호환(기본) · Anthropic · Ollama(로컬). *Chat model*은 선택 항목으로,
  **Chat with library** 답변에만 기본 모델 대신 적용됩니다. 논문 요약과 PDF 메타데이터 추출은
  기본 모델을 그대로 쓰므로, 답변 품질이 중요한 채팅에만 더 좋은 모델을 지정할 수 있습니다.
- **임베딩**(검색 + 챗): Ollama(로컬) · OpenAI / 호환 · Transformers.js.

**OpenRouter 사용 시?** 채팅과 임베딩 모두 **OpenAI** provider를 고르면 됩니다. 키 하나, base URL 하나:

| 설정 | 값 |
|---|---|
| 채팅 / 임베딩 provider | `OpenAI` |
| OpenAI base URL (공용) | `https://openrouter.ai/api/v1` |
| 채팅 모델 | OpenRouter 모델 id, 예: `deepseek/deepseek-v4-flash` |
| 임베딩 모델 | `openai/text-embedding-3-small` |
| OpenAI API 키 | OpenRouter 키 ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Google Gemini 사용 시?** **OpenAI** provider를 고르고 base URL을 Google로:

| 설정 | 값 |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (공유) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenAI API key | Gemini 키 ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ 논문 쓰기 (Zotero / Word 플러그인 없이)

```text
Obsidian:  Manuscript.md 작성  →  @ 로 인용  →  저널 지정: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"   →  Manuscript (compiled).md
터미널:    node scripts/to-docx.cjs "Manuscript (compiled).md"   →  서식 .docx (Pandoc 필요)
```

- **Compile manuscript**가 모든 `[@citekey]`를 저널 형식 in-text로 풀고 `## References`를
  붙임 — Pandoc / 제출 준비 완료.
- `scripts/to-docx.cjs`(또는 manuscript-docx 워크플로)가 Times New Roman 12pt,
  더블스페이스, 검정 `.docx`로 렌더.

---

## 🎨 인용 스타일

참고문헌·in-text 표시는 **citeproc-js**(Zotero와 동일 엔진)로 CSL-JSON에서 렌더.

- **전역:** Settings → *Bibliography style (CSL)*. 오프라인 번들: **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. 또는 아무 스타일 id(`nature`,
  `the-lancet` 등) 입력 → [CSL 저장소](https://github.com/citation-style-language/styles)에서
  받아 캐시.
- **논문별:** 노트 frontmatter에 `csl:` 추가 → 전역 설정을 덮어씀.

```yaml
---
csl: springer-basic-brackets
---
```

| 저널 | `csl:` 값 |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| 그 외 | CSL 저장소의 아무 id |

---

## 🧰 명령

| 그룹 | 명령 |
|---|---|
| **추가** | Search PubMed · DOI / PMID / arXiv / 제목 추가 · Import(BibTeX / RIS / nbib / CSL-JSON) · Import PDF |
| **독서** | 읽기 상태(unread / reading / read) · Reading queue · OA PDF 찾기 · OA PDF 다운로드 · PDF 형광펜 추출 · 온라인으로 열기 |
| **정리** | 요약·태그 일괄 채우기 · 이 참고문헌 다시 요약 · 옛 모델로 만든 요약 다시 생성 · 대시보드 · 중복 찾기 · 인용수 채우기 · 철회 확인 · 태그 변경 · 메타데이터 보강 · 관련 논문 추천 · 인용 네트워크 내보내기 |
| **집필** | `@` 자동완성 · Update bibliography · Compile manuscript · 인용 복사 · 주석 참고문헌 · 최근 챗 답변을 노트로 저장 |
| **검색** | 의미 검색 · 챗 · 관련 논문 · 인덱스 재생성 |
| **내보내기** | 라이브러리 → BibTeX / RIS / CSL-JSON |

---

## 🛠️ 개발자용

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # 빌드 + vault로 복사 (.env의 VAULT_PLUGIN_DIR)
npm run build      # tsc + esbuild production
npm test           # 라이브 통합 테스트 (69개 체크)
```

헬퍼 스크립트 (터미널, Obsidian 불필요) — 경로는 `.env`에서:

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → 서식 .docx
```

모듈 맵은 [`CLAUDE.md`](./CLAUDE.md), 설계 노트는 [`PLAN.md`](./PLAN.md) 참고.

---

## ⚠️ 참고 & 한계

- **플러그인 id는 `rag-obsidian` 유지** (폴더 / `data.json` 키). 표시 이름만
  "Academic Paper Citation Manager".
- 파일명은 **읽기 쉬움**(`2022-SpineJ-ParkSM-Biportal.md`); frontmatter의 짧은
  `citekey:`가 `[@cite]` 핸들.
- `.docx` 변환은 **Pandoc** 필요; PDF 형광펜 추출은 주석이 있는 PDF 필요.
- Obsidian Properties 패널이 중첩 CSL frontmatter에 경고할 수 있음 — 데이터는 유효함.
- 설정의 **Contact e-mail**을 채워 두세요. OpenAlex·Unpaywall·PubMed가 같이 쓰는 값이고,
  오픈액세스 PDF 조회는 이 값이 없으면 동작하지 않습니다.
- `styles/`의 번들 CSL 스타일은 CC BY-SA 3.0 (`styles/README.md` 참고); 플러그인 코드는 MIT.

## 👤 저자

**박상민 교수 (Sang-Min Park, M.D., Ph.D.)**
서울대학교 의과대학 · 분당서울대학교병원 정형외과
(Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine)
🌐 [sangmin.me](https://sangmin.me/)

## 📄 라이선스

MIT (플러그인 코드). 번들 CSL 스타일/locale은 CC BY-SA 3.0 유지.
