import { stringifyYaml } from "obsidian";
import { CSLItem, ScholarRagSettings, SummarySections } from "../types";

export function getYear(item: CSLItem): string {
  const dp = item.issued?.["date-parts"]?.[0];
  // coerce via parseInt: a string year from malformed metadata could otherwise
  // pass arbitrary chars into filenames (getYear is the one unrestricted component)
  const yr = dp && dp[0] ? parseInt(String(dp[0]), 10) : NaN;
  if (!Number.isNaN(yr) && yr !== 0) return String(yr);
  return "nd";
}

export function firstAuthorFamily(item: CSLItem): string {
  const a = item.author?.[0];
  if (!a) return "anon";
  return a.family || a.literal || a.given || "anon";
}

export function slug(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase();
}

const STOPWORDS = new Set([
  "the", "a", "an", "on", "of", "in", "for", "and", "to", "with", "at", "by",
]);

export function firstTitleWord(item: CSLItem): string {
  const words = slug(item.title || "").split(/\s+/).filter(Boolean);
  for (const w of words) if (!STOPWORDS.has(w)) return w;
  return words[0] || "untitled";
}

export function generateCitekey(item: CSLItem, settings: ScholarRagSettings): string {
  // Non-Latin family names slug to "" → fall back to "anon" (mirrors authorTag)
  // so citekeys don't collapse to a bare year and collide across papers.
  const fam = slug(firstAuthorFamily(item)).replace(/\s+/g, "") || "anon";
  const yr = getYear(item);
  if (settings.citekeyStyle === "authoryear") return `${fam}${yr}`;
  return `${fam}${yr}${firstTitleWord(item)}`;
}

const JOURNAL_DROP = new Set(["the", "of", "and", "for", "in", "a", "an", "on", "official", "journal"]);

/** Compact journal token, e.g. "Spine J" → "SpineJ", "The Spine Journal" → "SpineJournal". */
export function journalAbbr(item: CSLItem): string {
  const raw = (item["container-title-short"] as string) || item["container-title"] || "";
  const words = raw
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !JOURNAL_DROP.has(w.toLowerCase()));
  const tok = words.map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join("");
  return tok || "NA";
}

/** First-author family + given initials, e.g. {family:"Park", given:"Sang-Min"} → "ParkSM". */
export function authorTag(item: CSLItem): string {
  const a = item.author?.[0];
  if (!a) return "Anon";
  // Non-Latin family names (e.g. CJK) strip to empty → fall back to "Anon" to avoid
  // a malformed `YYYY-Journal--Title` filename.
  const fam = (a.family || a.literal || a.given || "Anon").replace(/[^A-Za-z0-9]/g, "") || "Anon";
  const given = a.given || "";
  let inits = "";
  if (/^[A-Z]{1,4}$/.test(given)) inits = given; // already initials like "SM"
  else inits = given.split(/[\s.-]+/).map((w) => w[0] || "").join("").toUpperCase();
  return (fam[0]?.toUpperCase() || "") + fam.slice(1) + inits;
}

/** Readable note filename: `YYYY-JournalAbbr-AuthorInitials-TitleWord` (decoupled from citekey). */
export function generateFilename(item: CSLItem): string {
  const yr = getYear(item);
  const jr = journalAbbr(item);
  const au = authorTag(item);
  const tw = firstTitleWord(item);
  const titleCap = tw ? tw[0].toUpperCase() + tw.slice(1) : "untitled";
  return [yr, jr, au, titleCap].join("-").replace(/[\\/:*?"<>|]/g, "");
}

export interface BuildNoteOpts {
  summary?: SummarySections;
  summarySource?: string; // short tag stored in frontmatter (e.g. "pmc-fulltext")
  summarySourceLabel?: string; // human-readable line shown above the summary
  tags?: string[]; // topic tags for the graph view (already normalized via keywordsToTags)
}

// Generic MeSH (demographics / study design / check-tags) excluded from topic tags.
const TAG_STOP = new Set([
  "humans", "animals", "male", "female", "adult", "aged", "aged-80-and-over", "middle-aged",
  "young-adult", "adolescent", "child", "child-preschool", "infant", "retrospective-studies",
  "prospective-studies", "follow-up-studies", "time-factors", "reproducibility-of-results",
  "cohort-studies", "treatment-outcome", "risk-factors", "cross-sectional-studies",
]);

// Fold common spelling/synonym variants onto one canonical tag so the graph clusters cleanly.
const TAG_SYNONYM: Record<string, string> = {
  discectomy: "diskectomy",
  "discectomy-percutaneous": "diskectomy-percutaneous",
  "lumbar-disc-herniation": "intervertebral-disc-displacement",
  "lumbar-disk-herniation": "intervertebral-disc-displacement",
  "herniated-disc": "intervertebral-disc-displacement",
  "lumbar-herniated-disc": "intervertebral-disc-displacement",
};

export function tagSlug(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/['"().,]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize MeSH/keyword strings into graph-safe topic tags (dedup, synonym-fold, drop generic). */
export function keywordsToTags(terms: string[]): string[] {
  const out = new Set<string>();
  for (const t of terms || []) {
    let s = tagSlug(t);
    if (!s) continue;
    s = TAG_SYNONYM[s] || s;
    if (TAG_STOP.has(s)) continue;
    out.add(s);
  }
  return [...out];
}

function summaryBlock(s: SummarySections): string[] {
  const en: string[] = [];
  const sec: [string, string | undefined][] = [
    ["Background / Objective", s.background],
    ["Methods", s.methods],
    ["Results", s.results],
    ["Conclusions", s.conclusions],
  ];
  for (const [h, v] of sec) if (v) en.push(`**${h}**`, v, "");
  const lines: string[] = [];
  if (en.length) lines.push("## Summary (EN)", "", ...en);
  if (s.kr) lines.push("## 요약 (KR)", "", s.kr, "");
  return lines;
}

/** Build the full markdown note: CSL-JSON frontmatter + note scaffold (+ optional summary). */
export function buildNote(item: CSLItem, citekey: string, opts: BuildNoteOpts = {}): string {
  const fm: Record<string, unknown> = {
    citekey,
    type: item.type || "article-journal",
    title: item.title || "",
  };
  if (item.author) fm.author = item.author;
  if (item.issued) fm.issued = item.issued;
  if (item["container-title"]) fm["container-title"] = item["container-title"];
  if (item.volume) fm.volume = item.volume;
  if (item.issue) fm.issue = item.issue;
  if (item.page) fm.page = item.page;
  if (item.DOI) fm.DOI = item.DOI;
  if (item.PMID) fm.PMID = item.PMID;
  if (item.URL) fm.URL = item.URL;
  if (item.number) fm.number = item.number;
  if (item.publisher) fm.publisher = item.publisher;
  if (item.keyword && item.keyword.length) fm.keyword = item.keyword;
  if (item.abstract) fm.abstract = item.abstract;

  // plugin-managed fields
  fm.status = "unread";
  fm.added = new Date().toISOString().slice(0, 10);
  if (opts.summarySource) fm.summary_source = opts.summarySource;
  if (opts.tags && opts.tags.length) fm.tags = opts.tags;

  const yaml = stringifyYaml(fm).trimEnd();
  const heading = item.title || citekey;
  const lines = ["", `# ${heading}`, ""];
  if (opts.summarySourceLabel) {
    const doi = item.DOI ? `  ·  [DOI](https://doi.org/${item.DOI})` : "";
    lines.push(`> **Summary source**: ${opts.summarySourceLabel}${doi}`, "");
  }
  if (opts.summary) lines.push(...summaryBlock(opts.summary));
  lines.push("## Notes", "", "## Highlights", "");
  return `---\n${yaml}\n---\n${lines.join("\n")}`;
}
