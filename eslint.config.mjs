import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

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
    // Documented exceptions (CLAUDE.md): feature-detected secretStorage falls back to data.json
    // below 1.11.4 and on mobile; the CDN loaders must use the Function trick so esbuild does
    // not rewrite import(). Kept as warnings so they stay visible without failing the run.
    files: ["main.ts"],
    rules: { "obsidianmd/no-unsupported-api": "warn" },
  },
  {
    files: ["src/ingest/pdf.ts", "src/index/providers/transformers.ts"],
    rules: { "@typescript-eslint/no-implied-eval": "warn", "obsidianmd/rule-custom-message": "warn" },
  },
  {
    // MCP is desktop-only and dynamically loaded behind Platform.isDesktopApp.
    files: ["src/mcp/bridge.ts", "src/mcp/http.ts"],
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
