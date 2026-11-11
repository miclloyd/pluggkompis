import sys, threading, functools, http.server, socketserver, base64
from playwright.sync_api import sync_playwright
import os
S=os.path.dirname(os.path.abspath(__file__))
w=int(sys.argv[1]); pre=f"n{w}"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=f'{S}/site')); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(args=['--no-sandbox'])
    pg=b.new_context(viewport={'width':w,'height':900}).new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and 'favicon' not in m.text and '404' not in m.text and errs.append(m.text))
    pg.set_default_timeout(6000)
    shot=lambda n, full=True: pg.screenshot(path=f'{S}/shots/{pre}-{n}.png', full_page=full)
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_timeout(700)
    pg.get_by_role('button',name='Test').first.click(); pg.wait_for_timeout(600); shot('01-child')
    # studio
    pg.locator('.hero-kompis').click(); pg.wait_for_timeout(600)
    pg.get_by_role('button',name='Röd').click(); pg.get_by_role('button',name='Mössa').click()
    pg.locator('#kname').fill('Bläcky'); pg.get_by_role('radio',name='Mörkt').click(); pg.wait_for_timeout(500); shot('02-studio')
    pg.get_by_role('button',name='Klar').click(); pg.wait_for_timeout(900); shot('03-saved', False)
    pg.get_by_role('button',name='Tillbaka').click(); pg.wait_for_timeout(600); shot('04-child-dark')
    print('theme attr:', pg.evaluate("document.documentElement.getAttribute('data-theme')"))
    # menu
    pg.locator('.cover', has_text='Religion').first.click(); pg.wait_for_timeout(500); shot('05-menu', False)
    pg.get_by_role('button', name='Provläge').click(); pg.wait_for_timeout(700); shot('06-exam-intro')
    pg.get_by_role('button',name='Starta provet').click(); pg.wait_for_timeout(400)
    for i in range(14):
        if not pg.locator('.exam-count').count(): break
        if i == 1: shot('07-exam-q', False)
        if pg.locator('.option').count(): pg.locator('.option').first.click()
        elif pg.locator('input.answer').count(): pg.locator('input.answer').fill('imam'); pg.keyboard.press('Enter')
        elif pg.locator('textarea.answer').count(): pg.locator('textarea.answer').fill('Man ger pengar till de fattiga.'); pg.get_by_role('button',name='Svara').click()
        else: pg.get_by_role('button',name='Hoppa över').click()
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(1500); shot('08-exam-result')
    pg.locator('.exam-review summary').click(); pg.wait_for_timeout(300); shot('09-exam-review')
    pg.get_by_role('button',name='Klar').click(); pg.wait_for_timeout(600)
    # teach
    pg.locator('.cover', has_text='Religion').first.click(); pg.wait_for_timeout(400)
    pg.get_by_role('button', name='Lär ut det').click(); pg.wait_for_timeout(1500); shot('10-teach')
    pg.locator('#teach-in').fill('De fem pelarna är saker som muslimer gör. Man ber fem gånger om dagen mot Mekka.')
    pg.get_by_role('button',name='Förklara').click(); pg.wait_for_timeout(1500); shot('11-teach-q')
    pg.locator('#teach-in').fill('Ja, allmosan. Man ger pengar till fattiga, det kallas zakat.')
    pg.get_by_role('button',name='Svara').click(); pg.wait_for_timeout(1800); shot('12-teach-done')
    pg.get_by_role('button',name='Klar').click(); pg.wait_for_timeout(500)
    # parent
    pg.get_by_role('button',name='Byt person').click(); pg.wait_for_timeout(400)
    pg.get_by_role('button', name='Förälder').click(); pg.wait_for_timeout(300)
    pg.fill('#pin', '1234'); pg.get_by_role('button', name='Lås upp').click(); pg.wait_for_timeout(700)
    pg.locator('.list-row', has_text='Religion').last.click(); pg.wait_for_timeout(900); shot('13-parent')
    pg.get_by_role('button',name='Skriv ut och exportera').click(); pg.wait_for_timeout(400); shot('14-print', False)
    pg.get_by_role('button',name='Skapa PDF').click(); pg.wait_for_timeout(4000)
    saved = pg.evaluate("""async () => { const s = window.__saved; if (!s) return null; const b = s.data instanceof Blob ? new Uint8Array(await s.data.arrayBuffer()) : new TextEncoder().encode(s.data); let bin=''; for (const x of b) bin += String.fromCharCode(x); return { name: s.filename, b64: btoa(bin) }; }""")
    if saved: open(f'{S}/shots/{saved["name"]}','wb').write(base64.b64decode(saved['b64'])); print('saved', saved['name'])
    shot('15-print-done', False)
    pg.get_by_role('button',name='Alla svar som tabell (CSV)').click(); pg.wait_for_timeout(800)
    saved = pg.evaluate("() => window.__saved && { name: window.__saved.filename, text: String(window.__saved.data).slice(0, 600) }")
    print(saved)
    print('fel:', errs or 'inga')
    b.close()
srv.shutdown()
