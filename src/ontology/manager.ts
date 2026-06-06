import { App, Notice, TFile, normalizePath } from "obsidian";
import { Ontology, OntologyPack } from "./pack";
import { SAMPLE_PACK } from "./sample";
import { ScholarRagSettings } from "../types";
import { Library } from "../data/library";
import { stripFrontmatter } from "../index/chunker";

/** Loads an ontology pack (user JSON or built-in sample) and tags notes with concepts. */
export class OntologyManager {
  ontology = new Ontology();

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings
  ) {}

  async ensureLoaded(force = false): Promise<void> {
    if (this.ontology.loaded && !force) return;
    let pack: OntologyPack = SAMPLE_PACK;
    const p = this.settings.ontologyPackPath?.trim();
    if (p) {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (f instanceof TFile) {
        try {
          pack = JSON.parse(await this.app.vault.read(f));
        } catch {
          new Notice("Ontology pack failed to parse — using built-in sample");
        }
      }
    }
    this.ontology.load(pack);
  }

  async tagActiveNote(): Promise<number> {
    await this.ensureLoaded();
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      new Notice("No active note");
      return 0;
    }
    const content = await this.app.vault.read(file);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const text = [fm?.title, fm?.abstract, stripFrontmatter(content)].filter(Boolean).join(" ");
    const concepts = this.ontology.link(text);
    await this.app.fileManager.processFrontMatter(file, (f) => {
      f.concepts = concepts.map((c) => ({ id: c.id, label: c.label, scheme: this.ontology.scheme }));
    });
    new Notice(`Tagged ${concepts.length} concept(s) [${this.ontology.scheme}]`);
    return concepts.length;
  }
}
