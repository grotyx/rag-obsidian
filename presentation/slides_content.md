# RAG Obsidian — 슬라이드 콘텐츠 플랜

design.md 비주얼 시스템 + slide-content-prompt.md §4 템플릿 적용. 발표자 고정:
**박상민 / 분당서울대학교병원 정형외과**. 14 슬라이드. → [build_deck.py](build_deck.py)로 빌드.

---

```yaml
- slide: 1
  type: cover
  title: "RAG Obsidian"
  subtitle: "내 서재가 답하는 AI 서지관리 — Obsidian 네이티브 · 로컬 우선 · 인용 근거"
  label_pill: "RESEARCH TOOL"
  conference: "연구실 세미나  |  2026.06"   # 발표 맥락에 맞게 수정

- slide: 2
  section: OPENING
  type: big-message
  headline: "검색은 되는데, 근거가 안 붙는다"
  pattern: G
  body:
    big_lines: ["서재는 늘어나는데", "답에는 출처가 없다"]
    subline: "Obsidian은 노트를 찾아주지만, 어느 논문·어느 구절인지는 말해주지 않는다"

- slide: 3
  section: BACKGROUND
  type: content
  headline: "서지 플러그인과 AI 플러그인은 서로를 모른다"
  pattern: C
  body:
    columns:
      claim: "Obsidian 생태계는 두 세계로 갈라져 있다"
      bullets:
        - "서지: Citation·Zotero Integration·ZotLit — 키워드뿐, Zotero 의존"
        - "AI: Smart Connections·Copilot·Khoj — 서지를 모름, 노트 단위 인용"
        - "교집합(의미검색+메타데이터+구절 인용)은 비어 있음"
      evidence: "diagram: 두 원(서지 / AI)이 겹치지 않는 벤다이어그램, 가운데 빈 교집합"
    takeaway: "둘 다 반쪽 — 서지는 AI가 없고, AI는 서지를 모른다"
  source: "Obsidian community plugins, 2026 조사"

- slide: 4
  section: BACKGROUND
  type: content
  headline: "둘을 잇는 다리는 아무도 안 놓았다 — 그게 빈틈"
  pattern: E
  body:
    table:
      cols: ["", "서지 플러그인", "AI/RAG 플러그인", "RAG Obsidian"]
      rows:
        - ["의미 검색", "✗", "✓", "✓"]
        - ["메타데이터 패싯", "✓", "✗", "✓"]
        - ["구절 단위 인용", "✗", "✗(노트 단위)", "✓"]
        - ["서식 참고문헌", "일부", "✗", "✓"]
        - ["인용 그래프", "✗", "✗", "✓"]
        - ["Zotero 불필요", "✗", "—", "✓"]
      highlight: "마지막 열 전체"
    takeaway: "RAG Obsidian = 두 세계의 빈 교집합을 정확히 채움"
  source: "기능 비교 · Smart Connections 5.1k★ / Copilot 7.1k★ / Citation 1.3k★"

- slide: 5
  section: THE IDEA
  type: big-message
  headline: "마크다운이 곧 데이터베이스다"
  pattern: G
  body:
    big_lines: ["논문 1편 = 노트 1개", "CSL-JSON frontmatter"]
    subline: "Zotero 없이, 백엔드 없이 — git으로 diff되는 평문이 진실의 원천"

- slide: 6
  section: ARCHITECTURE
  type: content
  headline: "한 장으로 보는 구조: 노트 → 색인 → 근거 답변"
  pattern: A
  body:
    diagram: "data-flow: [DOI/PMID/arXiv·PDF] → References/*.md(CSL-JSON) → 청크(contextual prefix) → 임베딩 → Orama 하이브리드 색인 → [검색·근거채팅·인용그래프] ; OpenAlex → 인용그래프"
    note: "전부 TypeScript 플러그인 안에서 · 로컬 우선 · requestUrl로 외부 API"
  source: "RAG Obsidian v0.1.0 아키텍처"

- slide: 7
  section: FEATURES
  type: content
  headline: "네 가지가 한 플러그인에: 서재·검색·채팅·그래프"
  pattern: H
  body:
    pillars:
      - {tag: "LIBRARY", big: "서재", sub: "Zotero 대체", body: "DOI/PMID/arXiv → CSL-JSON 노트"}
      - {tag: "SEARCH", big: "검색", sub: "하이브리드", body: "BM25+벡터 · 메타데이터 필터"}
      - {tag: "CHAT", big: "채팅", sub: "근거 기반", body: "구절 [n] → 서식 인용"}
      - {tag: "GRAPH", big: "그래프", sub: "OpenAlex", body: "관련 · 놓친 논문"}
    takeaway: "추가로: PDF 임포트 · @인용 자동완성 · 참고문헌 생성 · 온톨로지 팩"

- slide: 8
  section: HOW IT WORKS · 검색
  type: content
  headline: "검색은 싼 것부터 — 하이브리드, 필요하면 그래프"
  pattern: F
  body:
    layers:
      - {band: "Tier 0", text: "하이브리드(BM25+벡터) + frontmatter 패싯 — 로컬, LLM 비용 0"}
      - {band: "Tier 1", text: "OpenAlex 인용 그래프 1-hop 확장 — 무료·구조화, GraphRAG-lite"}
      - {band: "Tier 2+", text: "선택: 재랭킹 · 온톨로지 IS_A 확장 (필요할 때만)"}
    takeaway: "개인 서재엔 풀 GraphRAG 과함 — 인용엣지가 더 싸고 정확"
  source: "검색 아키텍처 · Orama 하이브리드 · 임베딩 provider 3종"

- slide: 9
  section: HOW IT WORKS · 그래프
  type: content
  headline: "인용 그래프가 '내가 놓친 논문'을 찾아준다"
  pattern: C
  body:
    columns:
      claim: "OpenAlex referenced_works로 내 서재의 인용 지형을 그린다"
      bullets:
        - "내 논문이 서로 인용하는 엣지 (예: 2015 → 1997·1998)"
        - "공동 인용(coupling)으로 비슷한 논문 묶기"
        - "내 서재가 ≥2회 인용하지만 없는 논문 = 놓친 논문"
      evidence: "graph: 4 노드(보유) + 점선 노드(놓친 10편), 굵기=인용횟수"
    takeaway: "실데이터: 보유 4편 → 놓친 논문 10편 자동 발굴 (LLM 비용 0)"
  source: "테스트 vault 4편 · OpenAlex 라이브"

- slide: 10
  section: HOW IT WORKS · 채팅
  type: content
  headline: "모든 답은 구절 단위 출처와 함께 나온다"
  pattern: F
  body:
    layers:
      - {band: "검색", text: "질문 → 관련 구절 top-K 회수 (서재 안에서만)"}
      - {band: "근거", text: "LLM이 [n] 앵커로 인용 — 출처 없는 주장 금지"}
      - {band: "인용", text: "[n] → APA/Vancouver/Plain 서식 출처 (클릭→노트)"}
    takeaway: "Anthropic·OpenAI·Ollama 교체 가능 — 답은 항상 서재에 근거"
  source: "근거 채팅 파이프라인 · citeproc 경량 포매터"

- slide: 11
  section: VALIDATION
  type: content
  headline: "40개 통합검증 — 실 API·실데이터로 전부 통과"
  pattern: B
  body:
    kpis:
      - {value: "40", label: "통합검증 통과", delta: "0 실패"}
      - {value: "0", label: "백엔드/서버"}
      - {value: "10", label: "놓친 논문 발굴(실데이터)"}
      - {value: "19p", label: "실 PDF 추출(72K자)"}
    chart: {kind: bar, note: "단계별 검증: 메타fetch·색인·채팅·그래프·PDF·인용·온톨로지 전부 green"}
    takeaway: "live Crossref·PubMed·OpenAlex + Orama + pdfjs 실검증"
  source: "npm test · 통합 하니스 40 checks"

- slide: 12
  section: ROADMAP
  type: content
  headline: "Phase 0에서 5까지, 각 단계가 독립적으로 쓸모"
  pattern: J
  body:
    milestones:
      - {year: "P0", label: "서지관리\nDOI→노트"}
      - {year: "P1", label: "의미 검색\nOrama 색인"}
      - {year: "P2", label: "근거 채팅"}
      - {year: "P3", label: "PDF 임포트"}
      - {year: "P4", label: "인용 그래프"}
      - {year: "P5", label: "작성 지원\n참고문헌"}
    takeaway: "향후: 풀 CSL(citeproc) · 온톨로지 검색확장 · 모바일 QA"
  source: "v0.1.0 · github.com/grotyx/rag-obsidian"

- slide: 13
  section: CONCLUSION
  type: content
  headline: "Zotero 없이, 백엔드 없이, 근거와 함께"
  pattern: H
  body:
    pillars:
      - {tag: "OWN YOUR DATA", big: "마크다운", sub: "= DB", body: "평문·git·로컬 우선, 플러그인보다 오래 남음"}
      - {tag: "GROUNDED", big: "근거", sub: "구절 인용", body: "출처 없는 답 없음 · 서식 참고문헌"}
      - {tag: "GRAPH-LITE", big: "그래프", sub: "놓친 논문", body: "OpenAlex 인용엣지 · LLM 비용 0"}
    takeaway: "서재가 곧 검색엔진이고, 답은 늘 출처와 함께 — RAG Obsidian v0.1.0"

- slide: 14
  type: closing
  headline: "Thank you"
  subline: "Questions & discussion"
```
