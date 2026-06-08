#!/usr/bin/env python3
"""Build the RAG Obsidian presentation deck per design.md (SNUBH Spine system).
Charts/diagrams via matplotlib → embedded; 4-zone skeleton + patterns via python-pptx.
Run: python3 build_deck.py  → rag_obsidian_deck.pptx
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
os.makedirs(ASSETS, exist_ok=True)
LOGO = os.path.join(HERE, "logo.png")

# ---------------------------------------------------------------- palette
NEUTRAL_WARM = "f2f0eb"; WHITE = "ffffff"; HOUSE = "1E3932"; STARBUCKS = "006241"
ACCENT = "00754A"; GREEN_LIGHT = "d4e9e2"; UPLIFT = "2B5148"; GOLD = "cba258"
GRAY = "8e8e93"; HAIR = "D9D9D9"; TEXT = "1F1F1F"; TEXT_SOFT = "6B6B6B"
NEUTRAL_COOL = "f9f9f9"; CERAMIC = "edebe9"; RED = "c82014"
FONT = "Pretendard"

def C(h): return RGBColor.from_string(h)

# ================================================================ charts
def build_charts():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.font_manager as fm
    import matplotlib.pyplot as plt
    base = "/Users/sangminpark/Library/CloudStorage/OneDrive-개인/08. Utilities/폰트/Pretendard-1.3.9/public/static/alternative"
    for w in ("Regular", "SemiBold", "Bold"):
        p = os.path.join(base, f"Pretendard-{w}.ttf")
        if os.path.exists(p):
            fm.fontManager.addfont(p)
    plt.rcParams["font.family"] = "Pretendard"
    plt.rcParams["axes.unicode_minus"] = False
    g_acc, g_sb, g_lt, gold, gray = "#00754A", "#006241", "#d4e9e2", "#cba258", "#8e8e93"

    # ---- gap venn (slide 3) ----
    fig, ax = plt.subplots(figsize=(5.2, 4.4), dpi=200)
    from matplotlib.patches import Circle
    ax.add_patch(Circle((0.36, 0.5), 0.34, fill=False, ec=g_acc, lw=3))
    ax.add_patch(Circle((0.64, 0.5), 0.34, fill=False, ec=g_sb, lw=3))
    ax.text(0.27, 0.5, "서지\n플러그인", ha="center", va="center", fontsize=15, color=g_acc, weight="bold")
    ax.text(0.73, 0.5, "AI / RAG\n플러그인", ha="center", va="center", fontsize=15, color=g_sb, weight="bold")
    ax.text(0.5, 0.5, "빈\n교집합", ha="center", va="center", fontsize=13, color=gold, weight="bold")
    ax.text(0.5, 0.075, "의미검색 + 메타데이터 + 구절 인용", ha="center", va="center", fontsize=11, color="#444")
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    fig.tight_layout(pad=0.2); fig.savefig(f"{ASSETS}/gap.png", transparent=True); plt.close(fig)

    # ---- architecture flow (slide 6) ----
    fig, ax = plt.subplots(figsize=(12.0, 4.3), dpi=200)
    from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
    def box(x, y, w, h, label, fc="white", ec=g_acc, tc="#1F1F1F", fs=12, bold=True):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.03",
                     fc=fc, ec=ec, lw=2))
        ax.text(x + w/2, y + h/2, label, ha="center", va="center", fontsize=fs,
                color=tc, weight="bold" if bold else "normal")
    def arrow(x1, y1, x2, y2):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=18,
                     lw=2, color=g_acc))
    pipe = [("입력\nDOI·PMID·arXiv·PDF", 0.01), ("References/*.md\nCSL-JSON 노트", 0.255),
            ("청크\n[제목|섹션|연도]", 0.50), ("임베딩 →\nOrama 하이브리드 색인", 0.745)]
    for label, x in pipe:
        box(x, 0.58, 0.23, 0.30, label, fs=12)
    for i in range(3):
        arrow(pipe[i][1] + 0.23, 0.73, pipe[i+1][1], 0.73)
    outs = [("검색", 0.42), ("근거 채팅", 0.235), ("인용 그래프", 0.05)]
    bus_x = 0.785
    for label, y in outs:
        box(0.81, y, 0.18, 0.13, label, ec=g_sb, fs=12)
    ax.plot([0.86, bus_x], [0.58, 0.58], color=g_acc, lw=2)       # embedding bottom → bus
    ax.plot([bus_x, bus_x], [0.115, 0.58], color=g_acc, lw=2)     # vertical bus
    for label, y in outs:
        arrow(bus_x, y + 0.065, 0.81, y + 0.065)                  # bus → each box (left edge)
    box(0.05, 0.05, 0.18, 0.12, "OpenAlex", fc=g_lt, ec=g_sb, fs=11)
    arrow(0.23, 0.11, 0.81, 0.115)                                # OpenAlex → 인용 그래프
    ax.text(0.5, 0.97, "전부 TypeScript 플러그인 안 · 로컬 우선 · 백엔드 0", ha="center",
            fontsize=12, color=gray, style="italic")
    ax.set_xlim(0, 1.0); ax.set_ylim(0, 1.0); ax.axis("off")
    fig.tight_layout(pad=0.1); fig.savefig(f"{ASSETS}/arch.png", transparent=True); plt.close(fig)

    # ---- citation graph (slide 9) ----
    import networkx as nx
    fig, ax = plt.subplots(figsize=(5.3, 4.5), dpi=200)
    have = {"2015\n딥러닝": (0.5, 0.78), "1998\nLeNet": (0.18, 0.5),
            "1997\nLSTM": (0.5, 0.30), "2017\nAlexNet": (0.84, 0.55)}
    miss = {"놓친 ×3": (0.30, 0.88), "놓친 ×2": (0.10, 0.80),
            "놓친 ×2": (0.74, 0.86), "놓친 ×2b": (0.90, 0.30)}
    edges = [("2015\n딥러닝", "1998\nLeNet"), ("2015\n딥러닝", "1997\nLSTM"),
             ("2017\nAlexNet", "1998\nLeNet")]
    for a, b in edges:
        (x1, y1), (x2, y2) = have[a], have[b]
        ax.plot([x1, x2], [y1, y2], color=g_acc, lw=2, zorder=1)
    for (x, y) in [(0.30, 0.88), (0.10, 0.80), (0.74, 0.86), (0.90, 0.30)]:
        ax.plot([0.5, x], [0.78, y], color=gold, lw=1.2, ls=":", zorder=1)
    for label, (x, y) in have.items():
        ax.scatter([x], [y], s=2400, c="#00754A", edgecolors="white", lw=2, zorder=2)
        ax.text(x, y, label, ha="center", va="center", fontsize=10, color="white", weight="bold", zorder=3)
    for label, (x, y) in [("놓친 ×3", (0.30, 0.88)), ("×2", (0.10, 0.80)), ("×2", (0.74, 0.86)), ("×2", (0.90, 0.30))]:
        ax.scatter([x], [y], s=1100, facecolors="none", edgecolors=gold, lw=1.8, ls=(0, (2, 1.5)), zorder=2)
        ax.text(x, y, label, ha="center", va="center", fontsize=8, color=gold, weight="bold", zorder=3)
    ax.text(0.5, 0.03, "● 보유 4편    ○ 놓친 논문 10편 (인용 ≥2회)", ha="center", fontsize=10, color="#444")
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    fig.tight_layout(pad=0.1); fig.savefig(f"{ASSETS}/graph.png", transparent=True); plt.close(fig)

    # ---- validation bars (slide 11) ----
    fig, ax = plt.subplots(figsize=(11.8, 2.7), dpi=200)
    phases = ["메타\nfetch", "색인\nsearch", "근거\n채팅", "인용\n그래프", "PDF\n추출", "참고\n문헌", "온톨\n로지"]
    vals = [6, 9, 4, 6, 4, 5, 6]
    bars = ax.bar(range(len(phases)), vals, color=g_acc, width=0.62, zorder=2)
    for i, v in enumerate(vals):
        ax.text(i, v + 0.15, str(v), ha="center", fontsize=12, color=g_sb, weight="bold")
    ax.set_xticks(range(len(phases))); ax.set_xticklabels(phases, fontsize=11, color="#333")
    ax.set_ylim(0, 10.5); ax.set_yticks([])
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color("#cccccc")
    ax.text(0.0, 1.06, "통합검증 통과 항목 (단계별) — 합계 40, 실패 0", transform=ax.transAxes,
            fontsize=12, color="#1F1F1F", weight="bold")
    fig.tight_layout(pad=0.3); fig.savefig(f"{ASSETS}/validation.png", transparent=True); plt.close(fig)
    print("charts built →", ASSETS)

# ================================================================ pptx helpers
prs = Presentation()
prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

def add_slide(bg=NEUTRAL_WARM):
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    r.fill.solid(); r.fill.fore_color.rgb = C(bg); r.line.fill.background()
    r.shadow.inherit = False
    r._element.addprevious(r._element)  # keep at back (already first)
    return s

def no_shadow(shape): shape.shadow.inherit = False

def set_run(run, size, bold=False, color=TEXT, italic=False, spc=True):
    run.font.name = FONT; run.font.size = Pt(size); run.font.bold = bold
    run.font.italic = italic; run.font.color.rgb = C(color)
    # set east-asian + latin font
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        e = rPr.find(qn(tag))
        if e is None:
            e = rPr.makeelement(qn(tag), {}); rPr.append(e)
        e.set("typeface", FONT)
    if spc:
        rPr.set("spc", str(int(-1 * size)))

def textbox(slide, x, y, w, h, anchor=MSO_ANCHOR.TOP, wrap=True):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    return tb, tf

def para(tf, runs, align=PP_ALIGN.LEFT, first=False, space_before=0, line=None):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    if space_before: p.space_before = Pt(space_before)
    if line: p.line_spacing = Pt(line)
    for spec in runs:
        r = p.add_run(); r.text = spec["t"]
        set_run(r, spec["s"], spec.get("b", False), spec.get("c", TEXT),
                spec.get("i", False))
    return p

def rounded(slide, x, y, w, h, fill=WHITE, line=HAIR, line_w=0.75, radius=0.06):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    try: sh.adjustments[0] = radius
    except Exception: pass
    if fill is None: sh.fill.background()
    else: sh.fill.solid(); sh.fill.fore_color.rgb = C(fill)
    if line is None: sh.line.fill.background()
    else: sh.line.color.rgb = C(line); sh.line.width = Pt(line_w)
    no_shadow(sh); return sh

def rect(slide, x, y, w, h, fill, line=None, line_w=0.75):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None: sh.fill.background()
    else: sh.fill.solid(); sh.fill.fore_color.rgb = C(fill)
    if line is None: sh.line.fill.background()
    else: sh.line.color.rgb = C(line); sh.line.width = Pt(line_w)
    no_shadow(sh); return sh

def add_logo(slide):
    pic = slide.shapes.add_picture(LOGO, Inches(11.7545), Inches(0.0131), Inches(1.5788), Inches(0.8733))
    pic.crop_left = 0.0324; pic.crop_right = 0.1636; pic.crop_top = 0.2139; pic.crop_bottom = 0.1133
    return pic

# ---- zone builders
def header(slide, chapter):
    _, tf = textbox(slide, 0.1512, 0.135, 6.0, 0.28)
    para(tf, [{"t": chapter, "s": 11, "b": True, "c": GRAY}], first=True)

def headline(slide, text, color=STARBUCKS):
    _, tf = textbox(slide, 0.2752, 0.4771, 12.0, 0.7)
    para(tf, [{"t": text, "s": 30, "b": True, "c": color}], first=True, line=36)

def footer(slide, page, source=""):
    _, tf = textbox(slide, 0.1512, 7.24, 0.6, 0.25)
    para(tf, [{"t": str(page), "s": 9, "b": False, "c": GRAY}], first=True)
    if source:
        _, tf2 = textbox(slide, 7.1822, 7.2369, 6.0, 0.25)
        para(tf2, [{"t": source, "s": 8, "c": GRAY}], align=PP_ALIGN.RIGHT, first=True)

def card(slide, x=0.2752, y=1.4111, w=12.7946, h=5.7167):
    return rounded(slide, x, y, w, h, fill=WHITE, line=HAIR, line_w=0.75, radius=0.035)

def content(chapter, head, page, source=""):
    s = add_slide(NEUTRAL_WARM)
    header(s, chapter); headline(s, head); add_logo(s)
    c = card(s); footer(s, page, source)
    return s

# ================================================================ slide builders
def cover():
    s = add_slide(NEUTRAL_WARM); add_logo(s)
    rounded(s, 0.6, 1.11, 2.4, 0.49, fill=ACCENT, line=None, radius=0.5)
    _, tf = textbox(s, 0.6, 1.11, 2.4, 0.49, anchor=MSO_ANCHOR.MIDDLE)
    para(tf, [{"t": "RESEARCH TOOL", "s": 14, "b": True, "c": WHITE}], align=PP_ALIGN.CENTER, first=True)
    _, tf = textbox(s, 0.6, 2.0512, 12.2953, 1.6)
    para(tf, [{"t": "RAG Obsidian", "s": 54, "b": True, "c": STARBUCKS}], first=True, line=60)
    rect(s, 0.6, 3.7593, 1.8, 0.05, fill=ACCENT)
    _, tf = textbox(s, 0.6, 4.0517, 11.0, 0.9)
    para(tf, [{"t": "내 서재가 답하는 AI 서지관리", "s": 20, "b": True, "c": UPLIFT}], first=True)
    para(tf, [{"t": "Obsidian 네이티브 · 로컬 우선 · 인용 근거", "s": 15, "c": TEXT_SOFT}], space_before=4)
    _, tf = textbox(s, 7.509, 5.58, 5.5, 0.32)
    para(tf, [{"t": "분당서울대학교병원 정형외과", "s": 16, "c": TEXT_SOFT}], align=PP_ALIGN.RIGHT, first=True)
    _, tf = textbox(s, 7.509, 5.95, 5.5, 0.5)
    para(tf, [{"t": "박상민", "s": 28, "b": True, "c": TEXT}], align=PP_ALIGN.RIGHT, first=True)
    _, tf = textbox(s, 0.2977, 6.9752, 8.0, 0.25)
    para(tf, [{"t": "연구실 세미나  |  2026.06", "s": 14, "c": TEXT_SOFT}], first=True)

def big_message(chapter, big_lines, subline, page):
    s = add_slide(NEUTRAL_WARM); header(s, chapter); add_logo(s); footer(s, page)
    _, tf = textbox(s, 0.6, 2.5, 12.1, 2.8, anchor=MSO_ANCHOR.MIDDLE)
    for i, ln in enumerate(big_lines):
        col = STARBUCKS if i == 0 else ACCENT
        para(tf, [{"t": ln, "s": 56, "b": True, "c": col}], align=PP_ALIGN.CENTER, first=(i == 0), line=64)
    _, tf = textbox(s, 0.6, 5.5, 12.1, 0.6)
    para(tf, [{"t": subline, "s": 16, "i": True, "c": TEXT_SOFT}], align=PP_ALIGN.CENTER, first=True)

def closing():
    s = add_slide(NEUTRAL_WARM); add_logo(s)
    _, tf = textbox(s, 0.6, 2.6, 12.1, 1.4, anchor=MSO_ANCHOR.MIDDLE)
    para(tf, [{"t": "Thank you", "s": 54, "b": True, "c": STARBUCKS}], align=PP_ALIGN.CENTER, first=True)
    _, tf = textbox(s, 0.6, 4.1, 12.1, 0.5)
    para(tf, [{"t": "Questions & discussion", "s": 18, "c": TEXT_SOFT}], align=PP_ALIGN.CENTER, first=True)
    _, tf = textbox(s, 0.6, 5.4, 12.1, 0.7)
    para(tf, [{"t": "박상민  ·  분당서울대학교병원 정형외과", "s": 14, "c": TEXT_SOFT}], align=PP_ALIGN.CENTER, first=True)
    para(tf, [{"t": "github.com/grotyx/rag-obsidian", "s": 12, "c": ACCENT}], align=PP_ALIGN.CENTER, space_before=4)

# ---- patterns (inside body card: x0.2752 y1.4111 w12.7946 h5.7167; inner pad 0.4)
CX, CY, CW, CH = 0.2752, 1.4111, 12.7946, 5.7167
IX, IY, IW = CX + 0.45, CY + 0.4, CW - 0.9

def takeaway_strip(s, text, y=None):
    y = y if y else CY + CH - 0.72
    rounded(s, CX + 0.35, y, CW - 0.7, 0.5, fill=HOUSE, line=None, radius=0.18)
    _, tf = textbox(s, CX + 0.6, y, CW - 1.2, 0.5, anchor=MSO_ANCHOR.MIDDLE)
    para(tf, [{"t": text, "s": 14, "b": True, "c": WHITE}], first=True)

def pattern_C(s, claim, bullets, img, takeaway):
    # left 52%, right 46%
    lw = (CW - 0.9) * 0.52
    _, tf = textbox(s, IX, IY, lw, 3.6)
    para(tf, [{"t": claim, "s": 22, "b": True, "c": TEXT}], first=True, line=30)
    for b in bullets:
        p = tf.add_paragraph(); p.space_before = Pt(14); p.line_spacing = Pt(26)
        r = p.add_run(); r.text = "● "; set_run(r, 13, True, ACCENT)
        r2 = p.add_run(); r2.text = b; set_run(r2, 16, False, TEXT)
    rx = IX + lw + 0.3
    s.shapes.add_picture(img, Inches(rx), Inches(IY - 0.1), height=Inches(3.7))
    takeaway_strip(s, takeaway)

def pattern_E(s, cols, rows, source_hi=True):
    from pptx.util import Inches as I
    nrow, ncol = len(rows) + 1, len(cols)
    tbl_w, tbl_h = CW - 0.9, 0.55 * nrow
    gtbl = s.shapes.add_table(nrow, ncol, Inches(IX), Inches(IY), Inches(tbl_w), Inches(tbl_h)).table
    gtbl.first_row = False; gtbl.horz_banding = False
    widths = [3.6] + [(tbl_w - 3.6) / (ncol - 1)] * (ncol - 1)
    for j, wv in enumerate(widths):
        gtbl.columns[j].width = Inches(wv)
    def fill_cell(cell, txt, size, bold, color, bg):
        cell.fill.solid(); cell.fill.fore_color.rgb = C(bg)
        cell.margin_left = Inches(0.1); cell.margin_top = Inches(0.03); cell.margin_bottom = Inches(0.03)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if size <= 13 else PP_ALIGN.LEFT
        r = p.add_run(); r.text = txt; set_run(r, size, bold, color)
    for j, ctxt in enumerate(cols):
        hi = (j == ncol - 1)
        fill_cell(gtbl.cell(0, j), ctxt, 12, True, WHITE if hi else TEXT, ACCENT if hi else NEUTRAL_COOL)
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            hi = (j == ncol - 1)
            bg = GREEN_LIGHT if hi else (WHITE if i % 2 == 0 else CERAMIC)
            fill_cell(gtbl.cell(i + 1, j), val, 13 if j else 13,
                      bold=hi, color=(STARBUCKS if hi else (TEXT if j == 0 else TEXT_SOFT)), bg=bg)

def pattern_A(s, img, note):
    _, tf = textbox(s, IX, IY - 0.05, IW, 0.35)
    para(tf, [{"t": note, "s": 13, "b": True, "c": TEXT}], first=True)
    s.shapes.add_picture(img, Inches(IX), Inches(IY + 0.35), width=Inches(IW))

def pattern_H(s, pillars, takeaway):
    n = len(pillars); gap = 0.22
    cw = (CW - 0.9 - gap * (n - 1)) / n
    cy, ch = IY + 0.1, 3.5
    for i, p in enumerate(pillars):
        x = IX + i * (cw + gap)
        rounded(s, x, cy, cw, ch, fill=WHITE, line=HAIR, line_w=0.75, radius=0.06)
        rect(s, x, cy, cw, 0.07, fill=ACCENT)  # top accent bar
        # tag pill
        pw = min(cw - 0.4, 1.9)
        rounded(s, x + (cw - pw) / 2, cy + 0.28, pw, 0.34, fill=ACCENT, line=None, radius=0.5)
        _, tf = textbox(s, x + (cw - pw) / 2, cy + 0.28, pw, 0.34, anchor=MSO_ANCHOR.MIDDLE)
        para(tf, [{"t": p["tag"], "s": 11, "b": True, "c": WHITE}], align=PP_ALIGN.CENTER, first=True)
        _, tf = textbox(s, x + 0.1, cy + 0.95, cw - 0.2, 1.7, anchor=MSO_ANCHOR.TOP)
        para(tf, [{"t": p["big"], "s": 34, "b": True, "c": STARBUCKS}], align=PP_ALIGN.CENTER, first=True)
        para(tf, [{"t": p["sub"], "s": 16, "b": True, "c": TEXT}], align=PP_ALIGN.CENTER, space_before=2)
        para(tf, [{"t": p["body"], "s": 12, "c": TEXT_SOFT}], align=PP_ALIGN.CENTER, space_before=10, line=16)
    takeaway_strip(s, takeaway)

def pattern_F(s, layers, takeaway):
    bands = [(HOUSE, WHITE), (NEUTRAL_WARM, TEXT), (GREEN_LIGHT, TEXT)]
    bh, gap = 1.05, 0.18
    by = IY
    for i, ly in enumerate(layers):
        bg, tc = bands[i % 3]
        ln = HAIR if bg != HOUSE else None
        rounded(s, IX, by, IW, bh, fill=bg, line=ln, line_w=0.75, radius=0.05)
        _, tf = textbox(s, IX + 0.35, by, 2.0, bh, anchor=MSO_ANCHOR.MIDDLE)
        para(tf, [{"t": ly["band"], "s": 15, "b": True, "c": (WHITE if bg == HOUSE else ACCENT)}], first=True)
        _, tf = textbox(s, IX + 2.4, by, IW - 2.8, bh, anchor=MSO_ANCHOR.MIDDLE)
        para(tf, [{"t": ly["text"], "s": 15, "c": tc}], first=True, line=21)
        by += bh + gap
    takeaway_strip(s, takeaway, y=by + 0.02)

def pattern_B(s, kpis, img, note, takeaway):
    n = len(kpis); gap = 0.22
    tw = (CW - 0.9 - gap * (n - 1)) / n
    ty, th = IY, 1.35
    for i, k in enumerate(kpis):
        x = IX + i * (tw + gap)
        rounded(s, x, ty, tw, th, fill=WHITE, line=HAIR, line_w=0.75, radius=0.08)
        _, tf = textbox(s, x + 0.1, ty + 0.12, tw - 0.2, 0.75, anchor=MSO_ANCHOR.MIDDLE)
        para(tf, [{"t": k["value"], "s": 40, "b": True, "c": STARBUCKS}], align=PP_ALIGN.CENTER, first=True)
        _, tf = textbox(s, x + 0.1, ty + 0.92, tw - 0.2, 0.35)
        para(tf, [{"t": k["label"], "s": 12, "c": TEXT_SOFT}], align=PP_ALIGN.CENTER, first=True)
        if k.get("delta"):
            pw = 1.0
            rounded(s, x + (tw - pw) / 2, ty - 0.02, pw, 0.0, fill=None, line=None)
    s.shapes.add_picture(img, Inches(IX), Inches(ty + th + 0.15), width=Inches(IW))
    takeaway_strip(s, takeaway)

def pattern_J(s, milestones, takeaway):
    n = len(milestones)
    y_line = CY + 2.55
    x0, x1 = IX + 0.3, IX + IW - 0.3
    rect(s, x0, y_line, x1 - x0, 0.025, fill=ACCENT)
    step = (x1 - x0) / (n - 1)
    for i, m in enumerate(milestones):
        cx = x0 + i * step
        ov = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.11), Inches(y_line - 0.095), Inches(0.22), Inches(0.22))
        ov.fill.solid(); ov.fill.fore_color.rgb = C(ACCENT); ov.line.color.rgb = C(WHITE); ov.line.width = Pt(1.5)
        no_shadow(ov)
        _, tf = textbox(s, cx - 0.9, y_line - 0.9, 1.8, 0.5)
        para(tf, [{"t": m["year"], "s": 17, "b": True, "c": STARBUCKS}], align=PP_ALIGN.CENTER, first=True)
        _, tf = textbox(s, cx - 0.95, y_line + 0.25, 1.9, 1.0)
        para(tf, [{"t": m["label"], "s": 12, "c": TEXT}], align=PP_ALIGN.CENTER, first=True, line=15)
    takeaway_strip(s, takeaway)

# ================================================================ assemble
def main():
    build_charts()
    cover()  # 1
    big_message("OPENING", ["서재는 늘어나는데", "답에는 출처가 없다"],
                "Obsidian은 노트를 찾아주지만, 어느 논문·어느 구절인지는 말해주지 않는다", 2)
    s = content("BACKGROUND", "서지 플러그인과 AI 플러그인은 서로를 모른다", 3,
                "Obsidian community plugins · 2026")
    pattern_C(s, "Obsidian 생태계는 두 세계로 갈라져 있다",
              ["서지: Citation·Zotero·ZotLit — 키워드뿐, Zotero 의존",
               "AI: Smart Connections·Copilot·Khoj — 서지 모름, 노트 단위",
               "교집합(의미검색+메타데이터+구절 인용)은 비어 있음"],
              f"{ASSETS}/gap.png", "둘 다 반쪽 — 서지는 AI가 없고, AI는 서지를 모른다")
    s = content("BACKGROUND", "둘을 잇는 다리는 아무도 안 놓았다 — 그게 빈틈", 4,
                "Smart Connections 5.1k★ · Copilot 7.1k★ · Citation 1.3k★")
    pattern_E(s, ["기능", "서지 플러그인", "AI/RAG 플러그인", "RAG Obsidian"],
              [["의미 검색", "✗", "✓", "✓"], ["메타데이터 패싯", "✓", "✗", "✓"],
               ["구절 단위 인용", "✗", "✗ (노트 단위)", "✓"], ["서식 참고문헌", "일부", "✗", "✓"],
               ["인용 그래프", "✗", "✗", "✓"], ["Zotero 불필요", "✗", "—", "✓"]])
    big_message("THE IDEA", ["마크다운이", "곧 데이터베이스다"],
                "논문 1편 = 노트 1개 · CSL-JSON frontmatter · Zotero 없이, 백엔드 없이", 5)
    s = content("ARCHITECTURE", "한 장으로 보는 구조: 노트 → 색인 → 근거 답변", 6,
                "RAG Obsidian v0.1.0")
    pattern_A(s, f"{ASSETS}/arch.png", "데이터 흐름 — 입력에서 근거 답변까지")
    s = content("FEATURES", "네 가지가 한 플러그인에: 서재·검색·채팅·그래프", 7)
    pattern_H(s, [{"tag": "LIBRARY", "big": "서재", "sub": "Zotero 대체", "body": "DOI/PMID/arXiv\n→ CSL-JSON 노트"},
                  {"tag": "SEARCH", "big": "검색", "sub": "하이브리드", "body": "BM25+벡터\n메타데이터 필터"},
                  {"tag": "CHAT", "big": "채팅", "sub": "근거 기반", "body": "구절 [n]\n→ 서식 인용"},
                  {"tag": "GRAPH", "big": "그래프", "sub": "OpenAlex", "body": "관련 ·\n놓친 논문"}],
              "추가로: PDF 임포트 · @인용 자동완성 · 참고문헌 생성 · 온톨로지 팩")
    s = content("HOW IT WORKS · 검색", "검색은 싼 것부터 — 하이브리드, 필요하면 그래프", 8,
                "Orama 하이브리드 · 임베딩 provider 3종")
    pattern_F(s, [{"band": "Tier 0", "text": "하이브리드(BM25+벡터) + frontmatter 패싯 — 로컬, LLM 비용 0"},
                  {"band": "Tier 1", "text": "OpenAlex 인용 그래프 1-hop 확장 — 무료·구조화, GraphRAG-lite"},
                  {"band": "Tier 2+", "text": "선택: 재랭킹 · 온톨로지 IS_A 확장 (필요할 때만)"}],
              "개인 서재엔 풀 GraphRAG 과함 — 인용엣지가 더 싸고 정확")
    s = content("HOW IT WORKS · 그래프", "인용 그래프가 '내가 놓친 논문'을 찾아준다", 9,
                "테스트 vault 4편 · OpenAlex 라이브")
    pattern_C(s, "OpenAlex referenced_works로\n서재의 인용 지형을 그린다",
              ["내 논문끼리 인용하는 엣지 (2015→1997·1998)",
               "공동 인용(coupling)으로 비슷한 논문 묶기",
               "≥2회 인용하지만 없는 논문 = 놓친 논문"],
              f"{ASSETS}/graph.png", "실데이터: 보유 4편 → 놓친 논문 10편 (LLM 비용 0)")
    s = content("HOW IT WORKS · 채팅", "모든 답은 구절 단위 출처와 함께 나온다", 10,
                "근거 채팅 파이프라인")
    pattern_F(s, [{"band": "검색", "text": "질문 → 관련 구절 top-K 회수 (서재 안에서만)"},
                  {"band": "근거", "text": "LLM이 [n] 앵커로 인용 — 출처 없는 주장 금지"},
                  {"band": "인용", "text": "[n] → APA/Vancouver/Plain 서식 출처 (클릭→노트)"}],
              "Anthropic·OpenAI·Ollama 교체 가능 — 답은 항상 서재에 근거")
    s = content("VALIDATION", "40개 통합검증 — 실 API·실데이터로 전부 통과", 11,
                "npm test · 통합 하니스 40 checks")
    pattern_B(s, [{"value": "40", "label": "통합검증 통과"}, {"value": "0", "label": "백엔드/서버"},
                  {"value": "10", "label": "놓친 논문(실데이터)"}, {"value": "19p", "label": "실 PDF 추출 · 72K자"}],
              f"{ASSETS}/validation.png", "단계별 검증 분포",
              "live Crossref·PubMed·OpenAlex + Orama + pdfjs 실검증")
    s = content("ROADMAP", "Phase 0에서 5까지, 각 단계가 독립적으로 쓸모", 12,
                "v0.1.0 · github.com/grotyx/rag-obsidian")
    pattern_J(s, [{"year": "P0", "label": "서지관리\nDOI→노트"}, {"year": "P1", "label": "의미 검색\nOrama"},
                  {"year": "P2", "label": "근거 채팅"}, {"year": "P3", "label": "PDF\n임포트"},
                  {"year": "P4", "label": "인용\n그래프"}, {"year": "P5", "label": "작성 지원\n참고문헌"}],
              "향후: 풀 CSL(citeproc) · 온톨로지 검색확장 · 모바일 QA")
    s = content("CONCLUSION", "Zotero 없이, 백엔드 없이, 근거와 함께", 13)
    pattern_H(s, [{"tag": "OWN YOUR DATA", "big": "마크다운", "sub": "= DB", "body": "평문·git·로컬 우선\n플러그인보다 오래 남음"},
                  {"tag": "GROUNDED", "big": "근거", "sub": "구절 인용", "body": "출처 없는 답 없음\n서식 참고문헌"},
                  {"tag": "GRAPH-LITE", "big": "그래프", "sub": "놓친 논문", "body": "OpenAlex 인용엣지\nLLM 비용 0"}],
              "서재가 곧 검색엔진이고, 답은 늘 출처와 함께 — RAG Obsidian v0.1.0")
    closing()  # 14
    out = os.path.join(HERE, "rag_obsidian_deck.pptx")
    prs.save(out)
    print("saved →", out, "·", len(prs.slides.__iter__.__self__._sldIdLst), "slides")

if __name__ == "__main__":
    main()
