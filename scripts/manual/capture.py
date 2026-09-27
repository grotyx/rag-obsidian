"""Re-shoot the user-guide screenshots (docs/manual/img/<lang>/*.png) by driving Obsidian.

Needs:
  - `pip install playwright` (no browser download: it attaches to Obsidian over CDP)
  - Obsidian started with a debug port:  open -a Obsidian --args --remote-debugging-port=9223
  - `_testvault/` with the Biportal endoscopy reference fixtures, the current build copied into
    its plugin folder, and an OpenRouter key saved in the plugin settings (summary, search, chat)

Usage:  python scripts/manual/capture.py en      (or ko, ja, zh, es, ...)

The Obsidian UI language is switched for this vault window only and put back afterwards.
The script resets its own fixtures (Draft.md, the PubMed paper it adds) so reruns match.
Callout numbers in each shot are the numbered steps in docs/manual/<lang>.md; keep both in step.
Costs a few cents of OpenRouter calls (one summary, one index build, one chat answer).
"""
import pathlib, sys, urllib.parse, subprocess
from playwright.sync_api import sync_playwright

LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
CDP = 'http://127.0.0.1:9223'
ROOT = pathlib.Path(__file__).resolve().parents[2]
VAULT = ROOT / '_testvault'
OUT = ROOT / 'docs' / 'manual' / 'img' / LANG
PID = 'academic-paper-citation-manager'
LIB = '.workspace-leaf-content[data-type="rag-obsidian-library"] '
SEARCH = '.workspace-leaf-content[data-type="rag-obsidian-search"] '
CHAT = '.workspace-leaf-content[data-type="rag-obsidian-chat"] '
RELATED = '.workspace-leaf-content[data-type="rag-obsidian-related"] '
ADDED = 'References/2024-OperNeurosurg-LvS-Efficacy.md'  # the paper the PubMed step adds
QUESTION = {
    'en': 'How does the complication rate of biportal endoscopic discectomy change over the learning curve?',
    'ko': 'Biportal endoscopic discectomy의 합병증 발생률은 learning curve에 따라 어떻게 달라지나?',
    'ja': 'Biportal endoscopic discectomy の合併症率はラーニングカーブに沿ってどう変わりますか?',
    'zh': '双通道内镜椎间盘切除术 (biportal endoscopic discectomy) 的并发症发生率如何随学习曲线变化?请用中文回答。',
    'es': '¿Cómo cambia la tasa de complicaciones de la discectomía endoscópica biportal a lo largo de la curva de aprendizaje?',
}
DRAFT = ('---\ncsl: spine\n---\n# Draft — Biportal endoscopy for lumbar stenosis\n\n'
         'Biportal endoscopic decompression gives pain and disability outcomes similar to microscopic decompression')

# Red box + numbered badge drawn over the page right before a screenshot.
# A selector may end in "::text=Label" to pick the element whose text starts with Label.
MARK_JS = '''(marks)=>{document.querySelectorAll('.zz-mark').forEach(e=>e.remove());
 for(const [sel,n,idx] of marks){const [q,tx]=sel.split('::text=');
  const els=[...document.querySelectorAll(q)].filter(e=>!tx||e.innerText.trim().startsWith(tx)).filter(e=>e.getClientRects().length);
  const el=els[idx||0];if(!el)continue;const r=el.getBoundingClientRect();const b=document.createElement('div');b.className='zz-mark';
  Object.assign(b.style,{position:'fixed',left:(r.left-4)+'px',top:(r.top-4)+'px',width:(r.width+8)+'px',height:(r.height+8)+'px',border:'3px solid #E5484D',borderRadius:'8px',zIndex:99999,pointerEvents:'none',boxShadow:'0 0 0 4px rgba(229,72,77,.18)'});
  const t=document.createElement('div');t.textContent=n;Object.assign(t.style,{position:'absolute',left:'-15px',top:'-15px',width:'26px',height:'26px',borderRadius:'13px',background:'#E5484D',color:'#fff',font:'700 15px/26px -apple-system,sans-serif',textAlign:'center'});
  if(r.left<16){t.style.left=(r.width+4)+'px';t.style.top=((r.height-18)/2)+'px';}
  b.appendChild(t);document.body.appendChild(b);}
 return document.querySelectorAll('.zz-mark').length;}'''


def vault_page(browser):
    for c in browser.contexts:
        for p in c.pages:
            if '_testvault' in p.title() and p.evaluate('!!document.querySelector(".workspace")'):
                return p
    return None


def shot(p, name, marks=()):
    p.evaluate("document.querySelectorAll('.notice').forEach(e=>e.remove())")  # progress/BRAT toasts cover the panes
    n = p.evaluate(MARK_JS, [[m[0], m[1], m[2] if len(m) > 2 else 0] for m in marks])
    p.wait_for_timeout(250)
    p.screenshot(path=str(OUT / f'{name}.png'))
    p.evaluate("document.querySelectorAll('.zz-mark').forEach(e=>e.remove())")
    print(f'{name}: {n}/{len(marks)} marks')
    if n != len(marks):
        print(f'  WARNING: {len(marks) - n} mark(s) not found — the UI changed, update the selector')


def cmd(p, c, wait=800):
    p.evaluate(f'app.commands.executeCommandById("{PID}:{c}")')
    p.wait_for_timeout(wait)


def open_file(p, path, mode='preview'):
    p.evaluate('''async ([path, mode]) => { const f = app.vault.getAbstractFileByPath(path);
      await app.workspace.getLeaf(false).openFile(f, {state: {mode, source: false}}); }''', [path, mode])
    p.wait_for_timeout(1200)


def notices(p):
    return p.evaluate('[...document.querySelectorAll(".notice")].map(e=>e.innerText).join(" | ")')


def wait_until(p, js, seconds):
    for _ in range(seconds):
        if p.evaluate(js):
            return True
        p.wait_for_timeout(1000)
    return False


def reload_in(p, lang):
    """Obsidian reads its UI language from localStorage at load; null = follow the OS."""
    p.evaluate('(l)=>{ if (l) localStorage.setItem("language", l); else localStorage.removeItem("language"); }', lang)
    p.evaluate('app.commands.executeCommandById("app:reload")')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['open', 'obsidian://open?path=' + urllib.parse.quote(str(VAULT))], check=True)
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(CDP)
        p = None
        for _ in range(20):
            p = vault_page(browser)
            if p:
                break
            subprocess.run(['sleep', '1'])
        if not p:
            sys.exit('Test vault window not found — is Obsidian running with --remote-debugging-port=9223?')
        previous = p.evaluate('localStorage.getItem("language")')
        reload_in(p, LANG)
        p.wait_for_timeout(6000)
        p = vault_page(browser)
        try:
            run(p, browser)
        finally:
            reload_in(p, previous)


def run(p, browser):
    p.evaluate('()=>{const w=require("@electron/remote").getCurrentWindow();w.setContentSize(1440,900);w.center();}')
    # Fixtures: the PubMed step must add a paper that is not in the library yet; the draft starts uncited.
    p.evaluate('''async (paths) => { for (const path of paths) { const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.delete(f); } }''', [ADDED, 'Draft (compiled).md', 'Draft.docx'])
    p.evaluate('''async (text) => { const f = app.vault.getAbstractFileByPath("Draft.md");
      if (f) await app.vault.modify(f, text + "\\n"); else await app.vault.create("Draft.md", text + "\\n"); }''', DRAFT)
    p.evaluate('app.workspace.detachLeavesOfType("rag-obsidian-chat"); app.workspace.detachLeavesOfType("rag-obsidian-search")')
    open_file(p, 'References/2024-JNeurosurgSpine-HaniU-Comparison.md')
    cmd(p, 'open-library', 1200)

    # 03–04 · PubMed search → add one paper (with an LLM summary)
    p.evaluate('app.workspace.leftSplit.expand(); app.workspace.rightSplit.setSize(440)')
    cmd(p, 'search-pubmed', 1000)
    p.fill('.modal input.srag-input-full', 'biportal endoscopic lumbar decompression')
    p.click('.modal button.mod-cta')
    wait_until(p, '!!document.querySelector(".modal .rag-pubmed-row")', 30)
    p.wait_for_timeout(800)
    shot(p, '03-pubmed-search', [('.modal input.srag-input-full', 1), ('.modal .mod-toggle .checkbox-container', 2),
                                 ('.modal button.mod-cta', 3), ('.modal .rag-pubmed-row', 4)])
    rows = p.locator('.modal .rag-pubmed-row')
    for i in range(rows.count()):
        cb = rows.nth(i).locator('input[type=checkbox]')
        if cb.is_checked() != ('Lv et al.' in rows.nth(i).inner_text()):
            cb.click()
    p.evaluate('document.querySelector(".modal").scrollTop = 1e6')
    p.wait_for_timeout(300)
    shot(p, '04-pubmed-add', [('.modal button.mod-cta', 1, 1)])
    p.locator('.modal button.mod-cta').nth(1).click()
    if not wait_until(p, f'!!app.vault.getAbstractFileByPath("{ADDED}") && !document.querySelector(".modal")', 180):
        sys.exit('PubMed add did not finish — check the OpenRouter key and network')
    p.wait_for_timeout(1500)

    # 02 · add by identifier
    p.evaluate('app.workspace.leftSplit.collapse(); app.workspace.rightSplit.setSize(720)')
    cmd(p, 'add-reference', 800)
    p.fill('.modal input.srag-input-full', '10.7759/cureus.46944')
    shot(p, '02-add-reference', [('.modal input.srag-input-full', 1), ('.modal button.mod-cta', 2)])
    p.keyboard.press('Escape')

    # 05 · the new reference note
    open_file(p, ADDED)
    p.evaluate('''()=>{const h=document.querySelector(".workspace-leaf.mod-active .markdown-reading-view .metadata-properties-heading");
      if (h && !h.closest(".metadata-container").classList.contains("is-collapsed")) h.click();}''')
    p.wait_for_timeout(500)
    shot(p, '05-reference-note', [('.workspace-leaf.mod-active .markdown-reading-view .metadata-container', 1),
                                  ('.workspace-leaf.mod-active .markdown-reading-view h2', 2)])

    # 06 · library filter
    cmd(p, 'open-library', 800)
    p.fill(LIB + 'input', 'stenosis')
    p.wait_for_timeout(600)
    shot(p, '06-library', [(LIB + 'input', 1), (LIB + '.srag-quick-chip', 2), (LIB + 'button::text=+ add', 3),
                           (LIB + 'button::text=📎 PDF', 4)])
    p.fill(LIB + 'input', '')

    # 01 · overview (ribbon + library pane)
    p.evaluate('app.workspace.leftSplit.expand(); app.workspace.rightSplit.setSize(560)')
    p.wait_for_timeout(600)
    ribbon = '.side-dock-ribbon-action[aria-label="%s"]'
    shot(p, '01-overview', [(ribbon % 'Open library', 1), (ribbon % 'Chat with library', 2),
                            (ribbon % 'Search PubMed', 3), (LIB[:-1], 4)])
    p.evaluate('app.workspace.leftSplit.collapse(); app.workspace.rightSplit.setSize(720)')

    # 07 · @ autocomplete, then insert two citations
    open_file(p, 'Draft.md', 'source')
    p.evaluate('()=>{const e=app.workspace.activeEditor.editor;const n=e.lineCount()-2;e.setCursor({line:n,ch:e.getLine(n).length});e.focus();}')
    p.keyboard.type(' @lv', delay=120)
    p.wait_for_timeout(1200)
    shot(p, '07-cite-suggest', [('.suggestion-container', 1)])
    p.keyboard.press('Enter')
    p.keyboard.type(', with less back pain early after surgery @song', delay=60)
    p.wait_for_timeout(1200)
    p.keyboard.press('Enter')
    p.keyboard.type('.', delay=60)
    p.wait_for_timeout(2500)  # let the editor save before the command reads the file

    # 08 · bibliography
    cmd(p, 'update-bibliography', 3000)
    open_file(p, 'Draft.md')
    shot(p, '08-bibliography', [('.workspace-leaf.mod-active .markdown-reading-view p::text=Biportal', 1),
                                ('.workspace-leaf.mod-active .markdown-reading-view h2', 2)])

    # 09 · semantic search (rebuilds the index first if needed)
    cmd(p, 'search', 1200)
    if p.evaluate(f'!!document.querySelector(\'{SEARCH}\') && document.querySelector(\'{SEARCH}\').innerText.includes("not built")'):
        cmd(p, 'rebuild-index', 1000)
    p.fill(SEARCH + '.srag-header input', 'dural tear and other complications')
    p.click(SEARCH + '.srag-header button')
    wait_until(p, f'document.querySelectorAll(\'{SEARCH}.view-content > div\').length > 3', 90)
    p.wait_for_timeout(2000)
    shot(p, '09-search', [(SEARCH + '.srag-header input', 1), (SEARCH + '.srag-filters', 2), (SEARCH + '.srag-header button', 3)])

    # 10–11 · chat
    cmd(p, 'chat', 1500)
    p.locator(CHAT + 'button', has_text='Clear').first.click()
    p.fill(CHAT + 'textarea', QUESTION.get(LANG, QUESTION['en']))
    p.locator(CHAT + 'button.mod-cta').first.click()
    if not wait_until(p, f'!!document.querySelector(\'{CHAT}.srag-save-answer\')', 180):
        sys.exit('Chat answer did not arrive')
    p.wait_for_timeout(1000)
    p.evaluate(f'document.querySelector(\'{CHAT}.srag-chat-log\').scrollTop = 0')
    shot(p, '10-chat', [(CHAT + '.srag-user', 1), (CHAT + '.srag-answer', 2), (CHAT + 'textarea', 3)])
    p.evaluate(f'document.querySelector(\'{CHAT}.srag-chat-log\').scrollTop = 1e6')
    p.wait_for_timeout(300)
    shot(p, '11-chat-sources', [(CHAT + '.srag-save-answer', 1)])

    # 12 · related papers (builds the citation graph once)
    open_file(p, ADDED)
    cmd(p, 'related', 1500)
    if not p.evaluate(f'!!document.querySelector(\'{RELATED}.srag-map-wrap svg\')'):
        cmd(p, 'build-citation-graph', 1000)
        wait_until(p, f'!!document.querySelector(\'{RELATED}.srag-map-wrap svg\')', 180)
        open_file(p, ADDED)
        cmd(p, 'related', 1500)
    shot(p, '12-related', [(RELATED + '.srag-map-wrap', 1), (RELATED + '.srag-rel-section', 2)])

    # 14–15 · command palette, compile
    open_file(p, 'Draft.md')
    p.evaluate('app.commands.executeCommandById("command-palette:open")')
    p.wait_for_timeout(600)
    p.keyboard.type('Academic Paper Citation Manager: ', delay=20)
    p.wait_for_timeout(700)
    shot(p, '14-command-palette', [('.prompt-input', 1)])
    p.keyboard.press('Escape')
    cmd(p, 'compile-manuscript', 3000)
    shot(p, '15-compiled', [('.workspace-tab-header.is-active', 1)])

    # 13 · settings (opens in its own window on recent Obsidian builds, or as a modal)
    p.evaluate(f'app.setting.open(); app.setting.openTabById("{PID}")')
    p.wait_for_timeout(1500)
    sp = next((q for c in browser.contexts for q in c.pages if q.evaluate('!!document.querySelector(".mod-settings")')), p)
    sp.evaluate('''()=>{const n=[...document.querySelectorAll(".mod-settings .setting-item-name")].find(e=>e.innerText==="Embedding provider");
      n.scrollIntoView({block:"start"}); document.querySelector(".mod-settings .vertical-tab-content").scrollTop -= 60;}''')
    sp.wait_for_timeout(400)
    shot(sp, '13-settings', [('.mod-settings .setting-item::text=Embedding provider', 1),
                             ('.mod-settings .setting-item::text=OpenAI API key', 2)])
    sp.evaluate('app.setting.close()') if sp is p else sp.close()


if __name__ == '__main__':
    main()
