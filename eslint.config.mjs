import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
// The rule's own default lists live in the plugin's dist folder (no public export). Load them
// defensively: if a future release moves them, lint keeps running with our additions only.
const { DEFAULT_BRANDS = [] } = await import("eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js").catch(() => ({}));
const { DEFAULT_ACRONYMS = [] } = await import("eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js").catch(() => ({}));

// Domain-specific proper names the recommended sentence-case allowlist doesn't know about
// (academic-metadata sources, citation/export formats, and the CLI providers this plugin talks
// to). Extends, rather than replaces, the rule's own defaults.
const EXTRA_BRANDS = [
  "PubMed",
  "OpenAlex",
  "Crossref",
  "Unpaywall",
  "BibTeX",
  "arXiv",
  "OpenRouter",
  "Claude Code",
  "Codex",
  "OpenCode",
  "Antigravity",
  "Ollama",
  "Pandoc",
  "Word",
  "MeSH",
  "E-utilities",
  "ChatGPT",
  // Language names are proper nouns in English.
  "English",
  "Korean",
];
const EXTRA_ACRONYMS = ["DOI", "PMID", "PMC", "RIS", "CSL", "MCP", "PRISMA", "OA", "NCBI", "MEDLINE"];
// "Cursor" (the code editor) collides with the common noun "cursor" (text-caret position), which
// this plugin uses in its own UI text and never uses as a brand reference — drop it so those
// strings aren't forced to capitalize a plain word.
const BRANDS = DEFAULT_BRANDS.filter((b) => b !== "Cursor");

export default defineConfig([
  {
    ignores: [
      "main.js",
      "_test.cjs",
      "_testvault*/**",
      "node_modules/**",
      "test/**",
      "scripts/**",
      "presentation/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    // Extend (not replace) the recommended sentence-case allowlist with names the default
    // brands/acronyms lists don't cover: citation/metadata sources and export formats, and the
    // desktop CLI providers.
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          enforceCamelCaseLower: true,
          brands: [...BRANDS, ...EXTRA_BRANDS],
          acronyms: [...DEFAULT_ACRONYMS, ...EXTRA_ACRONYMS],
          // Text that names another UI label must match that label's casing: a quoted command or
          // setting name ('Find open-access PDF', "Contact e-mail"), a section the user sees
          // (## References, the Retrieval heading), and file extensions like (.ris).
          ignoreWords: ["References", "Retrieval", "Settings"],
          ignoreRegex: ["([\"'])[A-Z][^\"']*\\1", "“[A-Z][^”]*”", "\\(\\.[a-z]+\\)", "^[a-z0-9-]+$"],
        },
      ],
    },
  },
  {
    // MCP, the codex/opencode CLI providers and the Pandoc .docx export are desktop-only and
    // dynamically loaded behind Platform.isDesktopApp.
    files: ["src/mcp/bridge.ts", "src/mcp/http.ts", "src/llm/cli.ts", "src/write/docx.ts"],
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs"],
        },
      },
    },
  },
]);
