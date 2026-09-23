import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

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
  // Language names are proper nouns in English.
  "English",
  "Korean",
];
const EXTRA_ACRONYMS = ["DOI", "PMID", "PMC", "RIS", "CSL", "MCP", "PRISMA", "OA"];
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
    // External JSON (Crossref, PubMed, OpenAlex, LLM providers) is read untyped; typing every
    // response shape is a refactor, not a review fix. Keep these visible as warnings so
    // `npm run lint` fails only on findings the store review would actually block on.
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
    },
  },
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
        },
      ],
    },
  },
  {
    // Feature-detected secretStorage falls back to data.json below 1.11.4. Keep the API-version
    // finding visible without rejecting supported older Obsidian releases.
    files: ["main.ts"],
    rules: { "obsidianmd/no-unsupported-api": "warn" },
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
