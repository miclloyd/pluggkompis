# "Ny version finns": bannern visas när /api/config svarar med en annan build än den sidan
# laddades med, och Senare döljer den. Kör mot en dev-server: python3 version.py http://127.0.0.1:8095
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8095'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 393, 'height': 852}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '/'); pg.wait_for_timeout(1000)
    assert pg.locator('.notice.update').count() == 0, 'ingen banner före'
    def fake(route):
        r = route.fetch(); d = r.json(); d['build'] = 'annanversion'; route.fulfill(response=r, body=json.dumps(d))
    pg.route('**/api/config', fake)
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(800)
    assert pg.locator('.notice.update').count() == 1, 'banner efter ny build'
    pg.get_by_role('button', name='Senare').click(); pg.wait_for_timeout(200)
    assert pg.locator('.notice.update').count() == 0, 'Senare döljer'
    assert not errs, errs
    b.close()
print('version: ok')
