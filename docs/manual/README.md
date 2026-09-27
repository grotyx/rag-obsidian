# User guide

| Language | Guide |
|---|---|
| English | [en.md](en.md) |
| 한국어 | [ko.md](ko.md) |

## Adding a language

1. Take the screenshots in that Obsidian UI language (see the header of
   [`scripts/manual/capture.py`](../../scripts/manual/capture.py) for setup):
   `python scripts/manual/capture.py ja` writes `img/ja/*.png`. Add the chat question in that
   language to `QUESTION` in the script first.
2. Copy `en.md` to `<lang>.md`, translate it, and point the images at `img/<lang>/`. Keep the
   numbered steps in the same order: they match the red numbers in the screenshots.
3. Add a row to the table above and a link to the language line at the top of every guide.

## Updating the screenshots

After a UI change, rerun `capture.py` for each language. It prints a warning when a numbered
callout cannot find its element; update the selector there and the matching step in each guide.
