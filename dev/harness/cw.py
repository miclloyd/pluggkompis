import sys, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright
import os
S=os.path.dirname(os.path.abspath(__file__))
w=int(sys.argv[1]); dark=len(sys.argv)>2; pre=f"cw{w}{'d' if dark else ''}"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=f'{S}/site')); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(args=['--no-sandbox'])
    pg=b.new_context(viewport={'width':w,'height':900},color_scheme='dark' if dark else 'light').new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.set_default_timeout(6000)
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_timeout(700)
    pg.get_by_role('button',name='Test').first.click(); pg.wait_for_timeout(500)
    pg.locator('.cover', has_text='Engelska').first.click(); pg.wait_for_timeout(700)
    pg.locator('.tm-opt.main').click(); pg.wait_for_timeout(700)
    pg.locator('input.answer').fill('neccesary'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    shot=lambda n: pg.screenshot(path=f'{S}/shots/{pre}-{n}.png', full_page=True)
    shot('1-look')
    pg.get_by_role('button',name='Täck över och skriv').click(); pg.wait_for_timeout(300)
    pg.locator('#cw-in').fill('necesary'); shot('2-write'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); shot('3-again')
    pg.get_by_role('button',name='Täck över och skriv').click(); pg.wait_for_timeout(200)
    pg.locator('#cw-in').fill('necessary'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500); shot('4-done')
    print('nästa aktiv:', pg.get_by_role('button',name='Nästa').is_enabled(), 'fel:', errs or 'inga')
    b.close()
srv.shutdown()
