import {
  App,
  Notice,
  Platform,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  SettingGroup,
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type ScholarRagPlugin from "../main";
import { DEFAULT_SETTINGS, EmbeddingProviderId, LLMProviderId, CiteStyle } from "./types";
import { BUNDLED_STYLES } from "./cite/csl";
import { LLMClient } from "./llm/client";

const FIXED_SUMMARY_LANGS = ["en", "ko", "en+ko"];

/**
 * Internal, version-agnostic mirror of Obsidian 1.13's declarative setting shape. `getSettingDefinitions()`
 * hands this straight to the framework (a structural match, cast at that one boundary — see its
 * comment); `display()`'s fallback renderer for Obsidian < 1.13 walks it directly. Kept as our own
 * types (not the real `obsidian.d.ts` ones) so reading these fields in the < 1.13 fallback path
 * doesn't trip `obsidianmd/no-unsupported-api` — that rule flags any read of a real 1.13-only
 * property, and it can't know the fallback only runs on Obsidian versions where these are plain
 * local data, not real API calls.
 */
type Control =
  | { type: "toggle"; key: string }
  | { type: "dropdown"; key: string; options: Record<string, string> }
  | { type: "text"; key: string; placeholder?: string }
  | { type: "slider"; key: string; min: number; max: number; step: number };

interface RowBase {
  name: string;
  desc?: string;
  aliases?: string[];
  /** Whether the row is rendered (and searchable) — re-evaluated on every render/search, unlike
   *  array membership decided once when `buildDefinitions()` runs. A closure that reads off
   *  `plugin.settings` stays current even when the array it lives in was captured earlier (see
   *  the "declare every row once" note on `buildDefinitions()`). Default: always visible. */
  visible?: () => boolean;
}

/** A row has a control XOR a custom renderer, never both — mirrors the real
 *  `SettingDefinitionControl`/`SettingDefinitionRender`'s mutually-exclusive `control`/`render`. */
type Row =
  | (RowBase & { control: Control; render?: never })
  | (RowBase & { control?: never; render: (setting: Setting, group: SettingGroup) => void });

interface Group {
  type: "group";
  heading?: string;
  items: Row[];
}

/** Compile-time-only assignability check (erased at runtime — this declares nothing but a
 *  `null`, so it never reads a real 1.13-only property and is safe to evaluate on every
 *  Obsidian version): if `Group`/`Row`/`Control` drift from the real 1.13 `SettingDefinition`
 *  contract (including the real API's `control`/`render` mutual exclusion), `tsc` fails here
 *  instead of only surfacing at the Community review or in the running app. */
const _assertDefinitionsShape: SettingDefinitionItem[] = null as unknown as Group[];
void _assertDefinitionsShape;

function text(key: string, name: string, desc?: string, placeholder?: string, aliases?: string[], visible?: () => boolean): Row {
  return { name, desc, aliases, visible, control: { type: "text", key, placeholder } };
}
function toggle(key: string, name: string, desc?: string, visible?: () => boolean): Row {
  return { name, desc, visible, control: { type: "toggle", key } };
}
function dropdown(key: string, name: string, options: Record<string, string>, desc?: string, aliases?: string[], visible?: () => boolean): Row {
  return { name, desc, aliases, visible, control: { type: "dropdown", key, options } };
}
function slider(key: string, name: string, min: number, max: number, step: number, desc?: string, visible?: () => boolean): Row {
  return { name, desc, visible, control: { type: "slider", key, min, max, step } };
}
/** A plain info paragraph (no setting name/control) — matches the original imperative UI's bare
 *  `<p class="setting-item-description">`. Not a `SettingDefinitionEmpty` row: the framework
 *  silently drops those when `name` is empty, so this uses the `render` escape hatch instead. */
function info(desc: string, visible?: () => boolean): Row {
  return {
    name: "",
    visible,
    render: (setting) => {
      setting.settingEl.empty();
      setting.settingEl.createEl("p", { cls: "setting-item-description", text: desc });
    },
  };
}

/**
 * The whole settings UI, expressed once as declarative definitions. On Obsidian 1.13+,
 * `getSettingDefinitions()` hands this straight to the framework (also making settings
 * searchable). On older Obsidian, `display()` walks the same array with a small local
 * renderer — see the class doc comment on `display()`.
 */
export class ScholarRagSettingTab extends PluginSettingTab {
  private plugin: ScholarRagPlugin;
  /** "Custom…" chosen in the summary-language dropdown. A UI flag, not derived from the typed
   *  value, so typing "en" into the custom field doesn't hide the field mid-edit. */
  private customLanguage = false;

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.customLanguage = !FIXED_SUMMARY_LANGS.includes(plugin.settings.summaryLanguage);
  }

  /** Structurally matches `SettingDefinitionItem[]` — checked at compile time by
   *  `_assertDefinitionsShape` above, so this is a plain return, not a property read.
   *  Framework-called only on Obsidian 1.13+. Every row is declared once and gated by
   *  `visible: () => …`: Obsidian leaves a hidden row out of its search for that render, so a
   *  row becomes searchable (and visible) as soon as the setting that gates it changes. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.buildDefinitions();
  }

  /** Fallback renderer for Obsidian < 1.13, which has no declarative settings API. Bypassed by
   *  the framework on 1.13+ (never called there once getSettingDefinitions() is implemented) —
   *  renders the exact same definitions with the plain Setting API instead of a second copy of
   *  the UI. Required for minAppVersion 1.11.4, so the base class's `@deprecated` tag on this
   *  override is an accepted false flag (same rationale as `setWarning()` below — deliberately
   *  left rather than disabling the lint rule). */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const group of this.buildDefinitions()) {
      const g = new SettingGroup(containerEl);
      if (group.heading) g.setHeading(group.heading);
      for (const row of group.items) this.renderRowFallback(g, row);
    }
  }

  private renderRowFallback(group: SettingGroup, item: Row): void {
    if (item.visible && !item.visible()) return;
    group.addSetting((setting) => {
      if (item.name) setting.setName(item.name);
      if (item.desc) setting.setDesc(item.desc);
      if (item.render) {
        item.render(setting, group);
      } else if (item.control) {
        this.renderControl(setting, item.control, item.control.key);
      }
    });
  }

  private renderControl(setting: Setting, control: Control, key: string): void {
    const get = () => this.getControlValue(key);
    const set = (v: unknown) => void this.setControlValue(key, v);
    switch (control.type) {
      case "toggle":
        setting.addToggle((t) => t.setValue(get() as boolean).onChange(set));
        break;
      case "dropdown":
        setting.addDropdown((d) => {
          for (const [k, label] of Object.entries(control.options)) d.addOption(k, label);
          d.setValue(String(get())).onChange(set);
        });
        break;
      case "text":
        setting.addText((t) => {
          if (control.placeholder) t.setPlaceholder(control.placeholder);
          t.setValue((get() as string | undefined) ?? "").onChange(set);
        });
        break;
      case "slider":
        setting.addSlider((s) => s.setLimits(control.min, control.max, control.step).setDynamicTooltip().setValue(get() as number).onChange(set));
        break;
    }
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key === "summaryLanguagePreset") {
      return this.customLanguage ? "custom" : s.summaryLanguage;
    }
    if (key === "cslStyleIdPreset") {
      return s.cslStyleId in BUNDLED_STYLES || s.cslStyleId === "" ? s.cslStyleId : "";
    }
    if (key === "cslStyleIdCustom") {
      return s.cslStyleId in BUNDLED_STYLES ? "" : s.cslStyleId;
    }
    return (s as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case "referencesFolder":
        // Store what the user types, even empty mid-edit — the "References" fallback lives at
        // every consumer (Library.folder()), not here, so clearing the field to retype it
        // doesn't snap back to the default on a framework re-read (see Library.folder()).
        s.referencesFolder = String(value);
        break;
      case "citekeyStyle":
        s.citekeyStyle = value as "authoryeartitle" | "authoryear";
        break;
      case "pubmedApiKey":
        s.pubmedApiKey = String(value).trim();
        break;
      case "embeddingProvider":
        s.embeddingProvider = value as EmbeddingProviderId;
        await this.plugin.saveSettings();
        this.refreshStructure();
        return;
      case "embeddingModel":
        s.embeddingModel = String(value).trim();
        break;
      case "ollamaUrl":
        // Fallback applied at consumption (llm/client.ts, index/providers/ollama.ts), not here.
        s.ollamaUrl = String(value);
        break;
      case "openaiBaseUrl":
        // Fallback applied at consumption (llm/client.ts, index/providers/openai.ts), not here.
        s.openaiBaseUrl = String(value);
        break;
      case "openaiApiKey":
        s.openaiApiKey = String(value).trim();
        break;
      case "llmRerank":
        s.llmRerank = value as boolean;
        break;
      case "topK":
        s.topK = value as number;
        break;
      case "chunkChars":
        s.chunkChars = value as number;
        break;
      case "indexLocal": {
        s.indexLocal = value as boolean;
        await this.plugin.saveSettings();
        await this.plugin.indexManager.relocate();
        new Notice(s.indexLocal ? "Search index moved to the local cache folder." : "Search index moved back into the vault.");
        return;
      }
      case "llmProvider": {
        const prev = s.llmProvider;
        const next = value as LLMProviderId;
        s.llmProvider = next;
        if (next === "codex" || next === "opencode") {
          // A leftover OpenRouter-style id (e.g. "deepseek/...") would make the CLI fail —
          // empty means "use the CLI's own default".
          s.llmModel = "";
          s.chatModel = "";
        } else if ((prev === "codex" || prev === "opencode") && !s.llmModel) {
          // Leaving a CLI provider: an empty model would 400 on every API call.
          const fallback: Record<string, string> = {
            openai: DEFAULT_SETTINGS.llmModel,
            anthropic: "claude-haiku-4-5-20251001",
            ollama: "gemma3:4b",
          };
          s.llmModel = fallback[next] ?? "";
          s.chatModel = next === "openai" ? DEFAULT_SETTINGS.chatModel : "";
        }
        await this.plugin.saveSettings();
        this.refreshStructure();
        return;
      }
      case "llmModel":
        s.llmModel = String(value).trim();
        break;
      case "chatModel":
        s.chatModel = String(value).trim();
        break;
      case "anthropicApiKey":
        s.anthropicApiKey = String(value).trim();
        break;
      case "cliPath":
        s.cliPath = String(value).trim();
        break;
      case "llmMaxTokens":
        s.llmMaxTokens = value as number;
        break;
      case "summaryLanguagePreset": {
        const v = value as string;
        this.customLanguage = v === "custom";
        if (v !== "custom") s.summaryLanguage = v;
        else if (FIXED_SUMMARY_LANGS.includes(s.summaryLanguage)) s.summaryLanguage = "";
        await this.plugin.saveSettings();
        this.refreshStructure();
        return;
      }
      case "summaryLanguage":
        s.summaryLanguage = String(value).trim();
        break;
      case "citeStyle":
        s.citeStyle = value as CiteStyle;
        break;
      case "cslStyleIdPreset":
        s.cslStyleId = value as string;
        await this.plugin.saveSettings();
        this.refreshStructure();
        return;
      case "cslStyleIdCustom":
        s.cslStyleId = String(value).trim();
        break;
      case "openalexMailto":
        s.openalexMailto = String(value).trim();
        break;
      case "renderCitations":
        s.renderCitations = value as boolean;
        break;
      case "pandocPath":
        s.pandocPath = String(value).trim();
        break;
      case "mcpNoteTools":
        s.mcpNoteTools = value as boolean;
        break;
      case "mcpEnabled":
        await this.plugin.setMcpEnabled(value as boolean);
        this.refreshStructure();
        return;
      default:
        return;
    }
    await this.plugin.saveSettings();
  }

  /** Re-evaluate the definitions and redraw. 1.13+ has update() (cheap: re-fetches
   *  getSettingDefinitions() and lets the framework re-render); older Obsidian has no such
   *  method, so fall back to display() the way the old imperative render() used to. */
  private refreshStructure(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else this.display();
  }

  private buildDefinitions(): Group[] {
    const plugin = this.plugin;
    const s = plugin.settings;
    const groups: Group[] = [];

    groups.push({
      type: "group",
      heading: "Library",
      items: [
        info(
          plugin.hasSecretStorage()
            ? "API keys below are stored in the OS keychain, not in data.json."
            : "This app has no OS keychain access, so API keys below are stored in plain text in data.json (synced with your vault if sync is on)."
        ),
        text("referencesFolder", "References folder", "Folder where reference notes are stored.", DEFAULT_SETTINGS.referencesFolder, ["Zotero"]),
        dropdown("citekeyStyle", "Citekey style", { authoryeartitle: "Smith2020deep", authoryear: "Smith2020" }, "How citekeys / filenames are generated."),
        {
          name: "PubMed API key (optional)",
          desc: "NCBI E-utilities key — raises the rate limit from 3 to 10 requests/second.",
          aliases: ["API key"],
          render: (setting) => {
            setting.addText((t) => {
              t.setValue(s.pubmedApiKey).onChange((v) => void this.setControlValue("pubmedApiKey", v));
              t.inputEl.type = "password";
            });
          },
        },
      ],
    });

    // "provider" below is a build-time snapshot, fine for the description text (which the real
    // 1.13 API has no way to re-evaluate live anyway). Row *presence* must not be decided from
    // it — every provider-dependent row is declared once and gated with `visible: () => …`,
    // which reads the live settings each time Obsidian renders or searches.
    const provider = s.embeddingProvider;
    const retrievalItems: Row[] = [
      info("Changing the provider or model invalidates the index — rebuild it from the search pane afterward."),
      dropdown(
        "embeddingProvider",
        "Embedding provider",
        { ollama: "Ollama (local)", openai: "OpenAI / compatible" },
        "OpenAI / compatible = recommended — point the base URL at OpenRouter and one key covers " +
          "embeddings, chat and summaries. Ollama = local, no key (run `ollama pull nomic-embed-text`).",
        ["OpenRouter"]
      ),
      text(
        "embeddingModel",
        "Embedding model",
        provider === "ollama"
          ? "e.g. nomic-embed-text (768-d), bge-m3 (1024-d, multilingual)"
          : provider === "openai"
            ? "On OpenRouter: openai/text-embedding-3-small (1536-d). Straight to OpenAI: the same id without the prefix."
            : "e.g. Xenova/multilingual-e5-small, Xenova/bge-small-en-v1.5"
      ),
      // The chat LLM reads these too, so show them when either provider uses them.
      text("ollamaUrl", "Ollama URL", undefined, DEFAULT_SETTINGS.ollamaUrl, undefined, () => s.embeddingProvider === "ollama" || s.llmProvider === "ollama"),
      text("openaiBaseUrl", "OpenAI base URL", undefined, DEFAULT_SETTINGS.openaiBaseUrl, undefined, () => s.embeddingProvider === "openai" || s.llmProvider === "openai"),
      {
        name: "OpenAI API key",
        aliases: ["API key"],
        visible: () => s.embeddingProvider === "openai" || s.llmProvider === "openai",
        render: (setting) => {
          setting.addText((t) => {
            t.setValue(s.openaiApiKey).onChange((v) => void this.setControlValue("openaiApiKey", v));
            t.inputEl.type = "password";
          });
        },
      },
      toggle(
        "llmRerank",
        "Rerank chat results with the LLM",
        "Retrieves twice as many passages and has the model order them by relevance before the " +
          "answer is written. One extra request per question; affects chat only."
      ),
      slider("topK", "Results (top-k)", 3, 30, 1, "How many chunks a search returns."),
      slider("chunkChars", "Chunk size (characters)", 400, 3000, 100, "Target size of each embedded text chunk."),
    ];
    if (Platform.isDesktopApp) {
      // Platform.isDesktopApp can't change while the app is running, so — unlike the settings
      // above — there's no live state for a `visible` callback to track; plain push is fine.
      retrievalItems.push(
        toggle(
          "indexLocal",
          "Keep the search index outside the vault",
          "Stores the index in this computer's cache folder instead of the plugin folder, so OneDrive / " +
            "iCloud / Obsidian Sync don't re-upload it after every change. Each device then builds its own index."
        )
      );
    }
    groups.push({ type: "group", heading: "Retrieval (semantic search)", items: retrievalItems });

    const llm = s.llmProvider;
    const llmOptions: Record<string, string> = {
      anthropic: "Anthropic (Claude)",
      openai: "OpenAI / compatible",
      ollama: "Ollama (local)",
    };
    if (Platform.isDesktopApp) {
      llmOptions.codex = "Codex CLI (ChatGPT login)";
      llmOptions.opencode = "OpenCode CLI (logged-in)";
    }
    // Same rule as Retrieval above: `llm` (a snapshot) drives description text only; row
    // presence is `visible: () => …` reading `s.llmProvider` live.
    const chatItems: Row[] = [
      dropdown("llmProvider", "LLM provider", llmOptions),
      text(
        "llmModel",
        "Default model",
        (llm === "anthropic"
          ? "e.g. claude-haiku-4-5-20251001, claude-sonnet-4-6"
          : llm === "openai"
            ? "On OpenRouter: deepseek/deepseek-v4-flash-0731, openai/gpt-5.1. Straight to OpenAI: gpt-4o-mini."
            : llm === "codex"
              ? "Empty = your Codex default. e.g. gpt-5.1-codex"
              : llm === "opencode"
                ? "Empty = your OpenCode default. Format provider/model, e.g. opencode-go/muse-spark-1.3-contributor"
                : "any local Ollama chat model, e.g. gemma3:4b, qwen2.5:32b") +
          " — used for paper summaries and PDF metadata extraction.",
        undefined,
        ["OpenRouter"]
      ),
      text("chatModel", "Chat model (optional)", 'Model for "Chat with library" answers. Leave empty to use the default model.', "Same as default"),
      {
        name: "Anthropic API key",
        aliases: ["API key"],
        visible: () => s.llmProvider === "anthropic",
        render: (setting) => {
          setting.addText((t) => {
            t.setValue(s.anthropicApiKey).onChange((v) => void this.setControlValue("anthropicApiKey", v));
            t.inputEl.type = "password";
          });
        },
      },
      info("Uses the OpenAI base URL + API key set under Retrieval above.", () => s.llmProvider === "openai"),
      text(
        "cliPath",
        "CLI executable",
        "Leave empty to look in the usual install folders. Uses your existing CLI login — " +
          "no API key is stored by this plugin. Calls run in the background, a few at a time.",
        "Auto-detect",
        undefined,
        () => s.llmProvider === "codex" || s.llmProvider === "opencode"
      ),
      {
        name: "Test connection",
        desc: "Sends a one-line prompt through the CLI and reports the reply or error.",
        visible: () => s.llmProvider === "codex" || s.llmProvider === "opencode",
        render: (setting) => {
          setting.addButton((b) =>
            b.setButtonText("Test").onClick(async () => {
              b.setDisabled(true).setButtonText("Testing…");
              const started = Date.now();
              const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);
              const testedProvider = s.llmProvider; // read live, not the outer snapshot
              try {
                const reply = await new LLMClient(this.plugin.settings).chat(
                  [{ role: "user", content: "Reply with exactly: OK" }],
                  "You are a test."
                );
                new Notice(`${testedProvider} replied in ${elapsed()}s: ${reply.slice(0, 200)}`);
              } catch (e) {
                new Notice(`${testedProvider} test failed after ${elapsed()}s: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                b.setDisabled(false).setButtonText("Test");
              }
            })
          );
        },
      },
      slider(
        "llmMaxTokens",
        "Max answer tokens",
        1024,
        32768,
        1024,
        "Anthropic only (OpenAI-compatible and Ollama endpoints use their own default). " +
          "Reasoning models spend this budget on thinking before the answer, so keep it high — " +
          "too low returns an empty reply.",
        () => s.llmProvider !== "codex" && s.llmProvider !== "opencode"
      ),
      dropdown(
        "summaryLanguagePreset",
        "Summary language",
        { en: "English", ko: "Korean", "en+ko": "English + Korean", custom: "Custom…" },
        "Language for AI-generated paper summaries."
      ),
      text(
        "summaryLanguage",
        "Custom summary language",
        "Free-text language name, e.g. German.",
        "German",
        undefined,
        () => this.customLanguage
      ),
    ];
    chatItems.push(
      dropdown(
        "citeStyle",
        "Citation style",
        { apa: "APA", vancouver: "Vancouver", plain: "Plain" },
        "How sources are formatted under each answer."
      ),
      dropdown(
        "cslStyleIdPreset",
        "Bibliography style (CSL)",
        { "": 'Lightweight (use "Citation style" above)', ...Object.fromEntries(Object.entries(BUNDLED_STYLES)) },
        'Journal-accurate "## References" via citeproc-js. Bundled: spine journals + APA. ' +
          "Empty = use the lightweight formatter above. The custom box below overrides this."
      ),
      text(
        "cslStyleIdCustom",
        "Custom CSL style ID (optional)",
        "Any style from github.com/citation-style-language/styles — e.g. nature, the-lancet, " +
          "jbjs. Fetched + cached on first use. Overrides the dropdown when set.",
        "nature"
      )
    );
    groups.push({ type: "group", heading: "Chat (citation-grounded answers)", items: chatItems });

    groups.push({
      type: "group",
      heading: "Citation graph",
      items: [
        text(
          "openalexMailto",
          "Contact e-mail",
          "Sent to OpenAlex, Unpaywall and PubMed as your contact address. " +
            "Required for open-access PDF lookup (Unpaywall rejects requests without one), " +
            "and it joins OpenAlex's faster 'polite pool'.",
          "you@example.com"
        ),
      ],
    });

    groups.push({
      type: "group",
      heading: "Writing",
      items: [
        toggle("renderCitations", "Render [@citekey] in reading view", "Show Pandoc citations as (author, year) in preview."),
        text(
          "pandocPath",
          "Pandoc path",
          'Leave empty to auto-detect (Homebrew, ~/.local/bin, Program Files). Needed for ' +
            '"Export manuscript to Word (.docx)" — install Pandoc from pandoc.org if that command reports it missing.',
          "Auto-detect"
        ),
      ],
    });

    const mcpItems: Row[] = [];
    if (!Platform.isDesktopApp) {
      mcpItems.push(info("This plugin requires Obsidian desktop."));
    } else {
      const status = plugin.mcpStatus();
      mcpItems.push(
        toggle(
          "mcpEnabled",
          "Enable MCP access",
          status.running
            ? `Listening locally for Claude Code or Codex on port ${status.port}.`
            : "Let Claude Code or Codex search this library and manage Markdown while Obsidian is open."
        )
      );
      // mcpEnabled-dependent rows are declared once and gated with `visible`, not pushed
      // conditionally, for the same reason as the Retrieval/Chat groups above.
      mcpItems.push(
        toggle(
          "mcpNoteTools",
          "Allow note editing tools",
          "Off = MCP clients get only the library, PubMed and manuscript tools (12), and cannot list, " +
            "read, create, edit, move or trash other notes. Start a new client session to see the change.",
          () => s.mcpEnabled
        ),
        {
          name: "Connect an MCP client",
          desc: "Copy the setup for this vault. The access token is discovered locally and is never copied.",
          visible: () => s.mcpEnabled && !!plugin.mcpSetupSnippets(),
          render: (setting) => {
            const snippets = plugin.mcpSetupSnippets();
            if (!snippets) return; // visible() already gates this; defensive only
            setting
              .addButton((b) =>
                b.setButtonText("Copy Claude Code command").onClick(async () => {
                  await navigator.clipboard.writeText(snippets.claudeCode);
                  new Notice("Claude Code MCP command copied");
                })
              )
              .addButton((b) =>
                b.setButtonText("Copy Codex config").onClick(async () => {
                  await navigator.clipboard.writeText(snippets.codex);
                  new Notice("Codex MCP config copied");
                })
              )
              .addButton((b) =>
                b.setButtonText("Copy OpenCode config").onClick(async () => {
                  await navigator.clipboard.writeText(snippets.opencode);
                  new Notice("OpenCode MCP config copied");
                })
              )
              .addButton((b) =>
                b.setButtonText("Copy Antigravity command").onClick(async () => {
                  await navigator.clipboard.writeText(snippets.agy);
                  new Notice("Antigravity MCP command copied");
                })
              );
          },
        },
        {
          name: "MCP connection",
          desc: "Restart rotates the per-session access token. Stop leaves MCP off until the plugin reloads or you restart it here.",
          visible: () => s.mcpEnabled,
          render: (setting) => {
            setting
              .addButton((b) =>
                b.setButtonText("Restart and rotate token").onClick(async () => {
                  await this.plugin.restartMcp();
                  this.refreshStructure();
                })
              )
              .addButton((b) =>
                // setDestructive() (the non-deprecated replacement) requires Obsidian 1.13.0; this plugin's
                // minAppVersion is 1.11.4, so this stays on the older, still-supported setWarning() —
                // deliberately left as the one remaining `no-deprecated` warning (disabling this specific
                // rule is repo-blocked; see eslint-comments/no-restricted-disable). Guarding the call with
                // requireApiVersion doesn't help: @typescript-eslint/no-deprecated flags any reference to
                // the deprecated symbol regardless of the surrounding control flow.
                b.setButtonText("Stop server").setWarning().onClick(async () => {
                  await this.plugin.stopMcp();
                  this.refreshStructure();
                })
              );
          },
        }
      );
    }
    groups.push({ type: "group", heading: "External AI (MCP)", items: mcpItems });

    return groups;
  }
}
