package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const lanHostT = "plugg.example.test"

// lanServer: samma server som tailnätets, men som LAN-lyssnaren.
func lanServer(t *testing.T) (*server, http.Handler, http.Handler, *http.Cookie) {
	t.Helper()
	a, h := testServer(t)
	pc := seedFamily(t, h)
	l := *a
	l.lan, l.host = true, lanHostT
	return a, h, l.routes(), pc
}

func lanDo(h http.Handler, method, url, body string, c *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, url, strings.NewReader(body))
	r.Host = lanHostT
	r.RemoteAddr = "203.0.113.50:5000"
	if method != "GET" {
		r.Header.Set("Origin", "https://"+lanHostT)
	}
	if c != nil {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func lanLoginT(t *testing.T, lh http.Handler, user, pass string) *http.Cookie {
	t.Helper()
	w := lanDo(lh, "POST", "/api/lan/login", `{"username":"`+user+`","password":"`+pass+`"}`, nil)
	for _, c := range w.Result().Cookies() {
		if c.Name == lanCookie && c.Value != "" {
			return c
		}
	}
	return nil
}

func TestLANLoginFlow(t *testing.T) {
	_, h, lh, pc := lanServer(t)
	// Utan inloggning: sidan och inloggningen, inget annat.
	if w := lanDo(lh, "GET", "/", "", nil); w.Code != 200 {
		t.Fatalf("sidan: %d", w.Code)
	}
	if w := lanDo(lh, "GET", "/api/store/profiles?list=1", "", nil); w.Code != 401 {
		t.Fatalf("utan inloggning: %d", w.Code)
	}
	if b := lanDo(lh, "GET", "/api/auth", "", nil).Body.String(); !strings.Contains(b, `"loggedIn":false`) || !strings.Contains(b, `"lan":true`) {
		t.Fatalf("status: %s", b)
	}
	// Föräldern sätter inloggningen via tailnätet (upplåst).
	for _, c := range []struct {
		name, from, body string
		ck               *http.Cookie
		want             int
	}{
		{"låst förälder", parent, `{"account":"barn1","username":"elev1","password":"hemligt123"}`, nil, 403},
		{"barnet", child, `{"account":"barn1","username":"elev1","password":"hemligt123"}`, nil, 403},
		{"kort lösenord", parent, `{"account":"barn1","username":"elev1","password":"1234"}`, pc, 400},
		{"föräldrakonto", parent, `{"account":"mamma","username":"mamma","password":"hemligt123"}`, pc, 400},
		{"ogiltigt namn", parent, `{"account":"barn1","username":"E L","password":"hemligt123"}`, pc, 400},
		{"ok", parent, `{"account":"barn1","username":"Elev1","password":"hemligt123"}`, pc, 204},
		{"6 siffror ok", parent, `{"account":"barn2","username":"elev2","password":"482913"}`, pc, 204},
		{"namnet är upptaget", parent, `{"account":"barn2","username":"elev1","password":"482913"}`, pc, 409},
	} {
		if w := doC(h, c.from, "PUT", "/api/lan/credentials", c.body, c.ck); w.Code != c.want {
			t.Errorf("%s: %d, väntade %d (%s)", c.name, w.Code, c.want, w.Body)
		}
	}
	if b := doC(h, parent, "GET", "/api/lan/credentials", "", pc).Body.String(); !strings.Contains(b, `"username":"elev1"`) || strings.Contains(b, "hash") {
		t.Fatalf("lista: %s", b)
	}
	// Inloggning på LAN.
	if lanLoginT(t, lh, "elev1", "fel-lösen") != nil {
		t.Fatal("fel lösenord gav kaka")
	}
	ck := lanLoginT(t, lh, "ELEV1", "hemligt123") // versaler i namnet går bra
	if ck == nil || !ck.HttpOnly || !ck.Secure || ck.SameSite != http.SameSiteStrictMode {
		t.Fatalf("kaka: %+v", ck)
	}
	if got := ids(t, lanDo(lh, "GET", "/api/store/profiles?list=1", "", ck).Body.String()); got != "p1" {
		t.Fatalf("barnet på LAN ser: %q", got)
	}
	if w := lanDo(lh, "GET", "/api/store/tests/t2", "", ck); w.Code != 403 {
		t.Fatalf("syskonets prov: %d", w.Code)
	}
	if b := lanDo(lh, "GET", "/api/auth", "", ck).Body.String(); !strings.Contains(b, `"account":"barn1"`) || !strings.Contains(b, `"loggedIn":true`) {
		t.Fatalf("status inloggad: %s", b)
	}
	// Aldrig föräldraläge eller förälderns verktyg på LAN.
	// Föräldravägarna finns inte på LAN (404 eller 405), varken inloggad eller utloggad.
	for _, c := range []*http.Cookie{ck, nil} {
		for _, req := range []string{"POST /api/auth/unlock", "POST /api/auth/pin", "POST /api/auth/lock", "GET /api/usage", "PUT /api/lan/credentials", "DELETE /api/lan/credentials/barn1"} {
			m, u, _ := strings.Cut(req, " ")
			w := lanDo(lh, m, u, `{"pin":"1234","account":"barn1","username":"x","password":"hemligt123"}`, c)
			if w.Code != 404 && w.Code != 405 && !(c == nil && w.Code == 401) {
				t.Errorf("%s på LAN (inloggad=%v): %d", req, c != nil, w.Code)
			}
		}
	}
	// Andra barns data.
	for _, p := range []string{"profiles/p2", "tests/t2/attempts?list=1", "tasks?list=1"} {
		w := lanDo(lh, "GET", "/api/store/"+p, "", ck)
		if p == "tasks?list=1" {
			if strings.TrimSpace(w.Body.String()) != "[]" {
				t.Errorf("uppgifter på LAN: %s", w.Body)
			}
			continue
		}
		if w.Code != 403 {
			t.Errorf("%s på LAN: %d", p, w.Code)
		}
	}
	if w := lanDo(lh, "GET", "/api/lan/credentials", "", ck); w.Code != 404 {
		t.Fatalf("listan på LAN: %d", w.Code)
	}
	if w := lanDo(lh, "PUT", "/api/store/tests/t1/goals/gx", `{}`, ck); w.Code != 403 {
		t.Fatalf("barnet skriver mål på LAN: %d", w.Code)
	}
	if w := lanDo(lh, "PUT", "/api/store/tests/t1/attempts/ax", `{"score":1}`, ck); w.Code != 204 {
		t.Fatalf("barnet svarar på LAN: %d %s", w.Code, w.Body)
	}
	// Byte av lösenord loggar ut skoldatorerna.
	doC(h, parent, "PUT", "/api/lan/credentials", `{"account":"barn1","username":"elev1","password":"nytt-hemligt"}`, pc)
	if w := lanDo(lh, "GET", "/api/store/profiles?list=1", "", ck); w.Code != 401 {
		t.Fatalf("gammal session efter byte: %d", w.Code)
	}
	ck = lanLoginT(t, lh, "elev1", "nytt-hemligt")
	lanDo(lh, "POST", "/api/lan/logout", "", ck)
	if w := lanDo(lh, "GET", "/api/store/profiles?list=1", "", ck); w.Code != 401 {
		t.Fatalf("efter utloggning: %d", w.Code)
	}
	// Föräldern tar bort inloggningen.
	ck = lanLoginT(t, lh, "elev1", "nytt-hemligt")
	doC(h, parent, "DELETE", "/api/lan/credentials/barn1", "", pc)
	if w := lanDo(lh, "GET", "/api/store/profiles?list=1", "", ck); w.Code != 401 {
		t.Fatalf("efter borttagning: %d", w.Code)
	}
}

// Okänt användarnamn tar lika lång tid som ett känt (argon2 körs i båda fallen).
func TestLANUnknownUserHashes(t *testing.T) {
	_, h, lh, pc := lanServer(t)
	doC(h, parent, "PUT", "/api/lan/credentials", `{"account":"barn1","username":"elev1","password":"hemligt123"}`, pc)
	timeIt := func(user string) time.Duration {
		start := time.Now()
		for i := 0; i < 3; i++ {
			lanDo(lh, "POST", "/api/lan/login", `{"username":"`+user+`","password":"fel`+string(rune('a'+i))+`"}`, nil)
		}
		return time.Since(start)
	}
	known, unknown := timeIt("elev1"), timeIt("finns-inte")
	if unknown < known/2 {
		t.Fatalf("okänt namn %v mot känt %v: hashas inte", unknown, known)
	}
}

func TestLANLockoutAndHost(t *testing.T) {
	a, h, lh, pc := lanServer(t)
	doC(h, parent, "PUT", "/api/lan/credentials", `{"account":"barn1","username":"elev1","password":"hemligt123"}`, pc)
	var last string
	for i := 0; i < lanMaxFailures; i++ {
		last = lanDo(lh, "POST", "/api/lan/login", `{"username":"elev1","password":"fel"}`, nil).Body.String()
	}
	if !strings.Contains(last, "waitSeconds") {
		t.Fatalf("ingen spärr: %s", last)
	}
	if lanLoginT(t, lh, "elev1", "hemligt123") != nil {
		t.Fatal("rätt lösenord under spärren")
	}
	a.auth.now = func() time.Time { return time.Now().Add(lanLockout + time.Second) }
	if lanLoginT(t, lh, "elev1", "hemligt123") == nil {
		t.Fatal("efter spärren")
	}
	// Fel värdnamn (DNS-rebinding) och skrivning utan egen origin.
	r := httptest.NewRequest("GET", "/", nil)
	r.Host = "evil.example"
	w := httptest.NewRecorder()
	lh.ServeHTTP(w, r)
	if w.Code != http.StatusMisdirectedRequest {
		t.Fatalf("fel host: %d", w.Code)
	}
	r = httptest.NewRequest("POST", "/api/lan/login", strings.NewReader(`{}`))
	r.Host = lanHostT
	w = httptest.NewRecorder()
	lh.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("inloggning utan origin: %d", w.Code)
	}
}

// Sessionen överlever en omstart (ny Auth på samma databas), och en kaka för ett
// konto som inte längre är barnkonto ger ingen identitet.
func TestLANSessionPersists(t *testing.T) {
	a, h, lh, pc := lanServer(t)
	doC(h, parent, "PUT", "/api/lan/credentials", `{"account":"barn1","username":"elev1","password":"hemligt123"}`, pc)
	ck := lanLoginT(t, lh, "elev1", "hemligt123")
	auth2, err := newAuth(a.st)
	if err != nil {
		t.Fatal(err)
	}
	l2 := *a
	l2.auth, l2.lan, l2.host = auth2, true, lanHostT
	if w := lanDo(l2.routes(), "GET", "/api/store/profiles?list=1", "", ck); w.Code != 200 {
		t.Fatalf("efter omstart: %d", w.Code)
	}
	l2.setUsers([]User{{ID: "mamma", Login: "forälder@github", Role: "parent", Devices: []string{"nTELEFON"}}})
	if w := lanDo(l2.routes(), "GET", "/api/store/profiles?list=1", "", ck); w.Code != 401 {
		t.Fatalf("konto som inte finns kvar: %d", w.Code)
	}
	var d map[string]any
	json.Unmarshal(lanDo(lh, "GET", "/api/config", "", nil).Body.Bytes(), &d)
	if d["env"] != "server" {
		t.Fatalf("config på LAN: %v", d)
	}
}

// Full spärrtabell: aktiva spärrar tas aldrig bort, och nya försök nekas (fail-closed).
func TestLANFailTableFull(t *testing.T) {
	a, h, lh, pc := lanServer(t)
	doC(h, parent, "PUT", "/api/lan/credentials", `{"account":"barn1","username":"elev1","password":"hemligt123"}`, pc)
	for i := 0; i < lanMaxFailures; i++ {
		lanDo(lh, "POST", "/api/lan/login", `{"username":"elev1","password":"fel"}`, nil)
	}
	a.auth.mu.Lock()
	for i := 0; len(a.auth.lanFail) < lanMaxTracked; i++ {
		a.auth.lanFail[fmt.Sprintf("fake%d|x", i)] = &failure{n: 1, until: time.Now().Add(time.Hour)}
	}
	a.auth.mu.Unlock()
	lanDo(lh, "POST", "/api/lan/login", `{"username":"ny-person","password":"fel"}`, nil)
	a.auth.mu.Lock()
	_, still := a.auth.lanFail[lanFailKey("elev1", "203.0.113.50:5000")]
	a.auth.mu.Unlock()
	if !still {
		t.Fatal("den riktiga spärren togs bort")
	}
	if lanLoginT(t, lh, "elev1", "hemligt123") != nil {
		t.Fatal("rätt lösenord medan spärren gäller")
	}
}
