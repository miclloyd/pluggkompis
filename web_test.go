package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mapWho: RemoteAddr → identitet, för att testa behörigheten.
type mapWho map[string]who

func (m mapWho) whois(_ context.Context, addr string) (who, error) {
	if w, ok := m[addr]; ok {
		return w, nil
	}
	return who{}, errors.New("okänd")
}

func testServer(t *testing.T) (*server, http.Handler) {
	t.Helper()
	index, err := serverIndex()
	if err != nil {
		t.Fatal(err)
	}
	st := testStore(t)
	auth, err := newAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	a := &server{
		st:    st,
		auth:  auth,
		index: index,
		who: mapWho{
			"1.1.1.1:1": {login: "forälder@github", stableID: "nTELEFON"},
			"1.1.1.2:1": {login: "forälder@github", stableID: "nSERVER"},
			"1.1.1.3:1": {login: "barn@github", stableID: "nIPAD"},
			"1.1.1.4:1": {login: "barn@github", stableID: "nX", tagged: true},
			"1.1.1.5:1": {login: "okänd@github", stableID: "nY"},
			"1.1.1.6:1": {login: "barn2@github", stableID: "nIPAD2"},
		},
	}
	a.setUsers([]User{
		{ID: "mamma", Login: "forälder@github", Name: "Förälder", Role: "parent", Devices: []string{"nTELEFON"}},
		{ID: "barn1", Login: "barn@github", Name: "Barn ett", Role: "child"},
		{ID: "barn2", Login: "barn2@github", Name: "Barn två", Role: "child"},
	})
	return a, a.routes()
}

func do(h http.Handler, from, method, url, body string) *httptest.ResponseRecorder {
	return doC(h, from, method, url, body, nil)
}

func doC(h http.Handler, from, method, url, body string, c *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, url, strings.NewReader(body))
	r.RemoteAddr = from
	if method != "GET" {
		r.Header.Set("Origin", "http://example.com") // som webbläsaren (dev-läge, httptest-värden)
	}
	if c != nil {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const parent, child, child2 = "1.1.1.1:1", "1.1.1.3:1", "1.1.1.6:1"

// unlock sätter PIN 1234 (om ingen finns) och returnerar föräldrakakan.
func unlock(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	w := do(h, parent, "POST", "/api/auth/pin", `{"pin":"1234"}`)
	if w.Code == 403 {
		w = do(h, parent, "POST", "/api/auth/unlock", `{"pin":"1234"}`)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			return c
		}
	}
	t.Fatalf("ingen kaka: %d %s", w.Code, w.Body)
	return nil
}

func TestIndexRewrite(t *testing.T) {
	b, err := serverIndex()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`href="libs/fonts.css"`, `src="libs/htm-preact-standalone.umd.js"`, `src="app.js"`} {
		if !bytes.Contains(b, []byte(want)) {
			t.Errorf("saknar %s", want)
		}
	}
}

func TestAuth(t *testing.T) {
	_, h := testServer(t)
	for from, want := range map[string]int{
		parent:      200,
		child:       200,
		"1.1.1.2:1": 403, // rätt login, fel enhet
		"1.1.1.4:1": 403, // taggad nod
		"1.1.1.5:1": 403, // okänd login
		"9.9.9.9:1": 403, // WhoIs misslyckas
	} {
		if w := do(h, from, "GET", "/", ""); w.Code != want {
			t.Errorf("%s: %d, väntade %d", from, w.Code, want)
		}
	}
}

func TestStaticAndHeaders(t *testing.T) {
	_, h := testServer(t)
	w := do(h, parent, "GET", "/", "")
	if !strings.Contains(w.Body.String(), "libs/fonts.css") {
		t.Fatal("index utan omskrivning")
	}
	if csp := w.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") {
		t.Fatalf("CSP: %q", csp)
	}
	for _, p := range []string{"/app.js", "/adapters/server.js", "/libs/pdf.min.js", "/libs/fonts.css", "/libs/fonts/atkinson-latin-400-normal.woff2"} {
		if w := do(h, parent, "GET", p, ""); w.Code != 200 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	if w := do(h, parent, "GET", "/app.js", ""); !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
		t.Errorf("app.js: Content-Type %q", w.Header().Get("Content-Type"))
	}
}

func TestConfig(t *testing.T) {
	_, h := testServer(t)
	w := do(h, parent, "GET", "/api/config", "")
	var c struct {
		Env      string
		Features map[string]any
		Libs     map[string]string
	}
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.Env != "server" || c.Features["persistent"] != true || c.Features["ai"] != false {
		t.Fatalf("%s", w.Body)
	}
	for k, u := range c.Libs {
		if w := do(h, parent, "GET", u, ""); w.Code != 200 {
			t.Errorf("libs.%s (%s): %d", k, u, w.Code)
		}
	}
}

// Samma anrop som web/adapters/server.js gör.
func TestStoreAPI(t *testing.T) {
	_, h := testServer(t)
	pc := unlock(t, h)
	do := func(h http.Handler, from, method, url, body string) *httptest.ResponseRecorder {
		if from == parent {
			return doC(h, from, method, url, body, pc)
		}
		return doC(h, from, method, url, body, nil)
	}
	if w := do(h, parent, "GET", "/api/store/tests/t1", ""); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "null" {
		t.Fatalf("saknat dokument: %d %s", w.Code, w.Body)
	}
	if w := do(h, parent, "PUT", "/api/store/tests/t1", `{"subject":"NO"}`); w.Code != 204 {
		t.Fatalf("put: %d %s", w.Code, w.Body)
	}
	if w := do(h, parent, "PATCH", "/api/store/tests/t1", `{"status":"ready"}`); w.Code != 204 {
		t.Fatalf("patch: %d", w.Code)
	}
	w := do(h, parent, "GET", "/api/store/tests/t1", "")
	if !strings.Contains(w.Body.String(), `"status":"ready"`) || !strings.Contains(w.Body.String(), `"id":"t1"`) {
		t.Fatalf("get: %s", w.Body)
	}
	w = do(h, parent, "GET", "/api/store/tests?list=1", "")
	var list []map[string]any
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0]["id"] != "t1" {
		t.Fatalf("list: %s", w.Body)
	}
	if w := do(h, parent, "GET", "/api/store/profiles?list=1", ""); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("tom lista: %s", w.Body)
	}
	// ServeMux städar sökvägen och svarar med omdirigering; inget sparas.
	if w := do(h, parent, "PUT", "/api/store/tests/../x", `{}`); w.Code == 204 {
		t.Fatalf("sökväg med ..: %d", w.Code)
	}
	if w := do(h, parent, "PUT", "/api/store/tests/t2", `[1]`); w.Code != 400 {
		t.Fatalf("array: %d", w.Code)
	}
	if w := do(h, parent, "DELETE", "/api/store/tests/t1", ""); w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
	if w := do(h, parent, "GET", "/api/nope", ""); w.Code != 404 || !strings.Contains(w.Body.String(), "message") {
		t.Fatalf("okänd api: %d %s", w.Code, w.Body)
	}
}

func TestFilesAPI(t *testing.T) {
	_, h := testServer(t)
	pc := unlock(t, h)
	r := httptest.NewRequest("POST", "/api/files", strings.NewReader("%PDF-1.4 test"))
	r.Header.Set("Origin", "http://example.com")
	r.RemoteAddr = parent
	r.AddCookie(pc)
	r.Header.Set("Content-Type", "application/pdf")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var res struct{ ID, URL string }
	json.Unmarshal(w.Body.Bytes(), &res)
	if w.Code != 200 || res.URL != "/api/files/"+res.ID {
		t.Fatalf("put: %d %s", w.Code, w.Body)
	}
	w = do(h, child, "GET", res.URL, "")
	if b, _ := io.ReadAll(w.Body); string(b) != "%PDF-1.4 test" || w.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("get: %q %s", b, w.Header().Get("Content-Type"))
	}

	// HTML förklädd som bild får aldrig visas inline från vår origin.
	r = httptest.NewRequest("POST", "/api/files", strings.NewReader("<html><script>alert(1)</script>"))
	r.Header.Set("Origin", "http://example.com")
	r.RemoteAddr = parent
	r.AddCookie(pc)
	r.Header.Set("Content-Type", "text/html")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	json.Unmarshal(w.Body.Bytes(), &res)
	w = do(h, parent, "GET", res.URL, "")
	if w.Header().Get("Content-Type") != "application/octet-stream" || w.Header().Get("Content-Disposition") != "attachment" {
		t.Fatalf("html: %q %q", w.Header().Get("Content-Type"), w.Header().Get("Content-Disposition"))
	}
}

func TestNoListing(t *testing.T) {
	_, h := testServer(t)
	for _, p := range []string{"/adapters/", "/libs/", "/libs/fonts/"} {
		if w := do(h, parent, "GET", p, ""); w.Code != 404 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
}

func TestHealthz(t *testing.T) {
	_, h := testServer(t)
	// Okänd nod (WhoIs misslyckas) får bara "ok".
	if w := do(h, "9.9.9.9:1", "GET", "/healthz", ""); w.Code != 200 || w.Body.String() != "ok" {
		t.Fatalf("%d %q", w.Code, w.Body)
	}
	if w := do(h, "9.9.9.9:1", "GET", "/healthz/../api/config", ""); w.Code == 200 && strings.Contains(w.Body.String(), "features") {
		t.Fatal("healthz släppte igenom något annat")
	}
}
