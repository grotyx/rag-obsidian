# RAG Obsidian — 슬라이드 콘텐츠 플랜 (재설계)

design.md 비주얼 시스템 + slide-content-prompt.md §4 템플릿 적용. 발표자 고정:
**박상민 / 분당서울대학교병원 정형외과**. 17 슬라이드. → [build_deck.py](build_deck.py)로 빌드.

**재설계 원칙 (처음 보는 사람 기준):** 추상 설명 전에 **구체적인 것부터 보여준다**.
공감되는 문제 → 한 줄 아이디어 → **실제 노트·실제 흐름을 눈으로** → 기능 → 작동(비유와 함께)
→ 왜 다른가 → 검증 → 써보기 → 결론. 경쟁 비교·아키텍처 잔가지는 뒤로 미루고 전문용어는 비유로 푼다.

---

```yaml
- slide: 1
  type: cover
  title: "RAG Obsidian"
  label_pill: "OBSIDIAN PLUGIN"
  subtitle_1: "내 논문 서재가 그대로 AI 검색엔진이 된다"
  subtitle_2: "Obsidian 위에서 · 내 컴퓨터 안에서 · 답은 늘 출처와 함께"
  repo: "github.com/grotyx/rag-obsidian"          # 커버에 노출
  conference: "연구실 세미나  |  2026.06"          # 발표 맥락에 맞게 수정

- slide: 2
  section: OPENING
  type: big-message
  pattern: G
  headline: "답은 술술 나오는데, 출처가 가짜다"
  body:
    big_lines: ["답은 술술 나오는데", "출처가 가짜다"]
    subline: "AI에 물으면 그럴듯한 답 — 인용은 지어낸 것. 정작 내 서재는 뜻으로 못 뒤진다."

- slide: 3
  section: BACKGROUND
  type: content
  pattern: "two-problem (2 outline cards)"
  headline: "AI는 출처를 지어내고, 내 노트는 뜻으로 못 찾는다"
  body:
    left:  {label: "AI 챗봇에 물으면",  problem: "답은 그럴듯한데 인용이 가짜다", detail: "없는 DOI를 지어내고, 출처를 확인할 수 없다"}
    right: {label: "내 노트·PDF를 뒤지면", problem: "단어가 같아야 겨우 찾힌다",   detail: "뜻이 같아도 표현이 다르면 놓친다 — 의미로 못 찾는다"}
    takeaway: "필요한 건 — 내 서재 안에서, 뜻으로 찾아, 진짜 출처와 함께 답하는 도구"

- slide: 4
  section: THE IDEA
  type: big-message
  pattern: G
  headline: "내 논문 서재가 곧 검색엔진이다"
  body:
    big_lines: ["내 논문 서재가", "곧 검색엔진이다"]
    subline: "논문 1편 = 노트 1개. 그 노트들이 그대로 AI가 답하는 근거가 된다 — Zotero도, 서버도 없이."

- slide: 5
  section: HOW · 데이터
  type: content
  pattern: "note-mock (실제 .md + 주석 3개)"
  headline: "노트 한 개가 곧 데이터베이스의 한 줄이다"
  body:
    note: "References/lecun2015deep.md — frontmatter(title·author·issued·DOI…) + ## Abstract 본문"
    annotations:
      - "① 파일 이름 = 인용키 (노트 한 개 = 논문 한 편)"
      - "② 맨 위 = 메타데이터 (저자·연도·DOI를 표준 CSL-JSON 형식으로 — EndNote가 숨겨 두는 걸 평문으로)"
      - "③ 본문 = 검색·채팅이 읽는 글 (초록·메모·메인 텍스트)"
    takeaway: "이 평범한 .md 파일 하나 = 데이터베이스의 한 줄. 플러그인을 지워도 내 데이터는 남는다."
  source: "References/ 폴더의 마크다운 노트"

- slide: 6
  section: HOW · 흐름
  type: content
  pattern: "workflow (4-step, 화살표)"
  headline: "붙여넣기 한 번이면 출처 달린 답까지 간다"
  body:
    steps:
      - {n: 1, title: "DOI 붙여넣기",   ex: "10.1038/nature14539"}
      - {n: 2, title: "노트 자동 생성", ex: "lecun2015deep.md · 제목·저자·초록 자동 채움 ✓"}
      - {n: 3, title: "서재에 질문",     ex: "“표현 학습이 뭐였지?”"}
      - {n: 4, title: "출처 달린 답",   ex: "“…계층적 표현을 학습한다 [1]” · [1] LeCun 2015 → 노트"}
    takeaway: "붙여넣기 → 노트 → 질문 → 출처 달린 답. 서버 없이, 내 컴퓨터 안에서 한 흐름으로."
  source: "실제 사용 흐름 예시"

- slide: 7
  section: FEATURES
  type: content
  pattern: H
  headline: "한 플러그인 안에 네 가지: 서재·검색·채팅·그래프"
  body:
    pillars:
      - {tag: "LIBRARY", big: "서재",   sub: "Zotero 대체", body: "DOI/PMID/arXiv → 마크다운 노트"}
      - {tag: "SEARCH",  big: "검색",   sub: "단어+뜻",     body: "하이브리드 + 메타데이터 필터"}
      - {tag: "CHAT",    big: "채팅",   sub: "근거 기반",   body: "구절 인용 [n] → 서식 출처"}
      - {tag: "GRAPH",   big: "그래프", sub: "OpenAlex",   body: "관련 · 놓친 논문"}
    takeaway: "추가로: PDF 임포트 · @인용 자동완성 · 참고문헌 자동생성 · 온톨로지(분류체계) 팩"

- slide: 8
  section: HOW · 검색
  type: content
  pattern: F
  headline: "검색은 단어와 뜻을 함께 본다"
  body:
    layers:
      - {band: "단어로", text: "정확한 용어 매칭 — 똑똑해진 Ctrl+F (BM25)"}
      - {band: "뜻으로", text: "의미가 가까우면 매칭 — 'MI'로 검색해도 'myocardial infarction'을 찾음 (벡터 임베딩)"}
      - {band: "+ 필터", text: "저자·연도·저널로 좁히기 (노트 맨 위 메타데이터)"}
    takeaway: "단어 + 뜻 + 메타데이터를 한 번에 — 전부 로컬·무료. 필요하면 인용 그래프로 확장."
  source: "하이브리드 검색 · 임베딩 provider 3종"

- slide: 9
  section: HOW · 채팅
  type: content
  pattern: F
  headline: "모든 답은 내 서재의 진짜 구절을 인용한다"
  body:
    layers:
      - {band: "① 검색", text: "질문 → 내 서재에서 관련 구절만 회수 (서재 밖은 보지 않음)"}
      - {band: "② 근거", text: "LLM이 그 구절로만 답하고, 문장마다 [n] 표시 — 출처 없는 주장 금지"}
      - {band: "③ 인용", text: "[n] → APA·Vancouver 서식으로, 클릭하면 원문 노트로 이동"}
    takeaway: "슬라이드 2의 '가짜 인용' 문제 해결 — 모든 [n]은 내 서재의 진짜 구절"
  source: "근거 기반(RAG) 채팅 파이프라인"

- slide: 10
  section: HOW · 그래프
  type: content
  pattern: C
  headline: "인용 그래프가 '내가 놓친 논문'을 찾아준다"
  body:
    columns:
      claim: "OpenAlex 인용 데이터로 서재의 '인용 지도'를 그린다"
      bullets:
        - "내 논문들이 서로 인용하는 관계 = 지도의 선"
        - "여러 번 인용되는데 내겐 없는 논문 = 놓친 논문"
        - "다음에 뭘 읽을지 — LLM 비용 0으로"
      evidence: "graph.png: 보유 4편(●) + 놓친 논문(○ 점선, 9편 발굴 중 4편 표시)"
    takeaway: "실데이터: 4편만 넣어도 핵심 누락 논문 9편 자동 발굴"
  source: "테스트 vault 4편 · OpenAlex (2.5억 편) 라이브"

- slide: 11
  section: WHY DIFFERENT
  type: content
  pattern: E
  headline: "서지 도구도 AI 도구도 못 하던 일을 한 번에"
  body:
    table:
      cols: ["기능", "서지 플러그인", "AI/RAG 플러그인", "RAG Obsidian"]
      rows:
        - ["의미(뜻) 검색", "✗", "✓", "✓"]
        - ["저자·연도 필터", "✓", "✗", "✓"]
        - ["구절 단위 인용", "✗", "✗ (노트 단위)", "✓"]
        - ["서식 참고문헌", "일부", "✗", "✓"]
        - ["인용 그래프", "✗", "✗", "✓"]
        - ["Zotero 불필요", "✗", "—", "✓"]
      highlight: "마지막 열 전체"
  source: "Smart Connections 5.1k★ · Copilot 7.1k★ · Citation 1.3k★"

- slide: 12
  section: VALIDATION
  type: content
  pattern: B
  headline: "40개 통합검증, 실제 API·데이터로 전부 통과"
  body:
    kpis:
      - {value: "40", label: "통합검증 통과 (실패 0)"}
      - {value: "0",  label: "백엔드/서버"}
      - {value: "9", label: "놓친 논문 발굴 (실데이터)"}
      - {value: "19p", label: "실 PDF 추출 · 72K자"}
    chart: {kind: bar, note: "단계별 검증 분포 — 메타fetch·색인·채팅·그래프·PDF·인용·온톨로지"}
    takeaway: "live Crossref·PubMed·OpenAlex + Orama + pdfjs 실검증"
  source: "npm test · 통합 하니스 40 checks"

- slide: 13
  section: ROADMAP
  type: content
  pattern: J
  headline: "Phase 0부터 5까지, 각 단계가 따로도 쓸모 있다"
  body:
    milestones:
      - {year: "P0", label: "서지관리\nDOI→노트"}
      - {year: "P1", label: "의미 검색\nOrama"}
      - {year: "P2", label: "근거 채팅"}
      - {year: "P3", label: "PDF\n임포트"}
      - {year: "P4", label: "인용\n그래프"}
      - {year: "P5", label: "작성 지원\n참고문헌"}
    takeaway: "향후: 풀 CSL(citeproc) 스타일 · 온톨로지 검색확장 · 모바일 QA"
  source: "v0.4.0 · github.com/grotyx/rag-obsidian"

- slide: 14
  section: GET STARTED
  type: content
  pattern: "try-it (3-step 설치 + URL 바)"
  headline: "Obsidian만 있으면 오늘부터 시작"
  body:
    steps: ["Obsidian 설치", "RAG Obsidian 플러그인 활성화", "임베딩·LLM 키 설정"]
    repo_bar: "github.com/grotyx/rag-obsidian"      # 크게 강조
    status: "현재 v0.4.0 · 개발 빌드로 사용 중 · 공개 배포 예정"
    takeaway: "Obsidian만 있으면 오늘부터 — 내 서재가 답하기 시작한다"

- slide: 15
  section: HOW TO USE
  type: content
  pattern: "usage-steps (5행: 동작 · 명령 · 결과)"
  headline: "쓰는 법은 다섯 동작이 전부다"
  body:
    rows:
      - {act: "논문 추가",     cmd: "Cmd+P → “Add reference by DOI / PMID / arXiv”", res: "DOI·PMID 붙여넣기 → References/에 노트 자동 생성"}
      - {act: "뜻으로 검색",   cmd: "“Search library (semantic)” (리본: 돋보기)",     res: "단어+뜻 하이브리드 검색, 저자·연도로 좁히기"}
      - {act: "서재에 질문",   cmd: "“Chat with library” (리본: 말풍선)",             res: "출처 [n] 달린 답 — [n] 클릭하면 원문 노트로"}
      - {act: "글 쓰며 인용",  cmd: "본문에서 @ 입력",                                res: "제목·저자로 골라 [@citekey] 자동완성 삽입"}
      - {act: "참고문헌 생성", cmd: "“Update bibliography in current note”",          res: "## References를 저널 스타일(APA·Vancouver·CSL)로 자동 생성"}
    takeaway: "전부 Cmd+P 한 곳에서 — 처음 딱 한 번 “Rebuild search index”로 색인만 만들어 두면 끝"
  source: "명령 팔레트 = Cmd/Ctrl+P · 'RAG'만 쳐도 전부 검색됨"

- slide: 16
  section: CONCLUSION
  type: content
  pattern: H
  headline: "Zotero 없이, 서버 없이, 늘 출처와 함께"
  body:
    pillars:
      - {tag: "OWN YOUR DATA", big: "마크다운", sub: "= 내 DB",   body: "평문·git·로컬 우선, 플러그인보다 오래 남음"}
      - {tag: "GROUNDED",      big: "근거",     sub: "구절 인용", body: "출처 없는 답 없음 · 서식 참고문헌까지"}
      - {tag: "GRAPH-LITE",    big: "그래프",   sub: "놓친 논문", body: "OpenAlex 인용엣지 · LLM 비용 0"}
    takeaway: "내 서재가 곧 검색엔진이고, 답은 늘 출처와 함께 — RAG Obsidian"

- slide: 17
  type: closing
  headline: "Thank you"
  subline: "Questions & discussion"
  repo: "github.com/grotyx/rag-obsidian"
```
