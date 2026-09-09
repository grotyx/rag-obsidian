import type ScholarRagPlugin from "../../main";
import type { CSLItem } from "../types";
import { detectId, fetchMetadata, SourceId } from "../ingest/metadata";
import { PubmedHit, searchPubmed } from "../ingest/pubmedSearch";
import { STASH_MARKER } from "../ingest/pdfStash";
import { SearchFilters } from "../index/store";
import { McpTool } from "./protocol";
import { McpVault } from "./vault";

type JsonSchema = Record<string, unknown>;

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

const string = (description: string): JsonSchema => ({ type: "string", description });
const integer = (description: string, minimum = 1, maximum = 100): JsonSchema => ({
  type: "integer", description, minimum, maximum,
});
const strings = (description: string): JsonSchema => ({ type: "array", description, items: { type: "string" } });
const readOnly = { readOnlyHint: true, destructiveHint: false };

export const MCP_TOOLS: McpTool[] = [
  {
    name: "library_status",
    description: "Check the live Obsidian vault and search-index status. Use this when connection or index state is uncertain. Makes no model request.",
    inputSchema: objectSchema({}), annotations: readOnly,
  },
  {
    name: "search_library",
    description: "Search the same hybrid BM25+vector index as Obsidian. Use before factual writing; cite only returned citekeys as [@citekey]. This may call the embedding provider but never an LLM or reranker.",
    inputSchema: objectSchema({
      query: string("Natural-language or keyword evidence query."),
      limit: integer("Maximum passages to return.", 1, 30),
      year_from: integer("Earliest publication year.", 1000, 3000),
      year_to: integer("Latest publication year.", 1000, 3000),
      author: string("Author family name, matched case-insensitively."),
      tags: strings("Tags that every result must contain."),
    }, ["query"]),
    annotations: { ...readOnly, openWorldHint: true },
  },
  {
    name: "rebuild_search_index",
    description: "Rebuild Obsidian's private search index. Use only after INDEX_NOT_READY or an embedding-model change. Uses embeddings, never a chat or summary LLM.",
    inputSchema: objectSchema({}), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_references",
    description: "List reference metadata without model or network calls. Use to browse known papers; use search_library for evidence passages.",
    inputSchema: objectSchema({
      limit: integer("Page size.", 1, 100), cursor: string("Path cursor returned by the previous page."),
      status: string("Reading status."), year_from: integer("Earliest publication year.", 1000, 3000),
      year_to: integer("Latest publication year.", 1000, 3000), author: string("Author family name."),
      tags: strings("Tags every reference must contain."),
    }), annotations: readOnly,
  },
  {
    name: "get_reference",
    description: "Get one reference by citekey, including metadata and note text. Extracted PDF full text is omitted; use search_library or paged read_note for it.",
    inputSchema: objectSchema({ citekey: string("Exact citekey returned by another library tool.") }, ["citekey"]),
    annotations: readOnly,
  },
  {
    name: "list_tags", description: "List reference-library tags and counts without model or network calls.",
    inputSchema: objectSchema({}), annotations: readOnly,
  },
  {
    name: "search_pubmed",
    description: "Search PubMed when local evidence is missing. Review results, then pass an explicit PMID to add_reference. Does not add or summarize papers.",
    inputSchema: objectSchema({
      query: string("PubMed query."), limit: integer("Maximum results.", 1, 50),
      year_from: integer("Earliest publication year.", 1000, 3000), year_to: integer("Latest publication year.", 1000, 3000),
    }, ["query"]), annotations: { ...readOnly, openWorldHint: true },
  },
  {
    name: "add_reference",
    description: "Add a reference from an explicit DOI, PMID:123, arXiv ID, or OpenAlex work ID. Returns an existing duplicate when present. Never calls an LLM or creates a summary.",
    inputSchema: objectSchema({ identifier: string("Explicit DOI, prefixed PMID, arXiv ID, or OpenAlex work ID/URL.") }, ["identifier"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_notes", description: "List Markdown notes outside Obsidian's private configuration folder. Bodies are not returned.",
    inputSchema: objectSchema({ folder: string("Optional vault-relative folder."), limit: integer("Page size.", 1, 100), cursor: string("Path cursor from the previous page.") }),
    annotations: readOnly,
  },
  {
    name: "read_note", description: "Read a bounded range of a Markdown note and receive the whole-note SHA-256 required for safe edits.",
    inputSchema: objectSchema({ path: string("Vault-relative .md path."), offset: integer("Character offset.", 0, 2_000_000), max_chars: integer("Maximum characters returned.", 1, 50_000) }, ["path"]),
    annotations: readOnly,
  },
  {
    name: "create_note", description: "Create a new Markdown note and missing parent folders. Fails instead of overwriting.",
    inputSchema: objectSchema({ path: string("Vault-relative .md path outside the config folder."), content: string("Complete Markdown content.") }, ["path", "content"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_note", description: "Replace a whole Markdown note only if expected_hash still matches. Read immediately before calling to avoid CONTENT_CHANGED.",
    inputSchema: objectSchema({ path: string("Vault-relative .md path."), content: string("Complete replacement Markdown."), expected_hash: string("SHA-256 returned by read_note.") }, ["path", "content", "expected_hash"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "replace_in_note", description: "Replace exactly one literal text span in a Markdown note, guarded by its current hash. Prefer this for a surgical edit.",
    inputSchema: objectSchema({ path: string("Vault-relative .md path."), old_text: string("Literal text that must occur exactly once."), new_text: string("Replacement text."), expected_hash: string("SHA-256 returned by read_note.") }, ["path", "old_text", "new_text", "expected_hash"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "move_note", description: "Move or rename a Markdown note through Obsidian so links follow user settings. Requires a current hash and never overwrites.",
    inputSchema: objectSchema({ path: string("Current vault-relative .md path."), new_path: string("New vault-relative .md path."), expected_hash: string("SHA-256 returned by read_note.") }, ["path", "new_path", "expected_hash"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "trash_note", description: "Move a Markdown note to Obsidian's recoverable trash. Read it immediately first and pass its current hash. This is destructive and should require user approval.",
    inputSchema: objectSchema({ path: string("Vault-relative .md path."), expected_hash: string("SHA-256 returned by read_note.") }, ["path", "expected_hash"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  {
    name: "compile_manuscript", description: "Compile [@citekey] citations and a bibliography into a sibling Markdown copy. Never overwrites the source.",
    inputSchema: objectSchema({ path: string("Source manuscript .md path."), output_path: string("Optional output .md path."), expected_output_hash: string("Required current hash when replacing an existing output.") }, ["path"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

interface ServiceDeps {
  searchPubmed: typeof searchPubmed;
  fetchMetadata: (id: SourceId, pubmedApiKey?: string, mailto?: string) => Promise<CSLItem>;
  compile?: (path: string, outputPath?: string, expectedOutputHash?: string) => Promise<unknown>;
}

const DEFAULT_DEPS: ServiceDeps = { searchPubmed, fetchMetadata };

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`INVALID_ARGUMENT: ${name} is required`);
  return value;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`INVALID_ARGUMENT: ${name} must be a string`);
  return value;
}

function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new Error(`INVALID_ARGUMENT: ${name} must be a string`);
  return value;
}

function numberArg(args: Record<string, unknown>, name: string, fallback: number, min: number, max: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`INVALID_ARGUMENT: ${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function stringArrayArg(args: Record<string, unknown>, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error(`INVALID_ARGUMENT: ${name} must be an array of non-empty strings`);
  }
  return value as string[];
}

function yearOf(item: CSLItem): number {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? year : 0;
}

function tagsOf(item: CSLItem): string[] {
  const tags = item.tags;
  return Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? [tags] : [];
}

export class McpService {
  private byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));
  private deps: ServiceDeps;

  constructor(
    private plugin: ScholarRagPlugin,
    private vault: McpVault,
    deps: Partial<ServiceDeps> = {}
  ) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.byName.get(name);
    if (!tool) throw new Error(`UNKNOWN_TOOL: Unknown tool: ${name}`);
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(args).find((key) => !(key in properties));
    if (unknown) throw new Error(`INVALID_ARGUMENT: Unknown argument: ${unknown}`);

    switch (name) {
      case "library_status": return this.status();
      case "search_library": return this.searchLibrary(args);
      case "rebuild_search_index": return { chunkCount: await this.plugin.indexManager.rebuild() };
      case "list_references": return this.listReferences(args);
      case "get_reference": return this.getReference(stringArg(args, "citekey"));
      case "list_tags": return this.listTags();
      case "search_pubmed": return this.searchPubmed(args);
      case "add_reference": return this.addReference(stringArg(args, "identifier"));
      case "list_notes": return this.vault.listNotes(optionalString(args, "folder"), numberArg(args, "limit", 50, 1, 100), optionalString(args, "cursor"));
      case "read_note": return this.vault.readNote(stringArg(args, "path"), numberArg(args, "offset", 0, 0, 2_000_000), numberArg(args, "max_chars", 12_000, 1, 50_000));
      case "create_note": return this.vault.createNote(stringArg(args, "path"), textArg(args, "content"));
      case "update_note": return this.vault.updateNote(stringArg(args, "path"), textArg(args, "content"), stringArg(args, "expected_hash"));
      case "replace_in_note": return this.vault.replaceInNote(stringArg(args, "path"), stringArg(args, "old_text"), optionalString(args, "new_text") ?? "", stringArg(args, "expected_hash"));
      case "move_note": return this.vault.moveNote(stringArg(args, "path"), stringArg(args, "new_path"), stringArg(args, "expected_hash"));
      case "trash_note": return this.vault.trashNote(stringArg(args, "path"), stringArg(args, "expected_hash"));
      case "compile_manuscript": {
        if (!this.deps.compile) throw new Error("UNAVAILABLE: manuscript compiler is not connected");
        return this.deps.compile(stringArg(args, "path"), optionalString(args, "output_path"), optionalString(args, "expected_output_hash"));
      }
      default: throw new Error(`UNKNOWN_TOOL: Unknown tool: ${name}`);
    }
  }

  private status(): Record<string, unknown> {
    return {
      pluginVersion: this.plugin.manifest.version,
      vaultName: this.plugin.app.vault.getName(),
      referenceFolder: this.plugin.library.folder(),
      indexReady: this.plugin.indexManager.ready,
      chunkCount: this.plugin.indexManager.count,
      embeddingModel: this.plugin.indexManager.indexedModelId || null,
    };
  }

  private async searchLibrary(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.plugin.indexManager.ready) throw new Error("INDEX_NOT_READY: call rebuild_search_index first");
    const filters: SearchFilters = {};
    if (args.year_from !== undefined) filters.yearFrom = numberArg(args, "year_from", 0, 1000, 3000);
    if (args.year_to !== undefined) filters.yearTo = numberArg(args, "year_to", 0, 1000, 3000);
    const author = optionalString(args, "author")?.trim();
    if (author) filters.author = author;
    const tags = stringArrayArg(args, "tags");
    if (tags) filters.tags = tags;
    const hits = await this.plugin.indexManager.search(
      stringArg(args, "query"), filters, numberArg(args, "limit", this.plugin.settings.topK, 1, 30)
    );
    const results = [];
    for (const hit of hits) {
      const file = this.plugin.library.getFile(hit.citekey);
      if (!file) continue;
      try {
        await this.vault.assertPath(file.path, false);
        results.push({ ...hit, path: file.path });
      } catch {
        // A reference reached through a vault symlink must not expose outside text over MCP.
      }
    }
    return { results };
  }

  private async safeEntries(): Promise<ReturnType<ScholarRagPlugin["library"]["entries"]>> {
    const safe = [];
    for (const entry of this.plugin.library.entries()) {
      try {
        await this.vault.assertPath(entry.file.path, false);
        safe.push(entry);
      } catch {
        // Skip references whose real path leaves the vault.
      }
    }
    return safe;
  }

  private async listReferences(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const from = args.year_from === undefined ? 0 : numberArg(args, "year_from", 0, 1000, 3000);
    const to = args.year_to === undefined ? 9999 : numberArg(args, "year_to", 9999, 1000, 3000);
    const author = optionalString(args, "author")?.trim().toLowerCase();
    const status = optionalString(args, "status")?.trim().toLowerCase();
    const tags = stringArrayArg(args, "tags") ?? [];
    const cursor = optionalString(args, "cursor") ?? "";
    const limit = numberArg(args, "limit", 50, 1, 100);
    const all = (await this.safeEntries())
      .filter((entry) => entry.file.path > cursor)
      .filter((entry) => yearOf(entry.item) >= from && yearOf(entry.item) <= to)
      .filter((entry) => !author || entry.authors.toLowerCase().includes(author))
      .filter((entry) => !status || (typeof entry.item.status === "string" && entry.item.status.toLowerCase() === status))
      .filter((entry) => tags.every((tag) => tagsOf(entry.item).includes(tag)))
      .sort((a, b) => a.file.path.localeCompare(b.file.path));
    const page = all.slice(0, limit);
    return {
      references: page.map((entry) => ({
        citekey: entry.citekey, path: entry.file.path, title: entry.title, year: yearOf(entry.item),
        authors: entry.authors, status: entry.item.status ?? "", tags: tagsOf(entry.item),
        DOI: entry.item.DOI ?? null, PMID: entry.item.PMID ?? null,
      })),
      ...(all.length > limit ? { nextCursor: page[page.length - 1].file.path } : {}),
    };
  }

  private async getReference(citekey: string): Promise<Record<string, unknown>> {
    const file = this.plugin.library.getFile(citekey);
    const item = this.plugin.library.getItem(citekey);
    if (!file || !item) throw new Error(`NOT_FOUND: reference not found: ${citekey}`);
    const note = await this.vault.readFullNote(file.path);
    const raw = note.content;
    const marker = raw.indexOf(STASH_MARKER);
    return {
      citekey, path: file.path, metadata: item,
      content: marker < 0 ? raw : raw.slice(0, marker).trimEnd(),
      fullTextOmitted: marker >= 0,
      hash: note.hash,
    };
  }

  private async listTags(): Promise<Record<string, unknown>> {
    const counts = new Map<string, number>();
    for (const entry of await this.safeEntries()) {
      for (const tag of tagsOf(entry.item)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return { tags: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)) };
  }

  private async searchPubmed(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const hits: PubmedHit[] = await this.deps.searchPubmed(stringArg(args, "query"), {
      n: numberArg(args, "limit", 8, 1, 50),
      from: args.year_from === undefined ? undefined : String(numberArg(args, "year_from", 0, 1000, 3000)),
      to: args.year_to === undefined ? undefined : String(numberArg(args, "year_to", 0, 1000, 3000)),
      apiKey: this.plugin.settings.pubmedApiKey,
      email: this.plugin.settings.openalexMailto,
    });
    const results = [];
    for (const hit of hits) {
      let existingCitekey = this.plugin.library.findDuplicate(hit.item);
      if (existingCitekey) {
        const file = this.plugin.library.getFile(existingCitekey);
        try {
          if (!file) existingCitekey = null;
          else await this.vault.assertPath(file.path, false);
        } catch {
          existingCitekey = null;
        }
      }
      results.push({ ...hit, existingCitekey });
    }
    return { results };
  }

  private async addReference(identifier: string): Promise<Record<string, unknown>> {
    const raw = identifier.trim();
    if (/^\d+$/.test(raw)) throw new Error("AMBIGUOUS_IDENTIFIER: use an explicit PMID such as PMID:12345");
    const id = detectId(raw);
    if (id.kind === "unknown") throw new Error("INVALID_IDENTIFIER: use an explicit identifier; search_pubmed can resolve a title");
    const item = await this.deps.fetchMetadata(id, this.plugin.settings.pubmedApiKey, this.plugin.settings.openalexMailto);
    const duplicate = this.plugin.library.findDuplicate(item);
    if (duplicate) {
      const file = this.plugin.library.getFile(duplicate);
      if (!file) throw new Error(`NOT_FOUND: duplicate reference file not found: ${duplicate}`);
      await this.vault.assertPath(file.path, false);
      return { status: "existing", citekey: duplicate, path: file.path, metadata: item };
    }
    await this.vault.assertPath(`${this.plugin.library.folder()}/__mcp_write_probe__.md`, true);
    const file = await this.plugin.library.createReference(item);
    const citekey = this.plugin.library.findDuplicate(item) ?? file.basename;
    return { status: "created", citekey, path: file.path, metadata: item };
  }
}
