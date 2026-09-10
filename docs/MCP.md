# Claude Code / Codex MCP integration

**English** · [한국어](MCP.ko.md)

Version 0.5.0 introduced access to the vault currently open in Obsidian; 0.5.2 added the external
reference-summary workflow. Claude Code or Codex finds evidence and writes prose; the plugin
exposes its library, index, citation engine, and safe Markdown operations as MCP tools.

## How it works

```text
Claude Code / Codex
        │ MCP over stdio
        ▼
mcp-bridge.cjs (Node standard library only)
        │ authenticated request to 127.0.0.1
        ▼
running Obsidian plugin
        ├─ library / PubMed / search index
        ├─ create, edit, move, and trash Markdown
        └─ citeproc manuscript compilation
```

- Obsidian Desktop must remain open with this plugin enabled in the target vault.
- The MCP path **never calls Chat with library, the summary LLM, or the LLM reranker**. Claude
  Code or Codex performs all reasoning and generation.
- Only `search_library` and `rebuild_search_index` may call the configured embedding provider.
- There is no account, remote MCP endpoint, persistent daemon, or standalone backend. The plugin
  listens only on a random `127.0.0.1` port and stops with Obsidian.
- Version 0.6.0 declares the complete plugin desktop-only because this bundle contains the
  Node-based MCP server.

## Connect a client

1. Open the target vault in Obsidian Desktop.
2. Go to **Settings → Academic Paper Citation Manager → External AI (MCP)**.
3. Enable **MCP access**.
4. Copy the generated Claude Code command or Codex configuration.
5. Restart or refresh the external client's MCP connections.

Prefer the copy buttons: they quote the exact bridge and vault paths correctly.
After migrating from 0.5.x, copy the setup again because the plugin directory—and therefore the
bridge path—changed. The MCP server name `rag-obsidian` does not need to change.

### Claude Code

```bash
claude mcp add --transport stdio rag-obsidian -- node '/absolute/path/to/mcp-bridge.cjs' --vault '/absolute/path/to/vault'
claude mcp list
```

### Codex

Add the generated block to the Codex configuration:

```toml
[mcp_servers.rag-obsidian]
command = "node"
args = ["/absolute/path/to/mcp-bridge.cjs", "--vault", "/absolute/path/to/vault"]
```

To connect several vaults, give each server a distinct name and use the bridge/vault paths copied
from that vault's settings.

## Recommended prompts

Search existing evidence:

```text
Find evidence in my Obsidian library about readmission risk after endoscopic spine surgery.
Check library_status first and use search_library more than once if needed. Cite every supported
claim with only the returned citekeys in [@citekey] form, then list the papers used.
```

Find and save papers:

```text
Search PubMed for cervical myelopathy frailty papers since 2023. Show the search_pubmed results
first. After I select papers, add each one with its explicit PMID, retrieve the best available
source, write a faithful structured English and Korean summary, and save it to the reference note.
```

`add_reference` accepts only an explicit DOI, `PMID:12345`, arXiv ID, or OpenAlex work ID. It
rejects bare numbers and titles so a fuzzy match cannot silently add the wrong paper.

### External summary workflow

For each selected paper, the client should perform this sequence:

```text
add_reference
  → get_reference_source
  → Claude Code / Codex writes Background, Methods, Results, Conclusions (+ optional Korean)
  → save_reference_summary
```

`get_reference_source` tries PMC open-access full text when PMID/PMCID metadata identifies it, then
falls back to the PubMed or stored metadata abstract. It returns `sourceType` (`pmc-fulltext`,
`pubmed-abstract`, or `stored-abstract`) and the current whole-note `hash`. The external client must use
only that returned text, preserve reported quantities and uncertainty, and pass both values to
`save_reference_summary`. The save replaces only `## Summary`, keeps `## Notes` and
`## Highlights`, and records `summary_source` and `summary_model` in frontmatter.

This is intentionally a two-tool operation around the external model: the MCP server cannot make
Claude/Codex generate text from inside a tool call, and it never redirects the request to the
Obsidian summary LLM. If the note changes while the model is writing, saving fails with
`CONTENT_CHANGED`; retrieve the source again before retrying.

To fill summaries for references that were already imported:

```text
Page through list_references and find entries whose summarySource is null. For each one, call
get_reference_source, write a source-grounded structured summary, and save it with
save_reference_summary. Process them sequentially and report any NO_SOURCE_TEXT failures.
```

Write with citations:

```text
Read Manuscripts/Review.md and strengthen the Outcomes section. Find evidence with search_library
and cite it as [@citekey]. Immediately before editing, use read_note to get the current hash, make
one precise replace_in_note call, then create a cited copy with compile_manuscript.
```

## Tools

| Tool | Purpose | Effect |
|---|---|---|
| `library_status` | Vault, plugin, and index status | Local read |
| `search_library` | Search the same BM25+vector index as Obsidian | Embeddings possible; read-only |
| `rebuild_search_index` | Rebuild the complete private index | Embeddings possible; index write |
| `list_references` | Page and filter reference metadata | Read-only |
| `get_reference` | Read metadata and note content by citekey | Read-only |
| `get_reference_source` | Get PMC full text or abstract for external summarization | Network possible; read-only |
| `save_reference_summary` | Save the external model's structured summary under a hash guard | Edits a reference note |
| `list_tags` | List library tags and counts | Read-only |
| `search_pubmed` | Search PubMed | Network; read-only |
| `add_reference` | Add a paper from an explicit identifier | Network; creates a note |
| `list_notes` | Page through Markdown note paths | Read-only |
| `read_note` | Read a bounded range and return the whole-note SHA-256 | Read-only |
| `create_note` | Create a note and missing parent folders | Creates a note |
| `update_note` | Replace a whole note if its hash still matches | Edits a note |
| `replace_in_note` | Replace one exact literal span under a hash guard | Edits a note |
| `move_note` | Move/rename through Obsidian's file manager | Moves a note |
| `trash_note` | Move a note to Obsidian's recoverable trash | Destructive, recoverable |
| `compile_manuscript` | Render `[@citekey]` and bibliography into a copy | Creates/updates output note |

## Editing and deletion safeguards

- Tools can access only `.md` files inside the vault. Absolute paths, traversal, encoded traversal,
  and the vault's Obsidian configuration folder are rejected.
- Symlinks are checked by resolved OS path. Links leaving the vault are excluded from listings,
  search results, reads, and writes.
- `create_note` never overwrites an existing path.
- Edit, move, and trash tools require the whole-note SHA-256 returned by `read_note`. If Obsidian,
  sync, or another client changes the note, the operation stops with `CONTENT_CHANGED`.
- `replace_in_note` stops unless `old_text` occurs exactly once.
- `move_note` never overwrites and uses Obsidian's file manager, including its link-update setting.
- `trash_note` uses Obsidian's configured trash instead of permanent deletion. Also review the
  external client's destructive-tool approval prompt.
- Reads are capped at 50,000 characters per call; writes at 2,000,000 characters. Writes are
  serialized.

## Local authentication

Each start creates a 256-bit session token. A mode-`0600` discovery file in the OS temporary
directory lets the bridge find the random port and token; neither appears in Claude/Codex config.
**Restart and rotate token** invalidates existing connections. **Stop server** or plugin unload
closes the port and removes discovery state.

The generated `mcp-bridge.cjs` lives beside the plugin's `main.js`, uses only Node built-ins, and
does not log vault content, API keys, or the token. This is a local same-user boundary; it cannot
protect against malicious software already able to inspect your user processes and temporary files.

## Troubleshooting

| Symptom | Action |
|---|---|
| Bridge cannot find Obsidian | Open the exact vault in Desktop, enable MCP, then restart the client |
| `CONNECTION_CLOSED` and no `mcp-bridge.cjs` on Windows | Update to 0.5.1 or later, reload Obsidian, then toggle MCP off/on |
| `ECONNREFUSED` or authentication failure | **Restart and rotate token**, then restart the client |
| `INDEX_NOT_READY` | Configure embeddings and call `rebuild_search_index` |
| `CONTENT_CHANGED` | Read again, review the current text, and retry with the new hash |
| `NO_SOURCE_TEXT` | The reference has neither retrievable PMC text nor an abstract; summarize only after supplying a source |
| `INVALID_PATH` | Use a vault-relative `.md` path outside config/external symlinks |
| `ALREADY_EXISTS` | Choose another path, or read existing compiled output and pass its expected hash |
| PubMed rate/error messages | Check the PubMed API key and contact e-mail in plugin settings |
| Plugin unavailable on mobile | Expected: version 0.6.0 is desktop-only |

To disconnect permanently, remove the `rag-obsidian` entry from the external client and disable
**MCP access** in Obsidian.
