# YouTube 업로드 자료

복사해서 YouTube Studio의 각 칸에 붙여 넣으면 됩니다.

| 파일 | 용도 |
|---|---|
| `talk.mp4` | 영상 — 1920×1080, 30fps, 6분 52초, 음량 −14 LUFS |
| `thumbnail-a.jpg` | 썸네일 (추천) — "AI가 인용한 논문, 진짜 있나요?" |
| `thumbnail-b.jpg` | 썸네일 (대안) — "그럴듯한 가짜 인용 → 내 논문이 근거" |
| `captions.srt` | 한국어 자막 — 자막 → 추가 → 파일 업로드 → 타이밍 포함 |
| `thumbnail.html` | 썸네일 원본 (`?v=b`로 대안) — 문구를 고쳐 다시 캡처할 때 |

음성: MiniMax Speech 2.8 HD · Korean_CalmGentleman (OpenRouter). 문장마다 받아써서 대본과 대조 — `narration-check.json`.

## 제목 (100자 이내)

추천:

AI가 인용한 논문, 진짜 있나요? 내 서재를 evidence database로 | Obsidian 논문 관리 플러그인

대안:

- 출처 없는 AI 답은 믿지 마세요 — 내 논문만 근거로 답하는 Obsidian 플러그인
- 내 서재를 evidence database로 — Zotero 대신 쓰는 AI 논문 서재 (Obsidian)

## 설명

AI에게 물으면 답은 술술 나오지만, 인용된 논문을 찾아보면 존재하지 않을 때가 있습니다.
Academic Paper Citation Manager는 내가 가진 논문을 Obsidian 노트로 모아 evidence database로 만들고, AI가 답할 때 문장마다 내 서재의 실제 구절을 번호로 붙이는 무료 플러그인입니다.

Biportal endoscopy clinical practice guideline을 만들며 PubMed 1,605편을 검색하고, 1,139편을 screening해 830편을 포함하고, 합의 질문 33개까지 간 과정을 실제 숫자로 보여 드립니다.

▶ 설치: Obsidian → 설정 → 커뮤니티 플러그인 → "Academic Paper Citation Manager" 검색
https://community.obsidian.md/plugins/academic-paper-citation-manager
▶ 코드 (무료, MIT 라이선스): https://github.com/grotyx/rag-obsidian

주요 기능
• DOI · PMID · PubMed 검색 · PDF · Zotero/EndNote 파일로 논문 추가
• AI 구조화 요약(Background · Methods · Results · Conclusions)과 MeSH 주제 태그
• 단어와 뜻을 함께 보는 검색 — MI로 찾아도 myocardial infarction 논문이 잡힘
• 답의 문장마다 출처 번호, 누르면 원문 구절로 이동
• @ 인용 자동완성, 10,000개 이상의 CSL 저널 스타일, Word 내보내기
• Screening 창, PRISMA flow diagram, 중복 병합, 철회 논문 표시, 무료 PDF 받기
• Claude Code · Codex가 MCP로 내 서재를 직접 찾고 요약하고 저장
• 데이터는 내 vault의 마크다운 파일 — 서버·계정 없음, BibTeX · RIS · CSL-JSON으로 언제든 내보내기

챕터
0:00 들어가며
0:15 문제
1:21 아이디어
2:08 흐름
3:49 실전: Guideline
5:00 AI 동료
5:37 무엇이 다른가
6:13 시작
6:36 마무리

#Obsidian #논문관리 #AI

## 태그 (500자 이내)

Obsidian, Obsidian 플러그인, 논문 관리, 서지 관리, 참고문헌 관리, Zotero, EndNote, AI 논문, 논문 요약, 인용, citation manager, evidence database, RAG, PubMed, MeSH, systematic review, 체계적 문헌고찰, PRISMA, screening, guideline, Biportal endoscopy, Claude Code, Codex, MCP

## 세부 설정

- 공개 범위: 공개 (먼저 "일부 공개"로 올려 확인해도 됨)
- 시청자층: 아동용 아님
- 카테고리: 과학기술 (또는 교육)
- 동영상 언어 / 자막 언어: 한국어
- 라이선스: 표준 YouTube 라이선스
- 변경된 콘텐츠(합성 미디어) 공개: **예** — 내레이션이 AI 합성 음성입니다. 실존 인물의 목소리를 흉내 낸 것은 아니지만, 사실처럼 들리는 합성 음성은 표시 대상에 해당할 수 있습니다.
- 퍼가기 허용: 켬
- 재생목록: 필요하면 "Obsidian · 논문 관리"

## 고정 댓글

설치는 Obsidian → 설정 → 커뮤니티 플러그인에서 "Academic Paper Citation Manager"를 검색하면 됩니다.
https://community.obsidian.md/plugins/academic-paper-citation-manager
써 보시고 안 되는 점이나 원하는 기능은 GitHub Issues에 남겨 주세요: https://github.com/grotyx/rag-obsidian/issues

## English (번역된 제목·설명 — 동영상 → 언어 → 번역 추가)

Title: Did the AI cite a real paper? Make your library an evidence database | Obsidian plugin

Description:
AI answers read smoothly, but the papers they cite sometimes do not exist. Academic Paper Citation Manager turns the papers you own into Obsidian notes — an evidence database — and every sentence of an AI answer carries a numbered link to the real passage in your library. Free, open source (MIT), desktop.

Install: Obsidian → Settings → Community plugins → search "Academic Paper Citation Manager"
https://community.obsidian.md/plugins/academic-paper-citation-manager
Code: https://github.com/grotyx/rag-obsidian
