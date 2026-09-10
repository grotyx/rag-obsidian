# Obsidian Community directory submission

This repository is prepared for the current web-based Community directory process. The final
submission requires the maintainer's Obsidian and GitHub sign-in.

## Release contract

| Field | Value |
|---|---|
| Plugin id | `academic-paper-citation-manager` |
| Name | Academic Paper Citation Manager |
| Repository | `grotyx/rag-obsidian` |
| Version | `0.6.0` |
| Minimum Obsidian version | `1.7.2` |
| Desktop-only | `true` (the bundle contains an optional Node-based MCP server) |
| GitHub release tag | `0.6.0` — exactly the manifest version, without a `v` prefix |
| Required release assets | `main.js`, `manifest.json`, `styles.css` |

The repository name and the MCP server name may remain `rag-obsidian`; the manifest id is the
identifier constrained by Community directory rules. Existing 0.5.x users should follow
[MIGRATION-0.6.md](MIGRATION-0.6.md).

## Maintainer checklist

1. Confirm the default branch HEAD contains the intended `manifest.json`.
2. Run `npm run lint`, `npm run build`, and `npm test` on the release commit.
3. Create the exact GitHub tag and release `0.6.0`; attach the three required assets from that
   same build. Do not use `v0.6.0` for this Community release.
4. Verify the public release assets download and the tag resolves to the release commit.
5. Go to [community.obsidian.md](https://community.obsidian.md), sign in with the maintainer's
   Obsidian account, link GitHub if prompted, choose **Add plugin**, and submit
   `https://github.com/grotyx/rag-obsidian`.
6. Address automated review findings on the repository/default branch and submit the updated
   exact-version release when a version change is required.

Do not open a manual pull request against `obsidianmd/obsidian-releases`; new submissions use the
Community website.

## Disclosures reviewers should be able to verify

- README installation and usage instructions are in English, with a Korean companion.
- Network destinations, LLM data flow, API-key storage, bundled dependencies, lack of telemetry/backend,
  MCP loopback access, and the operating-system temporary discovery file are disclosed in the
  README.
- MCP never calls the plugin's chat, summary, or reranking LLM. Mutating tools require current
  content hashes, and deletion uses Obsidian's recoverable trash.
- The plugin uses Node APIs only for desktop MCP and therefore declares `isDesktopOnly: true`.
- PDF.js is pinned and bundled with dynamic evaluation disabled at build time; the production
  build fails if runtime code evaluation or executable CDN imports reappear. The former
  experimental CDN-loaded Transformers.js provider is removed.
- The MIT license and third-party CSL style/license notices are present.

Official references:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
