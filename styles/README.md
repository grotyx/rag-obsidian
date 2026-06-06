# Bundled CSL styles & locale

These `.csl` style files and `locales-en-US.xml` are vendored from the
[Citation Style Language](https://citationstyles.org/) project so the plugin's
bibliography generator (citeproc-js) works offline for the priority journals.

| File | Style | Source |
|---|---|---|
| `spine.csl` | Spine | citation-style-language/styles |
| `elsevier-vancouver.csl` | The Spine Journal (Elsevier–Vancouver) | citation-style-language/styles |
| `springer-basic-brackets.csl` | European Spine Journal (Springer) | citation-style-language/styles |
| `american-medical-association.csl` | AMA 11th (≈ Global Spine Journal) | citation-style-language/styles |
| `apa.csl` | APA 7th edition | citation-style-language/styles |
| `locales-en-US.xml` | en-US locale | citation-style-language/locales |

Any other style id is fetched on demand from
`raw.githubusercontent.com/citation-style-language/styles` and cached under
`styles/cache/`.

**License:** the CSL styles and locales are distributed by their project under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); they retain that
license here. The plugin's own source code is MIT (see the repository root).
