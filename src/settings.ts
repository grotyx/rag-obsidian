import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type ScholarRagPlugin from "../main";
import { DEFAULT_SETTINGS, EmbeddingProviderId, LLMProviderId, CiteStyle } from "./types";
import { BUNDLED_STYLES } from "./cite/csl";
import { LLMClient } from "./llm/client";

export class ScholarRagSettingTab extends PluginSettingTab {
  private plugin: ScholarRagPlugin;

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Library").setHeading();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: this.plugin.hasSecretStorage()
        ? "API keys below are stored in the OS keychain, not in data.json."
        : "This app has no OS keychain access, so API keys below are stored in plain text in data.json (synced with your vault if sync is on).",
    });

    new Setting(containerEl)
      .setName("References folder")
      .setDesc("Folder where reference notes are stored.")
      .addText((t) =>
        t.setValue(this.plugin.settings.referencesFolder).onChange(async (v) => {
          this.plugin.settings.referencesFolder = v.trim() || "References";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Citekey style")
      .setDesc("How citekeys / filenames are generated.")
      .addDropdown((d) =>
        d
          .addOption("authoryeartitle", "Smith2020deep")
          .addOption("authoryear", "Smith2020")
          .setValue(this.plugin.settings.citekeyStyle)
          .onChange(async (v) => {
            this.plugin.settings.citekeyStyle = v as "authoryeartitle" | "authoryear";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PubMed API key (optional)")
      .setDesc("NCBI E-utilities key — raises the rate limit from 3 to 10 requests/second.")
      .addText((t) => {
        t.setValue(this.plugin.settings.pubmedApiKey).onChange(async (v) => {
          this.plugin.settings.pubmedApiKey = v.trim();
          await this.plugin.saveSettings();
        });
        t.inputEl.type = "password";
      });

    new Setting(containerEl).setName("Retrieval (semantic search)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Changing the provider or model invalidates the index — rebuild it from the search pane afterward.",
    });

    new Setting(containerEl)
      .setName("Embedding provider")
      .setDesc(
        "OpenAI / compatible = recommended — point the base URL at OpenRouter and one key covers " +
          "embeddings, chat and summaries. Ollama = local, no key (run `ollama pull nomic-embed-text`)."
      )
      .addDropdown((d) =>
        d
          .addOption("ollama", "Ollama (local)")
          .addOption("openai", "OpenAI / compatible")
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (v) => {
            this.plugin.settings.embeddingProvider = v as EmbeddingProviderId;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    const provider = this.plugin.settings.embeddingProvider;

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc(
        provider === "ollama"
          ? "e.g. nomic-embed-text (768-d), bge-m3 (1024-d, multilingual)"
          : provider === "openai"
            ? "On OpenRouter: openai/text-embedding-3-small (1536-d). Straight to OpenAI: the same id without the prefix."
            : "e.g. Xenova/multilingual-e5-small, Xenova/bge-small-en-v1.5"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.embeddingModel).onChange(async (v) => {
          this.plugin.settings.embeddingModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    if (provider === "ollama") {
      new Setting(containerEl)
        .setName("Ollama URL")
        .addText((t) =>
          t.setValue(this.plugin.settings.ollamaUrl).onChange(async (v) => {
            this.plugin.settings.ollamaUrl = v.trim() || "http://localhost:11434";
            await this.plugin.saveSettings();
          })
        );
    }

    if (provider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI base URL")
        .addText((t) =>
          t.setValue(this.plugin.settings.openaiBaseUrl).onChange(async (v) => {
            this.plugin.settings.openaiBaseUrl = v.trim() || "https://api.openai.com/v1";
            await this.plugin.saveSettings();
          })
        );
      new Setting(containerEl)
        .setName("OpenAI API key")
        .addText((t) => {
          t.setValue(this.plugin.settings.openaiApiKey).onChange(async (v) => {
            this.plugin.settings.openaiApiKey = v.trim();
            await this.plugin.saveSettings();
          });
          t.inputEl.type = "password";
        });
    }

    new Setting(containerEl)
      .setName("Rerank chat results with the LLM")
      .setDesc(
        "Retrieves twice as many passages and has the model order them by relevance before the " +
          "answer is written. One extra request per question; affects chat only."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.llmRerank).onChange(async (v) => {
          this.plugin.settings.llmRerank = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Results (top-k)")
      .setDesc("How many chunks a search returns.")
      .addSlider((s) =>
        s
          .setLimits(3, 30, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.topK)
          .onChange(async (v) => {
            this.plugin.settings.topK = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chunk size (characters)")
      .setDesc("Target size of each embedded text chunk.")
      .addSlider((s) =>
        s
          .setLimits(400, 3000, 100)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.chunkChars)
          .onChange(async (v) => {
            this.plugin.settings.chunkChars = v;
            await this.plugin.saveSettings();
          })
      );

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName("Keep the search index outside the vault")
        .setDesc(
          "Stores the index in this computer's cache folder instead of the plugin folder, so OneDrive / " +
            "iCloud / Obsidian Sync don't re-upload it after every change. Each device then builds its own index."
        )
        .addToggle((t) =>
          t.setValue(this.plugin.settings.indexLocal).onChange(async (v) => {
            this.plugin.settings.indexLocal = v;
            await this.plugin.saveSettings();
            await this.plugin.indexManager.relocate();
            new Notice(v ? "Search index moved to the local cache folder." : "Search index moved back into the vault.");
          })
        );
    }

    new Setting(containerEl).setName("Chat (citation-grounded answers)").setHeading();

    new Setting(containerEl)
      .setName("LLM provider")
      .addDropdown((d) => {
        d.addOption("anthropic", "Anthropic (Claude)")
          .addOption("openai", "OpenAI / compatible")
          .addOption("ollama", "Ollama (local)");
        if (Platform.isDesktopApp) {
          d.addOption("codex", "Codex CLI (ChatGPT login)");
          d.addOption("opencode", "OpenCode CLI (logged-in)");
        }
        d.setValue(this.plugin.settings.llmProvider).onChange(async (v) => {
          const prev = this.plugin.settings.llmProvider;
          const next = v as LLMProviderId;
          this.plugin.settings.llmProvider = next;
          if (next === "codex" || next === "opencode") {
            // A leftover OpenRouter-style id (e.g. "deepseek/...") would make the CLI fail —
            // empty means "use the CLI's own default".
            this.plugin.settings.llmModel = "";
            this.plugin.settings.chatModel = "";
          } else if ((prev === "codex" || prev === "opencode") && !this.plugin.settings.llmModel) {
            // Leaving a CLI provider: an empty model would 400 on every API call.
            const fallback: Record<string, string> = {
              openai: DEFAULT_SETTINGS.llmModel,
              anthropic: "claude-haiku-4-5-20251001",
              ollama: "gemma3:4b",
            };
            this.plugin.settings.llmModel = fallback[next] ?? "";
            this.plugin.settings.chatModel = next === "openai" ? DEFAULT_SETTINGS.chatModel : "";
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const llm = this.plugin.settings.llmProvider;

    new Setting(containerEl)
      .setName("Default model")
      .setDesc(
        (llm === "anthropic"
          ? "e.g. claude-haiku-4-5-20251001, claude-sonnet-4-6"
          : llm === "openai"
            ? "On OpenRouter: deepseek/deepseek-v4-flash-0731, openai/gpt-5.1. Straight to OpenAI: gpt-4o-mini."
            : llm === "codex"
              ? "Empty = your Codex default. e.g. gpt-5.1-codex"
              : llm === "opencode"
                ? "Empty = your OpenCode default. Format provider/model, e.g. opencode-go/muse-spark-1.3-contributor"
                : "any local Ollama chat model, e.g. gemma3:4b, qwen2.5:32b") +
          " — used for paper summaries and PDF metadata extraction."
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Chat model (optional)")
      .setDesc('Model for "Chat with library" answers. Leave empty to use the default model.')
      .addText((t) =>
        t
          .setPlaceholder("Same as default")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (v) => {
            this.plugin.settings.chatModel = v.trim();
            await this.plugin.saveSettings();
          })
      );

    if (llm === "anthropic") {
      new Setting(containerEl)
        .setName("Anthropic API key")
        .addText((t) => {
          t.setValue(this.plugin.settings.anthropicApiKey).onChange(async (v) => {
            this.plugin.settings.anthropicApiKey = v.trim();
            await this.plugin.saveSettings();
          });
          t.inputEl.type = "password";
        });
    }
    if (llm === "openai") {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "Uses the OpenAI base URL + API key set under Retrieval above.",
      });
    }

    if (llm === "codex" || llm === "opencode") {
      new Setting(containerEl)
        .setName("CLI executable")
        .setDesc(
          "Leave empty to look in the usual install folders. Uses your existing CLI login — " +
            "no API key is stored by this plugin. Calls run in the background, a few at a time."
        )
        .addText((t) =>
          t
            .setPlaceholder("Auto-detect")
            .setValue(this.plugin.settings.cliPath)
            .onChange(async (v) => {
              this.plugin.settings.cliPath = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Sends a one-line prompt through the CLI and reports the reply or error.")
        .addButton((b) =>
          b.setButtonText("Test").onClick(async () => {
            b.setDisabled(true).setButtonText("Testing…");
            const started = Date.now();
            const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);
            try {
              const reply = await new LLMClient(this.plugin.settings).chat(
                [{ role: "user", content: "Reply with exactly: OK" }],
                "You are a test."
              );
              new Notice(`${llm} replied in ${elapsed()}s: ${reply.slice(0, 200)}`);
            } catch (e) {
              new Notice(`${llm} test failed after ${elapsed()}s: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              b.setDisabled(false).setButtonText("Test");
            }
          })
        );
    }

    if (llm !== "codex" && llm !== "opencode") {
      new Setting(containerEl)
        .setName("Max answer tokens")
        .setDesc(
          "Anthropic only (OpenAI-compatible and Ollama endpoints use their own default). " +
            "Reasoning models spend this budget on thinking before the answer, so keep it high — " +
            "too low returns an empty reply."
        )
        .addSlider((s) =>
          s
            .setLimits(1024, 32768, 1024)
            .setDynamicTooltip()
            .setValue(this.plugin.settings.llmMaxTokens)
            .onChange(async (v) => {
              this.plugin.settings.llmMaxTokens = v;
              await this.plugin.saveSettings();
            })
        );
    }

    const FIXED_SUMMARY_LANGS = ["en", "ko", "en+ko"];
    new Setting(containerEl)
      .setName("Summary language")
      .setDesc("Language for AI-generated paper summaries.")
      .addDropdown((d) => {
        d.addOption("en", "English");
        d.addOption("ko", "Korean");
        d.addOption("en+ko", "English + Korean");
        d.addOption("custom", "Custom…");
        const cur = this.plugin.settings.summaryLanguage;
        d.setValue(FIXED_SUMMARY_LANGS.includes(cur) ? cur : "custom");
        d.onChange(async (v) => {
          if (v !== "custom") this.plugin.settings.summaryLanguage = v;
          else if (FIXED_SUMMARY_LANGS.includes(this.plugin.settings.summaryLanguage)) {
            this.plugin.settings.summaryLanguage = "";
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (!FIXED_SUMMARY_LANGS.includes(this.plugin.settings.summaryLanguage)) {
      new Setting(containerEl)
        .setName("Custom summary language")
        .setDesc("Free-text language name, e.g. German.")
        .addText((t) =>
          t
            .setPlaceholder("German")
            .setValue(this.plugin.settings.summaryLanguage)
            .onChange(async (v) => {
              this.plugin.settings.summaryLanguage = v.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Citation style")
      .setDesc("How sources are formatted under each answer.")
      .addDropdown((d) =>
        d
          .addOption("apa", "APA")
          .addOption("vancouver", "Vancouver")
          .addOption("plain", "Plain")
          .setValue(this.plugin.settings.citeStyle)
          .onChange(async (v) => {
            this.plugin.settings.citeStyle = v as CiteStyle;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bibliography style (CSL)")
      .setDesc(
        'Journal-accurate "## References" via citeproc-js. Bundled: spine journals + APA. ' +
          "Empty = use the lightweight formatter above. The custom box below overrides this."
      )
      .addDropdown((d) => {
        d.addOption("", "Lightweight (use Citation style above)");
        for (const [id, label] of Object.entries(BUNDLED_STYLES)) d.addOption(id, label);
        const cur = this.plugin.settings.cslStyleId;
        d.setValue(cur in BUNDLED_STYLES || cur === "" ? cur : "");
        d.onChange(async (v) => {
          this.plugin.settings.cslStyleId = v;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Custom CSL style ID (optional)")
      .setDesc(
        "Any style from github.com/citation-style-language/styles — e.g. nature, the-lancet, " +
          "jbjs. Fetched + cached on first use. Overrides the dropdown when set."
      )
      .addText((t) =>
        t
          .setPlaceholder("nature")
          .setValue(this.plugin.settings.cslStyleId in BUNDLED_STYLES ? "" : this.plugin.settings.cslStyleId)
          .onChange(async (v) => {
            this.plugin.settings.cslStyleId = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Citation graph").setHeading();

    new Setting(containerEl)
      .setName("Contact e-mail")
      .setDesc(
        "Sent to OpenAlex, Unpaywall and PubMed as your contact address. " +
          "Required for open-access PDF lookup (Unpaywall rejects requests without one), " +
          "and it joins OpenAlex's faster 'polite pool'."
      )
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(this.plugin.settings.openalexMailto)
          .onChange(async (v) => {
            this.plugin.settings.openalexMailto = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Writing").setHeading();

    new Setting(containerEl)
      .setName("Render [@citekey] in reading view")
      .setDesc("Show Pandoc citations as (Author, Year) in preview.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.renderCitations).onChange(async (v) => {
          this.plugin.settings.renderCitations = v;
          await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Pandoc path")
      .setDesc(
        'Leave empty to auto-detect (Homebrew, ~/.local/bin, Program Files). Needed for ' +
          '"Export manuscript to Word (.docx)" — install Pandoc from pandoc.org if that command reports it missing.'
      )
      .addText((t) =>
        t
          .setPlaceholder("Auto-detect")
          .setValue(this.plugin.settings.pandocPath)
          .onChange(async (v) => {
            this.plugin.settings.pandocPath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("External AI (MCP)").setHeading();
    if (!Platform.isDesktopApp) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "This plugin requires Obsidian Desktop.",
      });
      return;
    }

    const status = this.plugin.mcpStatus();
    new Setting(containerEl)
      .setName("Enable MCP access")
      .setDesc(
        status.running
          ? `Listening locally for Claude Code or Codex on port ${status.port}.`
          : "Let Claude Code or Codex search this library and manage Markdown while Obsidian is open."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mcpEnabled).onChange(async (enabled) => {
          await this.plugin.setMcpEnabled(enabled);
          this.display();
        })
      );

    if (!this.plugin.settings.mcpEnabled) return;
    new Setting(containerEl)
      .setName("Allow note editing tools")
      .setDesc(
        "Off = MCP clients get only the library, PubMed and manuscript tools (12), and cannot list, " +
          "read, create, edit, move or trash other notes. Start a new client session to see the change."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mcpNoteTools).onChange(async (on) => {
          this.plugin.settings.mcpNoteTools = on;
          await this.plugin.saveSettings();
        })
      );
    const snippets = this.plugin.mcpSetupSnippets();
    if (snippets) {
      new Setting(containerEl)
        .setName("Connect an MCP client")
        .setDesc("Copy the setup for this vault. The access token is discovered locally and is never copied.")
        .addButton((button) =>
          button.setButtonText("Copy Claude Code command").onClick(async () => {
            await navigator.clipboard.writeText(snippets.claudeCode);
            new Notice("Claude Code MCP command copied");
          })
        )
        .addButton((button) =>
          button.setButtonText("Copy Codex config").onClick(async () => {
            await navigator.clipboard.writeText(snippets.codex);
            new Notice("Codex MCP config copied");
          })
        )
        .addButton((button) =>
          button.setButtonText("Copy OpenCode config").onClick(async () => {
            await navigator.clipboard.writeText(snippets.opencode);
            new Notice("OpenCode MCP config copied");
          })
        )
        .addButton((button) =>
          button.setButtonText("Copy Antigravity command").onClick(async () => {
            await navigator.clipboard.writeText(snippets.agy);
            new Notice("Antigravity MCP command copied");
          })
        );
    }
    new Setting(containerEl)
      .setName("MCP connection")
      .setDesc("Restart rotates the per-session access token. Stop leaves MCP off until the plugin reloads or you restart it here.")
      .addButton((button) =>
        button.setButtonText("Restart and rotate token").onClick(async () => {
          await this.plugin.restartMcp();
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("Stop server").setWarning().onClick(async () => {
          await this.plugin.stopMcp();
          this.display();
        })
      );
  }
}
