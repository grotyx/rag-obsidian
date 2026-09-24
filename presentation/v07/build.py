#!/usr/bin/env python3
"""Build the 0.7 talk from slides.py: slides.json, script.md, talk.md and deck.html.

    python3 presentation/v07/build.py

`sec` (seconds on screen) is the recorded narration plus the video's lead/tail silence when
video/narration-check.json has the clip, else an estimate (5 Korean syllables a second, 0.35 s an
English word, plus a beat). Remotion and the deck's auto-play use the same number.
"""
import json
import os
import re

from slides import SLIDES

HERE = os.path.dirname(os.path.abspath(__file__))
SYLLABLES_PER_SEC = 5.0
MIN_SEC, BEAT = 2.5, 0.8


WORD_SEC = 0.35  # an English/Latin word (Biportal, PubMed, myocardial …) spoken in a Korean sentence
NARRATION = os.path.join(HERE, "video", "narration-check.json")
LEAD, TAIL = 0.35, 0.65  # silence around each clip in the video (video/render.mjs)


def estimate(say: str) -> float:
    latin = re.findall(r"[A-Za-z][A-Za-z0-9.+-]*", say)
    rest = re.sub(r"[A-Za-z][A-Za-z0-9.+-]*", "", say)
    syllables = len(re.sub(r"[\s.,·!?—()\"'~:;]", "", rest))
    return syllables / SYLLABLES_PER_SEC + len(latin) * WORD_SEC


def seconds(slide_id: int, say: str, narrated: dict) -> float:
    """Seconds on screen: the real narration length when it exists (so the deck's auto-play and
    Remotion match the video), otherwise an estimate from the text."""
    if slide_id in narrated:
        return round(LEAD + narrated[slide_id] + TAIL, 1)
    return round(max(MIN_SEC, estimate(say) + BEAT), 1)


def screen_text(s: dict) -> str:
    """What is on screen, as one line (for the script and the plan)."""
    k = s["kind"]
    if k in ("say", "end"):
        return s["text"].replace("\n", " ")
    if k == "cover":
        return s["title"].replace("\n", " ")
    if k == "section":
        return f"§{s['no']} {s['title']}"
    if k == "num":
        return f"{s['n']} {s['label']}"
    if k == "vs":
        return f"✕ {s['bad']}  →  {s['good']}"
    if k == "eq":
        return f"{s['a']} → {s['b']}"
    if k in ("steps", "list"):
        return " · ".join(s["items"])
    if k == "note":
        return "노트 예시 (frontmatter + Summary + Notes)"
    if k == "cite":
        return f"Q. {s['q']}  A. {s['a']}"
    if k == "funnel":
        return " → ".join(f"{n} {l}" for n, l in s["rows"])
    if k == "url":
        return s["url"]
    if k == "qa":
        return f"Q. {s['q']}"
    return k


def main() -> None:
    narrated = {}
    if os.path.exists(NARRATION):
        for c in json.load(open(NARRATION, encoding="utf-8")).get("clips", []):
            if c.get("ok") and c.get("sec"):
                narrated[c["id"]] = c["sec"]
    slides = []
    for i, s in enumerate(SLIDES, 1):
        slides.append({"id": i, **s, "sec": seconds(i, s["say"], narrated)})

    with open(os.path.join(HERE, "slides.json"), "w", encoding="utf-8") as f:
        json.dump(slides, f, ensure_ascii=False, indent=1)

    main_slides = [s for s in slides if s["section"] != "부록"]
    total = sum(s["sec"] for s in main_slides)

    # script.md — what is said, slide by slide
    out = [
        "# 대본 — 내 서재를 evidence database로",
        "",
        f"본편 {len(main_slides)}장 · 말하는 시간 약 {total / 60:.0f}분 (쉬는 시간 빼고). "
        f"부록 {len(slides) - len(main_slides)}장은 질문이 나올 때만.",
        "",
        "`slides.py`에서 생성됨 — 고칠 때는 slides.py를 고치고 `python3 build.py`.",
        "",
    ]
    section = None
    for s in slides:
        if s["section"] != section:
            section = s["section"]
            out += [f"## {section}", ""]
        out += [f"**{s['id']}. {screen_text(s)}** · {s['sec']}초", "", s["say"], ""]
    with open(os.path.join(HERE, "script.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out))

    # talk.md — the plan
    by_section: dict[str, list[dict]] = {}
    for s in main_slides:
        by_section.setdefault(s["section"], []).append(s)
    plan = [
        "# 발표 내용 — 내 서재를 evidence database로",
        "",
        "Academic Paper Citation Manager 0.7 소개 발표. 대본은 [script.md](script.md), 화면은 "
        "[deck.html](deck.html), 원본 데이터는 [slides.py](slides.py).",
        "",
        "## 한 문장",
        "",
        "> **출처 없는 문장은 정확하지 않다 — 내 서재를 evidence database로 만들어 정확한 근거를 찾게 한다.**",
        "",
        "## 청중",
        "",
        "- 논문을 많이 읽고 쓰는 임상의·대학원생. 코딩은 몰라도 된다.",
        "- Obsidian·Zotero는 들어봤고, AI는 써봤다. 그 이상은 가정하지 않는다.",
        "",
        "## 구성 원칙",
        "",
        "- **한 장에 한 가지.** 화면에는 가운데 한 문장이나 숫자 하나. 설명은 말로 한다.",
        "- **장수는 많게, 넘김은 빠르게.** 평균 몇 초에 한 장. 숫자는 한 장에 하나씩 보여 준다.",
        "- **구체 → 추상.** 통증 → 노트가 어떻게 생겼는지 → 한 편의 흐름 → 실제 guideline 숫자.",
        "- **실제 숫자로 설득.** Biportal endoscopy guideline: 1,605 → 1,139 → 830 → 609 → 1,366 → 33.",
        "- **과장하지 않는다.** AI 결과는 초안이고 결정은 사람이 한다는 점을 따로 한 장으로 말한다.",
        "- **의학·연구 용어는 영어로.** Biportal endoscopy, dural tear, abstract, full text, evidence table, guideline.",
        "- **한글 문장은 humanize-korean(im-not-ai) 규칙으로 윤문.** 연결어미 뒤 쉼표를 빼고 합쇼체 안에서 종결을 섞었다. "
        "숫자·고유명사·서법은 그대로 — 변경률 5.5%, 구조 게이트(P0–P5) 통과.",
        "",
        "## 흐름과 시간",
        "",
        "| 막 | 장 | 초 | 이 막이 남길 것 |",
        "|---|---:|---:|---|",
    ]
    goals = {
        "표지": "무엇에 대한 발표인지",
        "문제": "AI의 가짜 인용, 뜻으로 못 찾는 서재 — 두 통증",
        "아이디어": "논문 1편 = 노트 1개, 그 노트가 답의 근거",
        "흐름": "넣기 → 요약 → 찾기 → 묻기 → 쓰기 → 놓친 논문",
        "실전": "Guideline 하나를 실제 숫자로 — 그리고 결정은 사람",
        "AI 동료": "AI 에이전트가 서재를 직접, 안전하게 다룬다",
        "비교": "Zotero가 하던 일 + 그 너머, 언제든 내보내기",
        "시작": "세 단계와 주소",
        "마무리": "한 문장",
    }
    for sec_name, items in by_section.items():
        t = sum(s["sec"] for s in items)
        plan.append(f"| {sec_name} | {len(items)} | {t:.0f} | {goals.get(sec_name, '')} |")
    plan += [
        f"| **합계** | **{len(main_slides)}** | **{total:.0f}** | 말하는 시간 약 {total / 60:.0f}분 — 전환·호흡을 더해 10–12분 |",
        "",
        "## 슬라이드",
        "",
        "| # | 막 | 종류 | 화면 | 초 |",
        "|---:|---|---|---|---:|",
    ]
    for s in slides:
        plan.append(f"| {s['id']} | {s['section']} | {s['kind']} | {screen_text(s)} | {s['sec']} |")
    plan += [
        "",
        "## 운영",
        "",
        "- `deck.html`: ←/→·스페이스로 넘김, **P** 자동 재생(슬라이드별 초), **N** 대본 보기, "
        "**G** 전체 목록, **F** 전체 화면.",
        "- 부록(Q&A 3장)은 질문이 나올 때만 띄운다.",
        "- 숫자 여섯 장(1,605 … 33)은 빠르게 넘긴다 — 쌓이는 느낌이 요점이다. 다음 장 깔때기에서 한 번에 다시 본다.",
        "- '근거가 없으면 없다고'는 채팅 프롬프트의 지시(출처에 답이 없으면 그렇다고 말하라, 인용을 지어내지 말라)를 "
        "설명하는 것 — 보장이라고 말하지 않는다.",
        "",
        "## 영상 (video/)",
        "",
        "- `video/narrate.mjs`: 본편 대본을 OpenRouter의 MiniMax Speech 2.8 HD(Korean_CalmGentleman)로 읽힌다. 요청은 "
        "실행 중인 Obsidian 안에서 플러그인이 가진 키로 보내므로 키가 밖으로 나오지 않는다. 숫자는 한글로 풀어 읽히고"
        "(1,139 → 천백삼십구), PubMed·OpenRouter는 띄어 써서 보낸다. 화면과 자막은 원래 표기 그대로.",
        "- 장마다 Gemini로 받아써서 대본과 대조한다(판정: 빠짐·덧붙임·잘림·다른 단어로 들리는 발음). 통과할 때까지 최대 3번 다시 생성, "
        "결과는 `video/narration-check.json`.",
        "- `video/render.mjs`: deck.html을 headless Chrome에서 1920×1080으로 띄우고, CSS transition을 멈춘 채 1/30초씩 "
        "옮기며 프레임을 캡처한다(형광펜·등장·깔때기 애니메이션 그대로). 장 길이 = 0.35초 + 음성 + 0.65초, 프레임 단위로 맞춤. "
        "음성은 WAV로 이어 한 번에 인코딩하고 −14 LUFS로 맞춘다. 결과: `talk.mp4`, `captions.srt`, `chapters.txt`, 썸네일.",
        "- 유튜브 업로드 자료(제목·설명·챕터·태그): `video/youtube.md`.",
        "- 다시 만들 때: `node video/narrate.mjs`(바뀐 장만: `ONLY=12,34`) → `python3 build.py` → `node video/render.mjs`.",
        "",
        "## Remotion으로 옮길 때",
        "",
        "- `slides.json`의 한 항목 = 한 `<Sequence>`. 길이는 `sec × fps` 프레임, 시작은 앞 항목들의 합.",
        "- `kind`마다 컴포넌트 하나 (cover, section, say, num, vs, eq, steps, list, note, cite, funnel, url, qa, end). "
        "필드 이름은 deck.html과 같다.",
        "- `say`는 자막 또는 TTS 원고로 그대로 쓴다.",
        "- 애니메이션 값은 deck.html의 CSS 변수와 같게: 등장 420ms ease-out, 요소 간 90ms 간격, "
        "형광펜(`hl`)은 350ms 뒤 600ms 동안 왼쪽→오른쪽으로 칠해짐, 깔때기 막대는 순서대로 늘어남.",
        "- 색·글꼴도 deck.html의 토큰(:root)을 그대로 옮긴다.",
        "",
    ]
    with open(os.path.join(HERE, "talk.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(plan))

    # deck.html — template + data
    with open(os.path.join(HERE, "deck.template.html"), encoding="utf-8") as f:
        tpl = f.read()
    data = json.dumps(slides, ensure_ascii=False).replace("</", "<\\/")
    with open(os.path.join(HERE, "deck.html"), "w", encoding="utf-8") as f:
        f.write(tpl.replace("/*SLIDES*/[]", data))

    print(f"{len(slides)} slides ({len(main_slides)} main) · {total:.0f}s spoken · built slides.json, script.md, talk.md, deck.html")


if __name__ == "__main__":
    main()
