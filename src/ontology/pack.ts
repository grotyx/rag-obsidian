export interface OntologyConcept {
  id: string;
  label: string;
  synonyms?: string[];
  parents?: string[];
}

export interface OntologyPack {
  scheme: string;
  concepts: OntologyConcept[];
}

/** In-memory ontology: alias linking + IS_A (parent/child) traversal. Scheme-agnostic
 *  (SNOMED-CT, MeSH, MONDO, custom) — the JSON pack supplies the content. */
export class Ontology {
  private byId = new Map<string, OntologyConcept>();
  private aliasToId = new Map<string, string>();
  scheme = "";
  loaded = false;

  load(pack: OntologyPack): void {
    this.byId.clear();
    this.aliasToId.clear();
    this.scheme = pack.scheme;
    for (const c of pack.concepts) {
      this.byId.set(c.id, c);
      this.aliasToId.set(c.label.toLowerCase(), c.id);
      for (const s of c.synonyms ?? []) this.aliasToId.set(s.toLowerCase(), c.id);
    }
    this.loaded = true;
  }

  get size(): number {
    return this.byId.size;
  }
  concept(id: string): OntologyConcept | null {
    return this.byId.get(id) ?? null;
  }

  /** Link free text → concepts whose label/synonym appears (longest alias wins). */
  link(text: string): OntologyConcept[] {
    const hay = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    const found = new Map<string, OntologyConcept>();
    const aliases = [...this.aliasToId.keys()].sort((a, b) => b.length - a.length);
    for (const a of aliases) {
      if (a.length < 3) continue;
      if (hay.includes(" " + a + " ")) {
        const c = this.byId.get(this.aliasToId.get(a)!);
        if (c) found.set(c.id, c);
      }
    }
    return [...found.values()];
  }

  ancestors(id: string): OntologyConcept[] {
    const out: OntologyConcept[] = [];
    const seen = new Set<string>();
    const walk = (cid: string) => {
      const c = this.byId.get(cid);
      for (const p of c?.parents ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const pc = this.byId.get(p);
        if (pc) {
          out.push(pc);
          walk(p);
        }
      }
    };
    walk(id);
    return out;
  }

  descendants(id: string): OntologyConcept[] {
    const out: OntologyConcept[] = [];
    for (const c of this.byId.values()) {
      if ((c.parents ?? []).includes(id)) {
        out.push(c, ...this.descendants(c.id));
      }
    }
    return out;
  }

  /** IS_A expansion: self + synonyms + all descendant labels (for query expansion). */
  expand(id: string): string[] {
    const c = this.byId.get(id);
    if (!c) return [];
    const labels = new Set<string>([c.label, ...(c.synonyms ?? [])]);
    for (const d of this.descendants(id)) {
      labels.add(d.label);
      (d.synonyms ?? []).forEach((s) => labels.add(s));
    }
    return [...labels];
  }
}
