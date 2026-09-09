# Obsidian MCP integration design

**Date:** 2026-09-10  
**Target release:** 0.5.0

## Goal

Let Claude Code, Codex, and other MCP clients use the reference library while Obsidian is
running. The external model must be able to search the same hybrid index as the Obsidian search
pane, inspect cited source material, find and add papers, and create, edit, move, or trash Markdown
notes. It can then write manuscripts with stable `[@citekey]` citations and ask the plugin to
compile them.

The MCP path never calls `LLMClient`, `RagChat`, the chat model, the optional LLM reranker, or the
summary model. Claude or Codex performs all synthesis. The only model request the plugin may make
for MCP is the embedding request already required by `IndexManager.search` or `rebuild`.

## Non-goals

- Running without Obsidian.
- Exposing the vault over the LAN or internet.
- Reading or changing `.obsidian/` through MCP.
- Editing binary attachments.
- Reproducing the Obsidian chat history or chat UI.
- Adding a second search index or a second copy of reference-ingestion logic.

## Architecture

```text
Claude Code / Codex
        │ MCP over stdio
        ▼
generated mcp-bridge.cjs (Node stdlib only)
        │ authenticated HTTP on 127.0.0.1
        ▼
McpService inside the running Obsidian plugin
        ├── IndexManager       hybrid BM25 + vector retrieval
        ├── Library            reference metadata and citekeys
        ├── ingest modules     PubMed / DOI / PMID / arXiv / OpenAlex
        ├── Vault/FileManager  Markdown note operations and trash
        └── CiteEngine         manuscript compilation
```

The desktop plugin binds an ephemeral port on `127.0.0.1`. At startup it generates a 256-bit
token and writes a discovery file, readable only by the current OS user, under the OS temporary
directory. The discovery filename is derived from the canonical vault path, so multiple open
vaults do not collide. It contains the port, token, plugin version, vault path, and process ID.

The plugin also writes a tiny, generated `mcp-bridge.cjs` beside its installed `main.js`. The
bridge uses only Node built-ins, reads newline-delimited MCP JSON-RPC from stdin, locates the
discovery file from a required `--vault` argument, forwards each message to the loopback server,
and writes the JSON-RPC response to stdout. Keeping the bridge dependency-free means BRAT and the
community installer still need only the normal three release files; the installed plugin creates
the bridge itself.

The MCP server is desktop-only, but the rest of the plugin remains mobile-capable. Node imports,
server startup, discovery, and bridge generation live behind `Platform.isDesktopApp`; mobile never
loads or executes them.

## Lifecycle and configuration

MCP is disabled by default. A desktop-only settings section provides:

- **Enable MCP access** toggle.
- Read-only connection status and the current vault path.
- **Copy Claude Code setup command** and **Copy Codex config** actions.
- **Rotate access token** and **Stop MCP server** actions.

Enabling starts the server and writes the bridge/discovery files. Disabling or unloading closes
the listener and removes the discovery file only if it still carries this process's token. A new
token is generated on every start, so a stale discovery file or copied token cannot reconnect.
The MCP client configuration contains the vault path, not the token.

If Obsidian is closed, the bridge returns one actionable connection error and stays alive so the
MCP client can retry after Obsidian opens. It never starts Obsidian itself.

## MCP behavior and guidance

The server advertises tools only; it does not add MCP resources or prompts in 0.5.0. Tool
descriptions carry the operating guidance the model needs:

1. Check `library_status` when connection or index state is uncertain.
2. Use `search_library` before writing factual claims.
3. Use `get_reference` or `read_note` when more context is needed.
4. Cite claims as `[@citekey]`; never invent a citekey.
5. Use `search_pubmed`, then `add_reference`, when the local library lacks evidence.
6. Read a note immediately before modifying or trashing it and pass back its content hash.

Every successful result is both concise text and structured JSON. Errors use stable codes plus an
actionable message. Search results always include `citekey`, title, year, section, matched passage,
score, and note path. Mutation results include path, new content hash, and whether the search index
update has merely been queued.

## Tool contracts

### Discovery and retrieval

`library_status()`

- Returns plugin version, vault name/path, reference folder, index readiness, chunk count, and
  embedding model ID.
- Makes no provider request.

`search_library(query, limit?, year_from?, year_to?, author?, tags?)`

- Calls `IndexManager.search` and therefore uses the existing index and embedding provider.
- Defaults to the plugin's top-k and applies the existing per-reference cap.
- Never enables the LLM reranker, even when the Obsidian chat setting enables it.
- Returns an `INDEX_NOT_READY` error that tells the model to call `rebuild_search_index`.

`rebuild_search_index()`

- Calls the existing serialized index rebuild and returns the indexed chunk count.
- May use the configured embedding provider; it never uses a chat or summary model.
- Marked non-read-only because it writes the plugin's private index.

`list_references(limit?, cursor?, status?, year_from?, year_to?, author?, tags?)`

- Lists reference metadata without embeddings or network calls.
- Uses a stable path-based cursor and caps page size.

`get_reference(citekey)`

- Resolves frontmatter citekeys independently of filenames.
- Returns metadata, abstract/summary body, note path, and content hash.
- Extracted full-text stash is omitted to avoid flooding the model; relevant full-text passages
  remain available through `search_library`. `read_note` can retrieve explicit ranges.

`list_tags()`

- Returns the existing reference tags and counts, with no model or network call.

### External paper discovery and collection

`search_pubmed(query, limit?, year_from?, year_to?)`

- Reuses `searchPubmed` and the plugin's NCBI key/contact settings.
- Returns PMID, PMCID when present, CSL metadata, and whether a duplicate already exists locally.
- Does not add, summarize, tag with an LLM, or mutate anything.

`add_reference(identifier)`

- Accepts an explicit DOI, `PMID:...`, arXiv ID, or OpenAlex work ID/URL.
- Reuses `detectId`, `fetchMetadata`, duplicate detection, and `Library.createReference`.
- Rejects ambiguous bare numeric identifiers and free-text titles; the model should use
  `search_pubmed` and pass an explicit PMID instead.
- Returns `created` or `existing`, citekey, path, and metadata.
- Does not invoke summaries, MeSH suggestion, or any LLM.

### Vault Markdown operations

All paths are vault-relative, normalized, must end in `.md`, and must remain outside `.obsidian/`.
Symlink/realpath containment is checked by the desktop adapter before any write. Binary files and
directories are rejected.

`list_notes(folder?, limit?, cursor?)`

- Lists Markdown paths and basic metadata. It does not return note bodies.

`read_note(path, offset?, max_chars?)`

- Returns a bounded character range, total length, continuation offset, and SHA-256 of the entire
  note. Default and maximum response sizes prevent a stashed PDF from consuming the context.

`create_note(path, content)`

- Creates missing parent folders and a new Markdown file.
- Fails rather than overwriting an existing note.

`update_note(path, content, expected_hash)`

- Replaces a whole Markdown note only when `expected_hash` matches the current content.
- Returns `CONTENT_CHANGED` on concurrent user/plugin edits.

`replace_in_note(path, old_text, new_text, expected_hash)`

- Performs exactly one literal replacement; zero or multiple matches fail without writing.
- Covers ordinary surgical edits without sending the whole note back to the server.

`move_note(path, new_path, expected_hash)`

- Uses Obsidian's file manager so links can be updated according to the user's Obsidian settings.
- Rejects overwrite and validates both paths.

`trash_note(path, expected_hash)`

- Uses Obsidian's trash behavior; it never permanently deletes.
- Requires a fresh hash and is advertised with MCP's destructive annotation so clients can ask
  for user confirmation.

### Manuscripts

`compile_manuscript(path, output_path?, expected_output_hash?)`

- Refactors the existing command's non-UI work into a shared function, then resolves
  `[@citekey]` citations and writes a compiled Markdown copy.
- Never overwrites the source. The default output is `<name> (compiled).md`; an existing output
  requires `expected_output_hash` to match its current content or the call fails.
- Returns the output path, cited and missing citekeys, and content hash.

## Protocol surface

The bridge forwards MCP `initialize`, `notifications/initialized`, `ping`, `tools/list`, and
`tools/call`. The plugin negotiates a supported protocol version, advertises no capabilities
beyond tools, and returns standard JSON-RPC method/parameter errors. Unknown methods and tools are
rejected. Requests and responses have conservative size limits, and each request has a timeout.

The HTTP endpoint accepts only `POST`, loopback peers, an exact bearer token, JSON content type,
and the expected `Host`. It sends no CORS headers. Logs contain tool names, duration, and result
status but never tokens, full note bodies, queries, or returned passages.

## Concurrency and failure handling

- Index mutations continue through `IndexManager`'s existing serialization chain.
- Vault writes run through one MCP mutation queue, preventing two external writes from
  interleaving. Obsidian UI edits are detected by `expected_hash` immediately before mutation.
- Vault create/modify/rename/delete events continue to drive incremental indexing and citation
  graph maintenance; MCP does not write index files directly.
- Requests rejected for auth, invalid paths, stale hashes, duplicates, missing notes, or oversized
  payloads make no mutation.
- If a write succeeds but the client disconnects, retrying is safe: creates report existing,
  hash-guarded writes report changed/already-applied state, and trash reports missing.

## Implementation boundaries

- `src/mcp/service.ts`: tool definitions, dispatch, result/error shaping, and MCP-level guidance.
- `src/mcp/vault.ts`: path validation, bounded reads, hashes, and Markdown mutations.
- `src/mcp/http.ts`: desktop loopback lifecycle, authentication, discovery file, and protocol
  handling.
- `src/mcp/bridge.ts`: dependency-free bridge source emitted into the installed plugin folder.
- `src/mcp/types.ts`: small shared request/result types only where they prevent drift.
- `main.ts`: owns `McpService`, starts/stops it with the plugin, and exposes shared manuscript
  compilation entry points.
- `src/settings.ts` and `src/types.ts`: enable flag, port/status controls, and setup snippets.

No generic command executor, shell tool, arbitrary Obsidian-command tool, filesystem API, or chat
endpoint is added.

## Verification

Automated checks cover:

- JSON-RPC initialization, tool discovery, calls, errors, auth, timeouts, and payload limits.
- Every path rejection, including traversal, absolute paths, `.obsidian`, non-Markdown targets,
  and realpath/symlink escape.
- Hash conflicts, exact replacement cardinality, create collisions, move collisions, and trash.
- Search filters/result shape and proof that MCP retrieval does not instantiate `LLMClient` or
  invoke reranking.
- PubMed result shaping, duplicate add behavior, and ambiguous identifier rejection.
- Bridge forwarding with a fake loopback server and the Obsidian-closed error.
- Mobile load with the MCP server disabled by platform detection.
- Existing integration suite, typecheck, build, and lint.

A manual smoke test connects both Claude Code and Codex to a real test vault and exercises status,
search, add, read, create, edit conflict, move, trash, and manuscript compilation.

## Documentation and release

- Add `docs/MCP.md`: prerequisites, enabling MCP, Claude Code setup, Codex setup, tool reference,
  example research/writing workflows, security model, troubleshooting, disabling, and uninstall.
- Update English and Korean READMEs with the MCP feature, quick start, LLM/embedding cost behavior,
  and a link to the full guide.
- Update `CLAUDE.md` architecture/module map and the release state.
- Update `docs/MOBILE.md` to mark MCP as desktop-only without making the plugin desktop-only.
- Update `docs/STORE_SUBMISSION.md` for the loopback server, generated bridge, network/security
  review notes, and additional release artifact behavior.
- Add a complete `CHANGELOG.md` 0.5.0 entry.
- Set 0.5.0 in `manifest.json`, `package.json`, both root entries in `package-lock.json`, the README
  badges, `CLAUDE.md`, and `versions.json` with minimum Obsidian 1.7.2.

## Deliberate limits for 0.5.0

- One running Obsidian process owns a vault's discovery record. Add multi-process selection only
  if real usage demonstrates a need.
- Tools, not MCP resources/prompts, are sufficient for current Claude/Codex workflows. Add those
  only when a client use case cannot be expressed cleanly through tool descriptions.
- Markdown only. Add attachment/PDF mutation tools only with a concrete safe workflow.
- No remote transport. A separately authenticated remote service is a different product and
  threat model.
