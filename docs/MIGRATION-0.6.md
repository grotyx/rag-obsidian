# Migrating from 0.5.x to 0.6.0

Version 0.6.0 changes the Obsidian plugin id from `rag-obsidian` to
`academic-paper-citation-manager` for Community directory compatibility. The GitHub repository
and the default MCP connection name remain `rag-obsidian`.

## Existing BRAT or manual installation

1. Back up the vault, disable the plugin, and quit Obsidian completely.
2. Rename the plugin directory:

   ```text
   <vault>/.obsidian/plugins/rag-obsidian
   → <vault>/.obsidian/plugins/academic-paper-citation-manager
   ```

   Renaming preserves `data.json`, `chat.json`, and the local search/citation indexes.
3. Reopen Obsidian. If BRAT no longer tracks the plugin, remove its old BRAT entry and add
   `grotyx/rag-obsidian` again. Enable **Academic Paper Citation Manager**.
4. Open the plugin settings and verify the library folder and providers. On Obsidian versions
   with SecretStorage, 0.6.0 copies API keys from the old key ids to the new ids without deleting
   the old copies. Re-enter a key only if the provider check says it is missing.
5. MCP bridge paths include the plugin directory. Enable MCP access, copy the newly generated
   Claude Code command or Codex block, replace the old client entry, and restart the client.

The experimental Transformers.js embedding option was removed to avoid executing CDN-delivered
code. A saved Transformers.js selection moves to the default OpenAI-compatible embedding provider;
verify its key/model and rebuild the search index, or select Ollama for local embeddings.

Do not leave both plugin directories enabled. If rollback is necessary, quit Obsidian and rename
the directory back; the legacy SecretStorage copies are deliberately retained.

## Fresh installation

No migration is needed. Install into
`<vault>/.obsidian/plugins/academic-paper-citation-manager/` or use the Community directory after
the listing is approved.

Version 0.6.0 is desktop-only because its optional live MCP integration includes Node APIs.
