# Mobile support

Academic Paper Citation Manager is declared `isDesktopOnly: true` as of 0.6.0 and cannot be
installed from the Obsidian Community directory on mobile.

The plugin bundle includes the optional live MCP server, which depends on Node APIs available only
in Obsidian Desktop. Although many citation and library modules use cross-platform Obsidian APIs,
shipping the same bundle as mobile-compatible would not match the Community directory manifest
rules. Mobile support is therefore paused rather than claimed as partially supported.

The last beta release declared mobile-compatible was 0.5.2, but it did not complete real-device
QA and is not recommended as a supported mobile release.
