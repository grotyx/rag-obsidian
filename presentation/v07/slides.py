"""The one source of truth for the 0.7 talk.

Every slide carries what is on screen (few words, centered) and `say` — what the speaker says
while it is up. build.py turns this list into slides.json (read by deck.html now and by the
Remotion composition later), script.md (the spoken script) and talk.md (the talk plan).

Kinds (each is one visual template in deck.html):
  cover    title, sub, meta
  section  no, title                      — act divider
  say      text, hl?, small?              — one statement; `hl` is the phrase the highlighter sweeps
  num      n, label                       — one big figure
  vs       bad, good                      — two options, the second one wins
  eq       a, b                           — "a finds b"
  steps    items                          — 2–4 steps with arrows
  list     items, title?                  — at most 3 short items
  note     lines                          — a mock reference note
  cite     q, a, src                      — a question and an answer with [n] anchors
  funnel   rows                           — shrinking counts
  url      url, sub
  qa       q, a                           — appendix, only when asked
  end      text, sub

Naming rule for this project: never write the abbreviation for the technique. Medical and research
terms stay in English inside the Korean text (owner's preference, 2026-09-24): Biportal endoscopy,
dural tear, abstract, full text, evidence table, guideline, systematic review.
"""

SLIDES = [
    # ── 0 · 표지 ─────────────────────────────────────────────────────────────
    dict(kind="cover", section="표지",
         title="내 서재를\nevidence database로",
         sub="출처가 붙는 AI 논문 서재 — Obsidian 플러그인",
         meta="Academic Paper Citation Manager · v0.7.7",
         say="안녕하세요. 오늘은 제가 만든 Obsidian 플러그인 Academic Paper Citation Manager를 소개합니다. 한 문장으로 줄이면 내 논문 서재를 evidence database로 만들어, AI가 내 논문을 근거로 답하게 하는 도구입니다."),

    # ── 1 · 문제 ─────────────────────────────────────────────────────────────
    dict(kind="section", section="문제", no="1", title="문제",
         say="먼저 문제부터 볼게요."),
    dict(kind="say", section="문제", text="논문,\n몇 편이나 읽으세요?",
         say="질문 하나 드리겠습니다. 한 주제로 논문을 몇 편이나 읽어보셨어요?"),
    dict(kind="num", section="문제", n="1,605", label="편 — guideline 하나에 검색된 논문",
         say="저는 최근 Biportal endoscopy guideline을 만들었습니다. PubMed에서 검색된 논문이 "
             "1,605편이었습니다."),
    dict(kind="say", section="문제", text="다 읽을 수\n있을까요?", hl="다",
         say="이걸 사람이 다 읽을 수 있을까요? 솔직히 불가능합니다."),
    dict(kind="say", section="문제", text="그래서\nAI에게 묻습니다",
         say="그래서 요즘은 AI에게 묻죠."),
    dict(kind="say", section="문제", text="답은\n술술 나옵니다",
         say="답은 정말 술술 나옵니다. 문장도 매끄럽고 인용까지 달려 있어요."),
    dict(kind="say", section="문제", text="그 논문,\n실제로 있나요?", hl="실제로",
         say="그런데 인용된 논문을 찾아보면 없는 경우가 있습니다. 저자도 저널도 그럴듯한데 존재하지 않는 논문이죠."),
    dict(kind="vs", section="문제", bad="그럴듯한 가짜 인용", good="내가 가진 진짜 논문",
         say="우리가 원하는 건 그럴듯한 가짜 인용이 아니라 내가 가진 진짜 논문을 근거로 한 답입니다."),
    dict(kind="say", section="문제", text="문제가\n하나 더 있습니다",
         say="문제가 하나 더 있습니다."),
    dict(kind="say", section="문제", text="내 서재는\n뜻으로 못 찾는다", hl="뜻",
         say="Zotero나 EndNote에 논문을 천 편 넣어둬도 단어가 정확히 맞지 않으면 찾지 못합니다. MI로 검색하면 myocardial infarction이 나오지 않잖아요."),
    dict(kind="say", section="문제", text="쌓아둔 논문이\n일하지 않는다",
         say="쌓아둔 논문이 저를 위해 일하지 않는 셈입니다."),

    # ── 2 · 아이디어 ──────────────────────────────────────────────────────────
    dict(kind="section", section="아이디어", no="2", title="아이디어",
         say="그래서 생각을 바꿨습니다."),
    dict(kind="say", section="아이디어", text="내 서재를\n검색 엔진으로", hl="검색 엔진",
         say="내 서재 자체를 검색 엔진으로 만들자."),
    dict(kind="say", section="아이디어", text="논문 1편 = 노트 1개",
         say="방법은 단순해요. 논문 한 편이 Obsidian 노트 한 개가 됩니다."),
    dict(kind="note", section="아이디어",
         lines=[
             "---",
             "title: Biportal endoscopic lumbar decompression…",
             "author: [Kim, Park, Lee]",
             "issued: 2023",
             "DOI: 10.xxxx/…",
             "PMID: \"3xxxxxxx\"",
             "tags: [spinal-stenosis, endoscopy]",
             "---",
             "## Summary",
             "Background · Methods · Results · Conclusions",
             "## Notes",
             "내 메모",
         ],
         say="노트는 이렇게 생겼습니다. 맨 위에 저자, 연도, DOI, PMID가 표준 서지 형식으로 들어갑니다. 그 아래로 AI가 쓴 structured summary와 제 메모."),
    dict(kind="say", section="아이디어", text="그냥\n텍스트 파일입니다",
         say="그냥 텍스트 파일, 마크다운이에요. 특별한 데이터베이스는 쓰지 않습니다."),
    dict(kind="list", section="아이디어", items=["서버 없음", "계정 없음", "내 폴더에 그대로"],
         say="서버도 계정도 필요 없습니다. 논문 정보는 전부 내 컴퓨터 폴더에 남아요. 프로그램을 지워도 파일은 그대로입니다."),
    dict(kind="say", section="아이디어", text="그 노트가\nAI 답의 근거", hl="근거",
         say="이 노트들이 그대로 AI가 답할 때의 근거가 되죠."),

    # ── 3 · 흐름 ─────────────────────────────────────────────────────────────
    dict(kind="section", section="흐름", no="3", title="흐름",
         say="한 편이 어떻게 들어가서 답이 되는지 따라가 보겠습니다."),
    dict(kind="steps", section="흐름", items=["DOI 붙여넣기", "노트 생성", "질문", "출처 달린 답"],
         say="DOI를 붙여넣으면 노트가 생기고 질문하면 출처 달린 답이 나옵니다. 이게 전부예요."),
    dict(kind="list", section="흐름", title="넣는 길",
         items=["DOI · PMID", "PubMed 검색", "PDF · Zotero 파일"],
         say="논문을 넣는 길은 여러 가지입니다. DOI나 PMID를 붙여넣어도 되고 플러그인 안에서 PubMed를 검색해도 됩니다. PDF를 넣거나 Zotero·EndNote에서 내보낸 파일을 그대로 가져와도 되고요."),
    dict(kind="say", section="흐름", text="넣으면\nAI가 요약합니다",
         say="넣으면 AI가 Background, Methods, Results, Conclusion으로 나눠 요약합니다. 원문이 공개된 논문은 full text를 읽고 아니면 abstract를 읽어요."),
    dict(kind="say", section="흐름", text="주제 태그는\nMeSH로", hl="MeSH",
         say="주제 태그는 PubMed의 MeSH 용어로 자동으로 붙습니다. 그래서 Obsidian 그래프에서 주제별로 뭉쳐 보이죠."),
    dict(kind="say", section="흐름", text="검색은\n단어와 뜻을 함께", hl="뜻",
         say="검색은 두 가지를 동시에 봅니다. 정확한 단어와 뜻."),
    dict(kind="eq", section="흐름", a="MI", b="myocardial infarction",
         say="그래서 MI로 검색해도 myocardial infarction 논문이 잡힙니다."),
    dict(kind="cite", section="흐름",
         q="어떤 complication이 보고됐나?",
         a="Dural tear와 postoperative hematoma가 주로 보고됐다 [1][2].",
         src=["[1] 내 서재의 노트 → 결과 구절", "[2] 내 서재의 노트 → 결과 구절"],
         say="질문하면 답의 문장마다 번호가 붙습니다. 번호를 누르면 내 서재에 있는 논문의 실제 구절로 가요. 화면은 예시입니다."),
    dict(kind="say", section="흐름", text="근거가 없으면\n없다고", hl="없다고",
         say="서재에 근거가 없으면 없다고 말하도록, 인용은 지어내지 않도록 지시되어 있습니다."),
    dict(kind="say", section="흐름", text="쓸 때는\n@ 한 번", hl="@",
         say="논문을 쓸 때는 골뱅이를 치면 인용이 자동완성돼요."),
    dict(kind="say", section="흐름", text="저널 스타일은\n한 줄",
         say="참고문헌 형식은 저널 이름 한 줄로 바뀝니다. 만 개가 넘는 CSL 스타일을 알아서 받아오죠."),
    dict(kind="say", section="흐름", text="투고는\nWord로", hl="Word",
         say="투고용 Word 파일로도 바로 내보냅니다."),
    dict(kind="say", section="흐름", text="놓친 논문도\n찾아줍니다", hl="놓친",
         say="마지막은 인용 그래프입니다. 내 논문들이 여러 번 인용하는데 내 서재에는 없는 논문, 제가 놓친 핵심 논문을 찾아줘요."),

    # ── 4 · 실전 ─────────────────────────────────────────────────────────────
    dict(kind="section", section="실전", no="4", title="실전: Guideline",
         say="이제 실제로 써본 이야기입니다."),
    dict(kind="say", section="실전", text="Biportal endoscopy\nguideline",
         say="Biportal endoscopy clinical practice guideline을 이 도구로 만들었습니다."),
    dict(kind="num", section="실전", n="1,605", label="편 검색",
         say="PubMed 검색으로 1,605편을 모았습니다. 월 단위로 나눠 스크립트가 넣었어요."),
    dict(kind="num", section="실전", n="1,139", label="편 screening",
         say="범위를 정리하고 1,139편을 screening했습니다."),
    dict(kind="num", section="실전", n="830", label="편 포함",
         say="Abstract를 기준으로 830편을 포함했죠."),
    dict(kind="num", section="실전", n="609", label="편 full text 요약",
         say="그중 full text를 구한 609편은 AI가 구조화해서 요약했습니다."),
    dict(kind="num", section="실전", n="1,366", label="줄 evidence table",
         say="요약에서 evidence table 1,366줄을 뽑았고요."),
    dict(kind="num", section="실전", n="33", label="개 합의 질문",
         say="그리고 패널이 투표할 합의 질문 33개가 나왔습니다."),
    dict(kind="funnel", section="실전",
         rows=[["1,605", "검색"], ["1,139", "Screening"], ["830", "포함"], ["609", "Full text 요약"], ["33", "합의 질문"]],
         say="한눈에 보면 이렇습니다. 1,605편에서 33개 질문까지."),
    dict(kind="say", section="실전", text="PRISMA flow diagram도\n자동으로", hl="PRISMA",
         say="Systematic review에 필요한 PRISMA flow diagram도 플러그인이 숫자를 세서 그려줍니다."),
    dict(kind="say", section="실전", text="Screening은\n키보드로 한 편씩",
         say="사람이 직접 screening할 때는 한 편씩 abstract를 봅니다. I는 포함, E는 제외. 키보드로 판정해요."),
    dict(kind="say", section="실전", text="AI는 초안,\n결정은 사람", hl="사람",
         say="AI가 만든 건 초안입니다. 포함 여부도 권고도 최종 결정은 패널이 합니다."),

    # ── 5 · AI 동료 ───────────────────────────────────────────────────────────
    dict(kind="section", section="AI 동료", no="5", title="AI 동료",
         say="이번 작업에서 가장 크게 달라진 점이에요."),
    dict(kind="say", section="AI 동료", text="AI가\n서재를 직접 다룬다", hl="직접",
         say="Claude Code나 Codex 같은 AI 에이전트가 제 서재를 직접 읽고 쓸 수 있습니다."),
    dict(kind="steps", section="AI 동료", items=["AI가 찾고 요약", "플러그인이 저장", "내가 확인"],
         say="AI가 PubMed를 찾고 요약을 쓰면 저장은 플러그인이 안전하게 맡습니다. 저는 결과를 확인하고요."),
    dict(kind="say", section="AI 동료", text="내 컴퓨터 안에서만",
         say="이 연결은 내 컴퓨터 안에서만 열리고 접속 토큰으로 보호됩니다. 노트를 고칠 때는 그사이 바뀌지 않았는지 먼저 확인합니다."),
    dict(kind="say", section="AI 동료", text="API 키 없이\n로그인으로", hl="로그인",
         say="ChatGPT의 Codex나 OpenCode에 이미 로그인해 있다면 별도 API 키 없이 그 로그인으로 요약과 채팅을 돌릴 수 있습니다."),

    # ── 6 · 무엇이 다른가 ──────────────────────────────────────────────────────
    dict(kind="section", section="비교", no="6", title="무엇이 다른가",
         say="그럼 기존 도구와 무엇이 다를까요."),
    dict(kind="say", section="비교", text="Zotero가 하던 일은\n그대로",
         say="Zotero나 EndNote가 하던 일은 그대로 합니다."),
    dict(kind="list", section="비교", items=["중복 병합", "철회 논문 표시", "무료 PDF 받기"],
         say="중복 논문을 합치고 철회된 논문을 표시하고 무료로 공개된 PDF를 한꺼번에 받아와요."),
    dict(kind="say", section="비교", text="그리고\n그 너머", hl="너머",
         say="그리고 그걸 넘어섭니다."),
    dict(kind="list", section="비교", items=["뜻으로 찾기", "출처 달린 답", "Screening · PRISMA"],
         say="뜻으로 찾고 출처 달린 답을 받습니다. Screening과 PRISMA까지 한 곳에서 하죠."),
    dict(kind="say", section="비교", text="언제든\n내보낼 수 있습니다",
         say="그리고 언제든 내보낼 수 있습니다. BibTeX, RIS, CSL-JSON 형식을 모두 지원합니다. 데이터는 처음부터 "
             "제 파일이었으니까요."),

    # ── 7 · 시작 ─────────────────────────────────────────────────────────────
    dict(kind="section", section="시작", no="7", title="시작",
         say="시작하는 방법입니다."),
    dict(kind="steps", section="시작", items=["Obsidian 설치", "플러그인 검색", "키 하나"],
         say="세 단계면 됩니다. Obsidian을 설치하고 Community plugins에서 이 플러그인을 검색해 설치한 다음 OpenRouter 키 하나만 넣으면 끝이에요."),
    dict(kind="url", section="시작", eyebrow="Community plugins",
         url="community.obsidian.md/plugins/\nacademic-paper-citation-manager",
         sub="코드: github.com/grotyx/rag-obsidian · 무료 · MIT 라이선스",
         say="Obsidian 공식 Community plugins에 올라가 있습니다. 코드는 GitHub에 전부 공개돼 있고 무료, MIT 라이선스예요."),

    # ── 8 · 마무리 ────────────────────────────────────────────────────────────
    dict(kind="say", section="마무리", text="출처 없는 문장은\n정확하지 않습니다", hl="출처",
         say="마지막으로 한 문장만 기억해 주세요. 출처 없는 문장은 정확하지 않습니다."),
    dict(kind="say", section="마무리", text="내 서재를\nevidence database로", hl="evidence database",
         say="이 플러그인은 내 서재를 evidence database로 만들어 정확한 근거를 찾게 합니다."),
    dict(kind="end", section="마무리", text="감사합니다", sub="community.obsidian.md/plugins/academic-paper-citation-manager",
         say="감사합니다."),

    # ── 부록 · 질문이 나오면 ───────────────────────────────────────────────────
    dict(kind="qa", section="부록", q="인터넷 없이도 되나요?",
         a="노트와 검색은 내 컴퓨터에서.\nAI 요약·채팅은 고른 제공자로 전송.\nOllama를 쓰면 전부 로컬.",
         say="노트와 검색 색인은 내 컴퓨터에 있습니다. AI 요약과 채팅은 제가 고른 제공자로 보냅니다. Ollama를 쓰면 전부 로컬에서 돌아가요."),
    dict(kind="qa", section="부록", q="내 데이터는 어디에 있나요?",
         a="vault 폴더의 마크다운 파일.\n서버·계정·사용 기록 전송 없음.",
         say="전부 제 vault 폴더의 마크다운 파일입니다. 플러그인에는 서버도 계정도 사용 기록 전송도 없어요."),
    dict(kind="qa", section="부록", q="AI가 틀리면요?",
         a="답의 번호마다 원문 구절로 확인.\n최종 판단은 사람이.",
         say="답의 번호마다 원문 구절로 바로 확인할 수 있습니다. 그래도 최종 판단은 사람이 합니다."),
]
