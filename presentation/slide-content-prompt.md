# Slide Content Authoring — Prompt & Template

How to turn a **paper, dataset, or topic** into a slide-by-slide content plan that conforms to
[design.md](design.md). This file produces the **content** (what goes on each slide and which
pattern to use); `design.md` governs the **visual system** (zones, type scale, colors, minimal-fill
look). Always use the two together.

---

## 0. How to use

1. Open an LLM session and paste **`design.md` (full)** + **this file** as context.
2. Paste your source (paper abstract/full text, results tables, or a topic brief).
3. Run the **Authoring Prompt** (§1). The model returns a **Slide Plan** (one block per slide,
   §4 template).
4. Review the plan against the **Checklist** (§5), then build the slides on the backbone template.

---

## 1. Authoring Prompt (copy-paste)

> You are a medical-conference slide planner for the **SNUBH Spine** deck system. You will be given
> a source (a paper, results, or a topic) and the `design.md` design system. Produce a **Slide Plan**:
> an ordered list of slides, each filled into the per-slide template.
>
> **Hard rules (from design.md):**
> - **4-zone skeleton** on every standard content slide: Header chapter (top-left) · Headline
>   (Pretendard 700, **30pt**, Starbucks Green) · Body card (white) · Footer (page + source).
>   **There is NO subtitle line** — put the takeaway in the headline, not a subhead.
> - **One headline = one sentence takeaway.** The headline states the *conclusion*, not the topic
>   ("Equivalence achieved — in both diseases", not "Primary outcome").
> - **Visualize, don't narrate.** Any comparison, trend, composition, process, or relationship
>   becomes a chart/diagram/KPI — never a paragraph. Max 1–2 visuals per slide.
> - **Minimal-fill aesthetic:** boxes/cards/pills are **outline or no-fill** (color via thin border
>   or text), **no shadows**. **Charts keep their color.** Cover/divider/closing use the **light
>   Neutral-Warm (`#f2f0eb`) canvas** (not House-Green). Keep the white body card.
> - **Podium sizing:** axis labels and small chart text **≥ 12pt**; never < 9pt.
> - **Presenter defaults (fixed):** 발표자 **박상민**, 소속 **분당서울대학교병원 정형외과**.
> - Pick the **single best body pattern (A–I, §3)** per slide. Don't overfill — respect the body card
>   bounds; if content is thin, use a density tactic (side panel, key-takeaway strip), never padding.
>
> **Output:** the **Deck Flow** (§2) as a numbered list, then one **Slide Block** (§4) per slide.
> Keep body text terse — bullet fragments, numbers, labels. Mark every data slide with its **source**.

---

## 2. Deck Flow (default narrative arc)

Mirrors the reference deck. Drop sections that don't apply; never reorder past Conclusion.

| # | Section (header chapter) | Slide type | Typical pattern |
|---|---|---|---|
| 1 | — | **Cover** | House-Green cover (title ≤ 2 lines, study descriptor, presenter) |
| 2 | `OPENING` | **Big Message** | G — the core question in 1–3 lines |
| 3 | `BACKGROUND` | content | timeline / claim+evidence / 2-question framing |
| 4 | `METHODS` | content | study-design table, CONSORT/patient-flow, comparison |
| 5 | `RESULTS · EFFICACY` | content | forest plot (I), trajectory/line chart (A), KPI (B/D) |
| 6 | `RESULTS · SAFETY` | content | KPI tiles, comparison bars, complication table (E) |
| 7 | `POST-HOC ANALYSIS · n OF m` | content | subgroup forest (I), KPI + chart |
| 8 | `DISCUSSION` | content | claim/evidence (C), stacked insight (F) |
| 9 | `CONCLUSION` | content (NOT dark) | pillar cards (H) + take-home line |
| 10 | `ACKNOWLEDGEMENTS` | **Closing** | "Thank you" (content slide or House-Green closing) |

Interleave **Big Message (G)** slides as transitions between major sections (e.g., before Results).

---

## 3. Pattern selection guide

Choose ONE per slide. (A–I are defined in `design.md` §5.)

| Pattern | Use when the slide's job is… |
|---|---|
| **A** Single Chart | one visualization carries the whole point (trend, distribution, one comparison) |
| **B** KPI Row + Chart | 3–4 headline numbers, then a supporting chart |
| **C** Two-Column Claim/Evidence | a claim on the left, its proof (chart/diagram) on the right |
| **D** Three KPI Tiles + Chart | exactly three metrics framing one comparison |
| **E** Full-Width Table | dense multi-row/col comparison; significant cells flagged with gold pill |
| **F** Stacked Insight Layers | finding → evidence → clinical implication, top to bottom |
| **G** Big Message | a single high-impact line; hooks, transitions, the headline result |
| **H** Pillar Cards | a 2–4 dimensional summary (e.g., Efficacy / Safety / Value) + take-home strip |
| **I** Forest / Equivalence Plot | equivalence/non-inferiority CIs that must be *seen* inside the margin |
| **J** Timeline | a milestone track over time (study history, enrolment phases, research program) |
| **K** Process Flow (CONSORT) | enrolment / patient flow or a procedural sequence (boxes + arrows) |

---

## 4. Per-slide template (fill one per slide)

```yaml
- slide: <n>
  section: <header chapter, e.g. RESULTS · EFFICACY>   # omit on cover/closing
  type: cover | big-message | content | closing
  headline: <one-sentence takeaway, ≤ ~60 chars>        # the conclusion, not the topic
  pattern: <A–I, or timeline/flow>                       # content slides only
  body:
    # fill the fields the pattern needs — examples:
    kpis:      [{value: "0.0%", label: "Wound dehiscence", delta: "▼"}, ...]
    chart:     {kind: bar|line|donut|forest, series: [...], note: "what it shows"}
    columns:   {claim: "...", evidence: "chart|diagram ref"}
    table:     {cols: [...], rows: [...], highlight: "sig cells"}
    pillars:   [{tag: "EFFICACY", big: "Equivalent", sub: "...", body: "..."}, ...]
    takeaway:  "<one-line key message for the bottom strip>"
  source: "<citation / dataset · n = NN>"                # required on every data slide
```

Only include `body` fields the chosen pattern uses. Keep all text terse.

---

## 5. Pre-build checklist

- [ ] Every headline is a **takeaway sentence**, Starbucks Green, 30pt — no subtitle line.
- [ ] Each data point is **visualized**, not narrated; ≤ 2 visuals/slide.
- [ ] Correct **pattern** chosen per slide; body fits the card (no overflow, not >30% empty).
- [ ] **Minimal fill**: outline/no-fill boxes, no shadows; **charts keep color**.
- [ ] Chart text **≥ 12pt** (podium); source line present on every data slide.
- [ ] Greens used by role (headline = `#006241`, data = `#00754A`); **Gold only** for significance.
- [ ] Presenter = **박상민 / 분당서울대학교병원 정형외과**; conference + date on cover.
- [ ] Deck follows the **flow** (§2); Conclusion uses content layout; cover/divider/closing on the **light canvas**.

---

## 6. Worked mini-example

**Source:** equivalence RCT, biportal vs microscope, primary outcome ODI at 12 mo (n=211), CI within ±12.8 margin.

```yaml
- slide: 12
  section: RESULTS · EFFICACY
  type: content
  headline: "Equivalence achieved — in both diseases"
  pattern: I            # forest / equivalence plot
  body:
    chart:
      kind: forest
      series:
        - {trial: "ENDO-DH", est: "+1.2", ci: "-3.1 to +5.5", margin: "±12.8", p: "0.41"}
        - {trial: "ENDO-BS", est: "-0.8", ci: "-4.0 to +2.4", margin: "±12.8", p: "0.62"}
      note: "both 95% CIs lie inside the equivalence margin band"
    takeaway: "✓ Both 95% CIs lie within the ±12.8 margin"
  source: "Pooled primary analysis · ODI at 12 mo · n = 211"
```
