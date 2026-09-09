# Obsidian MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship version 0.5.0 with a secure desktop MCP connection that lets Claude Code and Codex search the live Obsidian library, collect references, manage Markdown notes, and compile manuscripts without invoking an Obsidian LLM.

**Architecture:** A dependency-free stdio bridge forwards MCP JSON-RPC to an authenticated ephemeral loopback server owned by the running plugin. The plugin dispatches typed tools into the existing `IndexManager`, `Library`, ingestion, vault, and citation code; all synthesis remains in the external MCP client.

**Tech Stack:** TypeScript 5.3, Obsidian Plugin API, Node `http`/`crypto`/`fs`/`os`/`path`, MCP JSON-RPC over stdio and loopback HTTP, esbuild, assert-style Node checks.

**Spec:** `docs/superpowers/specs/2026-09-10-obsidian-mcp-design.md`

## Global Constraints

- Target release is exactly 0.5.0 with minimum Obsidian 1.7.2.
- MCP is disabled by default and starts only in Obsidian Desktop.
- Bind only to `127.0.0.1` on an ephemeral port and authenticate every request with a per-start 256-bit token.
- MCP code must never call `LLMClient`, `RagChat`, the LLM reranker, or summarization; embeddings remain allowed for search and index rebuild.
- Permit only vault-relative Markdown paths outside `.obsidian/`; never expose arbitrary commands, shell access, or binary writes.
- Require current SHA-256 hashes for update, move, and trash; trash must use Obsidian's recoverable trash path.
- Keep `isDesktopOnly: false`; mobile skips MCP startup cleanly.
- Add no runtime dependency unless Node and the already-installed packages cannot cover the requirement.

---

### Task 1: Pure MCP protocol and generated stdio bridge

**Files:**
- Create: `src/mcp/protocol.ts`
- Create: `src/mcp/bridge.ts`
- Create: `test/mcp.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `McpRequest`, `McpResponse`, `McpTool`, `mcpSuccess(id, result)`, `mcpError(id, code, message, data?)`, `handleProtocol(request, tools, callTool)`.
- Produces: `bridgeSource(): string`, a complete Node CommonJS stdio program accepting `--vault <absolute-path>`.
- Consumes later: `McpHttpServer` calls `handleProtocol`; startup writes `bridgeSource()` beside `main.js`.

- [ ] **Step 1: Add a failing protocol/bridge check**

Create `test/mcp.ts` with Node assertions that call `handleProtocol` for `initialize`, `ping`,
`tools/list`, `tools/call`, unknown method, invalid parameters, and a notification; also compile
`bridgeSource()` with `new Function("require", "process", source)` so syntax errors fail.

```ts
const tools: McpTool[] = [{
  name: "echo",
  description: "Return text.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
}];
const initialized = await handleProtocol(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  tools,
  async (_name, args) => args
);
assert.equal(initialized?.result?.serverInfo?.name, "rag-obsidian");
assert.equal((await handleProtocol({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools, async () => ({})))?.result?.tools.length, 1);
```

- [ ] **Step 2: Add and run the isolated test command**

Add `test:mcp` using esbuild with the Obsidian shim, and make `test` run it before the existing
integration bundle.

```json
"test:mcp": "esbuild test/mcp.ts --bundle --platform=node --format=cjs --alias:obsidian=./test/obsidian-shim.ts --outfile=_test-mcp.cjs && node _test-mcp.cjs",
"test": "npm run test:mcp && esbuild test/integration.ts --bundle --platform=node --format=cjs --alias:obsidian=./test/obsidian-shim.ts --outfile=_test.cjs && node _test.cjs"
```

Run: `npm run test:mcp`  
Expected: FAIL because `src/mcp/protocol.ts` and `src/mcp/bridge.ts` do not exist.

- [ ] **Step 3: Implement the smallest MCP protocol dispatcher**

Support only `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
Return MCP content as text plus `structuredContent`, pass the client's supported protocol version
through when recognized, and use JSON-RPC codes `-32600`, `-32601`, `-32602`, and `-32603`.

```ts
export async function handleProtocol(
  req: McpRequest,
  tools: McpTool[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<McpResponse | null> {
  if (req.id === undefined) return null;
  if (req.method === "ping") return mcpSuccess(req.id, {});
  if (req.method === "tools/list") return mcpSuccess(req.id, { tools });
  if (req.method === "tools/call") {
    const { name, arguments: args = {} } = req.params ?? {};
    if (typeof name !== "string" || !args || typeof args !== "object")
      return mcpError(req.id, -32602, "Invalid tools/call parameters");
    const value = await callTool(name, args as Record<string, unknown>);
    return mcpSuccess(req.id, {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    });
  }
  return mcpError(req.id, -32601, `Method not found: ${req.method}`);
}
```

- [ ] **Step 4: Implement the dependency-free bridge source**

The emitted CommonJS program parses `--vault`, hashes the canonical vault path to find the OS-temp
discovery file, reads stdin one JSON object per line, POSTs it with bearer auth, emits responses
only when a request has an id, limits responses, and prints actionable connection errors as MCP
errors rather than human prose on stdout. Diagnostics go to stderr.

- [ ] **Step 5: Run the focused checks**

Run: `npm run test:mcp && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the protocol unit**

```bash
git add src/mcp/protocol.ts src/mcp/bridge.ts test/mcp.ts package.json
git commit -m "feat: add MCP protocol bridge"
```

---

### Task 2: Safe Markdown vault operations

**Files:**
- Create: `src/mcp/vault.ts`
- Modify: `test/mcp.ts`
- Modify: `test/obsidian-shim.ts`

**Interfaces:**
- Produces: `contentHash(content: string): Promise<string>`.
- Produces: `validateMarkdownPath(path: string): string` for vault-relative normalized `.md` paths outside `.obsidian`.
- Produces: `McpVault` with `listNotes`, `readNote`, `createNote`, `updateNote`, `replaceInNote`, `moveNote`, and `trashNote`.
- Mutation results: `{ path: string; hash: string; indexQueued: boolean }` where applicable.

- [ ] **Step 1: Add failing validation and mutation checks**

Use an in-memory fake vault/file manager. Cover valid nested notes; absolute paths; `..`; encoded or
backslash traversal; `.obsidian`; non-Markdown targets; bounded pagination; create collision;
wrong hash; zero/multiple exact replacements; move collision; and recoverable trash.

```ts
for (const bad of ["/tmp/x.md", "../x.md", ".obsidian/data.json", "PDFs/a.pdf", "C:\\x.md"])
  assert.throws(() => validateMarkdownPath(bad));
assert.equal(validateMarkdownPath("Manuscripts/paper.md"), "Manuscripts/paper.md");
assert.equal((await contentHash("same")), await contentHash("same"));
```

- [ ] **Step 2: Run the checks and verify the failure**

Run: `npm run test:mcp`  
Expected: FAIL because `McpVault` is missing.

- [ ] **Step 3: Implement validation, hashes, and bounded reads**

Use `crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))` so hashing works in
Obsidian and Node tests. Clamp `maxChars` to 1–50,000 and return `nextOffset` only when content
remains. Resolve existing paths through Obsidian's vault index; before mutation, the desktop
server separately verifies realpath containment.

- [ ] **Step 4: Implement serialized Markdown mutations**

Use a promise chain local to `McpVault`. Re-read and hash immediately before update, replacement,
move, or trash. Create parent folders one segment at a time through `Vault.createFolder`; move with
`FileManager.renameFile`; trash with `FileManager.trashFile`.

```ts
private serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = this.chain.then(job);
  this.chain = run.catch(() => undefined);
  return run;
}
```

- [ ] **Step 5: Run focused and project checks**

Run: `npm run test:mcp && npm run typecheck && npm run lint`  
Expected: PASS with only the project's documented lint warnings.

- [ ] **Step 6: Commit safe vault access**

```bash
git add src/mcp/vault.ts test/mcp.ts test/obsidian-shim.ts
git commit -m "feat: add safe MCP vault operations"
```

---

### Task 3: Typed research and writing tools

**Files:**
- Create: `src/mcp/service.ts`
- Modify: `src/index/manager.ts`
- Modify: `src/data/library.ts`
- Modify: `test/mcp.ts`

**Interfaces:**
- Produces: `MCP_TOOLS: McpTool[]` with accurate schemas and read-only/destructive annotations.
- Produces: `McpService.callTool(name, args): Promise<unknown>`.
- Consumes: `McpVault`, `IndexManager.search/rebuild`, `Library.entries/getFile/getItem/createReference`, `searchPubmed`, `detectId`, and `fetchMetadata`.
- Adds: `IndexManager.providerId(): string | null`, returning null without creating a provider when the index is not ready.

- [ ] **Step 1: Add failing tool-discovery and dispatch checks**

Assert exact tool names, required fields, annotations, input limits, unknown-argument rejection,
status without provider calls, search result shape, filter mapping, reranker independence, PubMed
duplicate flags, explicit-ID add, bare-number rejection, free-title rejection, and unknown-tool
errors.

```ts
assert.deepEqual(MCP_TOOLS.map((t) => t.name), [
  "library_status", "search_library", "rebuild_search_index", "list_references",
  "get_reference", "list_tags", "search_pubmed", "add_reference", "list_notes",
  "read_note", "create_note", "update_note", "replace_in_note", "move_note",
  "trash_note", "compile_manuscript",
]);
```

- [ ] **Step 2: Run the check and verify the failure**

Run: `npm run test:mcp`  
Expected: FAIL because `McpService` and tool definitions are missing.

- [ ] **Step 3: Add small argument readers and tool definitions**

Keep validation local to `service.ts`: `stringArg`, `optionalString`, `numberArg`, and
`stringArrayArg`. Reject unknown keys so misspelled arguments do not silently broaden a search or
write. Tool descriptions include the search→read→cite workflow and state that factual writing
uses only returned evidence and real `[@citekey]` values.

- [ ] **Step 4: Implement local retrieval tools**

`search_library` calls only `index.search(query, filters, limit)`. `list_references`,
`get_reference`, and `list_tags` scan `Library.entries()` once per call. Strip the extracted
full-text section from `get_reference` while retaining frontmatter, abstract, notes, and summaries.
Pagination uses sorted path cursors and a maximum page size of 100.

- [ ] **Step 5: Implement PubMed discovery and deterministic add**

`search_pubmed` calls the existing helper with plugin settings, then checks each CSL item with
`Library.findDuplicate`. `add_reference` requires an explicit prefix for PMID, calls the existing
metadata resolver, returns existing duplicates without mutation, and otherwise calls
`Library.createReference`. It never imports summarization modules.

- [ ] **Step 6: Delegate Markdown tools to `McpVault`**

Pass only schema-validated arguments. Advertise `readOnlyHint: true` for reads,
`destructiveHint: true` only for `trash_note`, and `idempotentHint` where hashes make retries safe.

- [ ] **Step 7: Run focused and project checks**

Run: `npm run test:mcp && npm run typecheck && npm run lint`  
Expected: PASS with documented warnings only.

- [ ] **Step 8: Commit the MCP tool service**

```bash
git add src/mcp/service.ts src/index/manager.ts src/data/library.ts test/mcp.ts
git commit -m "feat: expose library tools over MCP"
```

---

### Task 4: Share manuscript compilation with MCP

**Files:**
- Modify: `src/commands/writing.ts`
- Modify: `src/mcp/service.ts`
- Modify: `test/mcp.ts`

**Interfaces:**
- Produces: `renderCompiledManuscript(plugin, file, content): Promise<{ content: string; cited: string[]; missing: string[] }>`.
- Existing `compileManuscript(plugin)` remains the Obsidian UI wrapper.
- `McpService` receives a `compile(path, outputPath?, expectedOutputHash?)` callback so protocol code stays UI-free.

- [ ] **Step 1: Add a failing shared-compiler check**

Exercise known/unknown citekeys, CSL success, lightweight fallback, preservation of code spans,
and source/output collision rejection. Assert that the returned content contains the bibliography
and no resolved `[@known]` marker while `missing` reports unknown keys.

- [ ] **Step 2: Run the check and verify the failure**

Run: `npm run test:mcp`  
Expected: FAIL because `renderCompiledManuscript` is not exported.

- [ ] **Step 3: Extract non-UI compilation without changing behavior**

Move the body currently inside `compileManuscript` into the exported helper. Keep notices, active
file lookup, output naming, opening, and error display in the command wrapper. Return content and
citekey status from the helper.

- [ ] **Step 4: Add the MCP file wrapper**

Read the source through `McpVault`; choose `<stem> (compiled).md` when `output_path` is absent;
reject output equal to source; create a missing output; require matching `expected_output_hash`
before replacing an existing output.

- [ ] **Step 5: Run checks**

Run: `npm run test:mcp && npm test && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit shared manuscript compilation**

```bash
git add src/commands/writing.ts src/mcp/service.ts test/mcp.ts
git commit -m "feat: compile manuscripts through MCP"
```

---

### Task 5: Authenticated desktop loopback server and plugin lifecycle

**Files:**
- Create: `src/mcp/http.ts`
- Modify: `main.ts`
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `test/mcp.ts`
- Modify: `test/obsidian-shim.ts`

**Interfaces:**
- Produces: `McpHttpServer.start(): Promise<McpConnectionInfo>`, `stop(): Promise<void>`, `restart(): Promise<McpConnectionInfo>`, `status(): McpServerStatus`.
- `ScholarRagSettings` gains `mcpEnabled: boolean`, default false.
- `ScholarRagPlugin` owns `mcpServer`, starts it after layout readiness when enabled, and awaits stop in `onunload` where possible.

- [ ] **Step 1: Add failing HTTP security/lifecycle checks**

Start on an ephemeral port with a fake service. Assert loopback binding, `POST` only, exact bearer
token, JSON content type, host validation, body limit, request timeout, JSON-RPC forwarding,
discovery mode `0600`, stale discovery replacement, bridge emission, and cleanup that refuses to
delete another process's record.

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:mcp`  
Expected: FAIL because `McpHttpServer` is missing.

- [ ] **Step 3: Implement desktop server lifecycle**

Use dynamic Node imports inside `start`, bind `server.listen(0, "127.0.0.1")`, create the token
with `randomBytes(32).toString("hex")`, and set `requestTimeout`, `headersTimeout`, and maximum
body bytes. Hash the canonical vault path for the discovery filename and write atomically with
mode `0o600`.

- [ ] **Step 4: Add realpath containment before mutations**

Use the desktop adapter's base path, `realpath` for the vault and nearest existing parent, and
`path.relative` to reject symlink escapes. Keep lexical validation in `McpVault`; the server adds
this OS-level trust-boundary check to every mutation path, including both move endpoints.

- [ ] **Step 5: Wire plugin startup and shutdown**

Instantiate the service after `IndexManager`, start only when `Platform.isDesktopApp &&
settings.mcpEnabled`, and stop on unload/toggle. Server failures show one Notice and leave the
rest of the plugin operational. Do not change `manifest.json.isDesktopOnly`.

- [ ] **Step 6: Add the desktop settings section**

Add enable/disable, connection status, setup-copy buttons, rotate/restart, and stop controls.
Generate shell-safe Claude Code and TOML-safe Codex snippets from the canonical vault and bridge
paths. Never display or copy the bearer token.

- [ ] **Step 7: Run all automated gates**

Run: `npm run test:mcp && npm test && npm run typecheck && npm run lint && npm run build`  
Expected: all commands exit 0; lint may print only existing documented warnings.

- [ ] **Step 8: Commit the live MCP connection**

```bash
git add src/mcp/http.ts main.ts src/types.ts src/settings.ts test/mcp.ts test/obsidian-shim.ts
git commit -m "feat: connect MCP clients to Obsidian"
```

---

### Task 6: User and developer documentation

**Files:**
- Create: `docs/MCP.md`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `CLAUDE.md`
- Modify: `docs/MOBILE.md`
- Modify: `docs/STORE_SUBMISSION.md`

**Interfaces:**
- Documents the exact generated setup snippets and all 16 tool contracts implemented above.
- Documents that MCP calls embeddings for semantic search/rebuild but never invokes an Obsidian LLM.

- [ ] **Step 1: Write the complete MCP guide**

Cover requirements, enablement, Claude Code, Codex, status verification, search/cite workflow,
PubMed add workflow, drafting and compilation, all tool parameters/results, mutation hashes,
trash recovery, security model, multiple vaults, Obsidian-closed behavior, disabling, uninstall,
and troubleshooting.

- [ ] **Step 2: Update both READMEs symmetrically**

Add MCP to features, quick start, provider-cost explanation, commands/settings, desktop/mobile
notes, and link `docs/MCP.md`. State explicitly that Claude/Codex writes the answer and citations;
the plugin returns evidence and does not call its chat model.

- [ ] **Step 3: Update internal and review documentation**

Add the MCP modules and flow to `CLAUDE.md`; mark MCP desktop-only in `docs/MOBILE.md`; record the
loopback listener, generated bridge, authentication, filesystem restrictions, and release-review
implications in `docs/STORE_SUBMISSION.md`.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n "MCP|mcpEnabled|search_library|trash_note|compile_manuscript" README.md README.ko.md CLAUDE.md docs src
rg -n "MCP.*LLM|LLM.*MCP" README.md README.ko.md docs/MCP.md
```

Expected: both languages link the same guide; tool names match `MCP_TOOLS`; no text claims MCP can
run while Obsidian is closed or that it uses the chat model.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/MCP.md README.md README.ko.md CLAUDE.md docs/MOBILE.md docs/STORE_SUBMISSION.md
git commit -m "docs: explain Claude and Codex MCP workflows"
```

---

### Task 7: Version 0.5.0 and final verification

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `versions.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces a consistent 0.5.0 release state with Obsidian minimum 1.7.2.

- [ ] **Step 1: Add the 0.5.0 changelog entry**

Move release content out of Unreleased and describe MCP tools, external-model synthesis, safe note
mutations, PubMed collection, manuscript compilation, desktop-only bridge, documentation, and the
embedding-versus-LLM cost boundary.

- [ ] **Step 2: Update every version location**

Set 0.5.0 in `manifest.json`, `package.json`, the two root package versions in
`package-lock.json`, README badges, and `CLAUDE.md`; append `"0.5.0": "1.7.2"` to
`versions.json`.

- [ ] **Step 3: Run the complete clean gate**

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: every command exits 0, integration checks retain their existing green count plus MCP
checks, `main.js` builds, and there is no whitespace error.

- [ ] **Step 4: Verify release consistency and forbidden calls**

```bash
rg -n '0\.4\.19' manifest.json package.json README.md README.ko.md CLAUDE.md versions.json
rg -n 'LLMClient|RagChat|rerankHits|summarizeSource' src/mcp
git status --short
```

Expected: the first command finds only historical prose if any; the second finds no executable MCP
imports or calls; status contains only intended 0.5.0 files and the generated ignored build output.

- [ ] **Step 5: Perform a real-vault smoke test**

With Obsidian Desktop open on the configured test vault, enable MCP and connect Claude Code, then
Codex. For each client call `library_status`, `search_library`, `read_note`, `create_note`,
`replace_in_note`, conflict with an old hash, `move_note`, `trash_note`, `search_pubmed`, add one
known test PMID or confirm its duplicate, and compile a two-citation manuscript. Confirm the trash
is recoverable in Obsidian and no chat/summary-provider request appears in logs.

- [ ] **Step 6: Commit the release**

```bash
git add manifest.json package.json package-lock.json versions.json CHANGELOG.md README.md README.ko.md CLAUDE.md
git commit -m "release: 0.5.0"
```

- [ ] **Step 7: Review final history and working tree**

Run: `git log --oneline -8 && git status --short`  
Expected: design, implementation, docs, and release commits are present; working tree is clean.
