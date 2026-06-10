import { App, PluginSettingTab, Setting } from "obsidian";
import type ScholarRagPlugin from "../main";
import { EmbeddingProviderId, LLMProviderId, CiteStyle } from "./types";
import { BUNDLED_STYLES } from "./cite/csl";

export class ScholarRagSettingTab extends PluginSettingTab {
  private plugin: ScholarRagPlugin;

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Library" });

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
          .addOption("authoryeartitle", "smith2020deep")
          .addOption("authoryear", "smith2020")
          .setValue(this.plugin.settings.citekeyStyle)
          .onChange(async (v) => {
            this.plugin.settings.citekeyStyle = v as "authoryeartitle" | "authoryear";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PubMed API key (optional)")
      .setDesc("NCBI E-utilities API key for higher rate limits.")
      .addText((t) => {
        t.setValue(this.plugin.settings.pubmedApiKey).onChange(async (v) => {
          this.plugin.settings.pubmedApiKey = v.trim();
          await this.plugin.saveSettings();
        });
        t.inputEl.type = "password";
      });

    containerEl.createEl("h2", { text: "Retrieval (semantic search)" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Changing the provider or model invalidates the index — rebuild it from the search pane afterward.",
    });

    new Setting(containerEl)
      .setName("Embedding provider")
      .setDesc("Ollama = recommended local (run `ollama pull nomic-embed-text`). OpenAI = cloud / OpenAI-compatible. Transformers = experimental in-app.")
      .addDropdown((d) =>
        d
          .addOption("ollama", "Ollama (local)")
          .addOption("openai", "OpenAI / compatible")
          .addOption("transformers", "Transformers.js (experimental)")
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
            ? "e.g. text-embedding-3-small (1536-d), text-embedding-3-large (3072-d)"
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
      .setName("Results (top-K)")
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

    containerEl.createEl("h2", { text: "Chat (citation-grounded answers)" });

    new Setting(containerEl)
      .setName("LLM provider")
      .addDropdown((d) =>
        d
          .addOption("anthropic", "Anthropic (Claude)")
          .addOption("openai", "OpenAI / compatible")
          .addOption("ollama", "Ollama (local)")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (v) => {
            this.plugin.settings.llmProvider = v as LLMProviderId;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    const llm = this.plugin.settings.llmProvider;

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc(
        llm === "anthropic"
          ? "e.g. claude-haiku-4-5-20251001, claude-sonnet-4-6"
          : llm === "openai"
            ? "e.g. gpt-4o-mini, gpt-4o"
            : "any local Ollama chat model, e.g. gemma3:4b, qwen2.5:32b"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v.trim();
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

    new Setting(containerEl)
      .setName("Max answer tokens")
      .addSlider((s) =>
        s
          .setLimits(256, 4096, 128)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.llmMaxTokens)
          .onChange(async (v) => {
            this.plugin.settings.llmMaxTokens = v;
            await this.plugin.saveSettings();
          })
      );

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
      .setName("Custom CSL style id (optional)")
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

    containerEl.createEl("h2", { text: "Citation graph" });

    new Setting(containerEl)
      .setName("OpenAlex contact email")
      .setDesc("Optional. Joins OpenAlex's faster 'polite pool'. Recommended for large libraries.")
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(this.plugin.settings.openalexMailto)
          .onChange(async (v) => {
            this.plugin.settings.openalexMailto = v.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h2", { text: "Writing" });

    new Setting(containerEl)
      .setName("Render [@citekey] in reading view")
      .setDesc("Show Pandoc citations as (Author, Year) in preview.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.renderCitations).onChange(async (v) => {
          this.plugin.settings.renderCitations = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h2", { text: "Ontology (optional)" });

    new Setting(containerEl)
      .setName("Enable ontology")
      .setDesc("Tag notes with concepts from an ontology pack (built-in sample, or your own JSON).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ontologyEnabled).onChange(async (v) => {
          this.plugin.settings.ontologyEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ontology pack path")
      .setDesc("Vault path to a JSON pack { scheme, concepts:[{id,label,synonyms?,parents?}] }. Empty = built-in sample.")
      .addText((t) =>
        t
          .setPlaceholder("Ontologies/mesh-subset.json")
          .setValue(this.plugin.settings.ontologyPackPath)
          .onChange(async (v) => {
            this.plugin.settings.ontologyPackPath = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
