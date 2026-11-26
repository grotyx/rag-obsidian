/** Browser bookmarklet for one-click capture: finds the paper's identifier on the current page and
 *  opens `obsidian://refwright-add?id=…`. `findPaperId` is serialized into the bookmarklet with
 *  `toString()`, so it must stay self-contained: no outer references, no inner functions, no comments. */

interface MetaLike { content?: string }
interface DocLike { querySelector(sel: string): MetaLike | null }
interface LocLike { href: string }

export function findPaperId(doc: DocLike, loc: LocLike): string | null {
  const doiRe = /10\.\d{4,9}\/[^\s"'<>]+/;
  const names = ["citation_doi", "dc.identifier", "prism.doi", "citation_pmid"];
  let found: string | null = null;
  for (let i = 0; i < names.length && !found; i++) {
    const el = doc.querySelector('meta[name="' + names[i] + '" i]');
    const v = ((el && el.content) || "").trim();
    if (!v) continue;
    if (names[i] === "citation_pmid") {
      if (/^\d{1,9}$/.test(v)) found = "pmid:" + v;
    } else {
      const m = v.match(doiRe);
      if (m) found = m[0];
    }
  }
  if (found) return found;
  const href = loc.href;
  const pm = href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/i);
  if (pm) return "pmid:" + pm[1];
  const ax = href.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  if (ax) return "arxiv:" + ax[1];
  const doi = href.match(doiRe);
  return doi ? doi[0] : null;
}

/** The `javascript:` URL to drag into the bookmarks bar. No `%` and no newlines in the body. */
export function bookmarkletUrl(): string {
  const src = findPaperId.toString().replace(/\s*\n\s*/g, " ");
  return (
    "javascript:(function(){var f=" + src + ";var id=f(document,location);" +
    "if(id){location.href='obsidian://refwright-add?id='+encodeURIComponent(id)}" +
    "else{alert('No DOI/PMID found on this page')}})()"
  );
}
