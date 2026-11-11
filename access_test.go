package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Två barn med var sin profil och var sitt prov, plus en okopplad profil.
func seedFamily(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	pc := unlock(t, h)
	for path, doc := range map[string]string{
		"profiles/p1":          `{"name":"Ett","grade":5,"account":"barn1"}`,
		"profiles/p2":          `{"name":"Två","grade":3,"account":"barn2"}`,
		"profiles/p3":          `{"name":"Okopplad","grade":4}`,
		"tests/t1":             `{"profileId":"p1","subject":"SO"}`,
		"tests/t2":             `{"profileId":"p2","subject":"NO"}`,
		"tests/t1/goals/g1":    `{"text":"mål"}`,
		"tests/t1/attempts/a1": `{"score":0}`,
		"tests/t2/attempts/a1": `{"score":0}`,
	} {
		if w := doC(h, parent, "PUT", "/api/store/"+path, doc, pc); w.Code != 204 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
	}
	return pc
}

func ids(t *testing.T, body string) string {
	var docs []map[string]any
	if err := json.Unmarshal([]byte(body), &docs); err != nil {
		t.Fatal(body)
	}
	var out []string
	for _, d := range docs {
		out = append(out, d["id"].(string))
	}
	return strings.Join(out, ",")
}

func TestChildSeesOnlyOwn(t *testing.T) {
	_, h := testServer(t)
	seedFamily(t, h)
	if got := ids(t, do(h, child, "GET", "/api/store/profiles?list=1", "").Body.String()); got != "p1" {
		t.Errorf("barn1 profiler: %s", got)
	}
	if got := ids(t, do(h, child2, "GET", "/api/store/tests?list=1", "").Body.String()); got != "t2" {
		t.Errorf("barn2 prov: %s", got)
	}
	if got := ids(t, do(h, parent, "GET", "/api/store/profiles?list=1", "").Body.String()); got != "p1,p2,p3" {
		t.Errorf("förälder (låst) profiler: %s", got)
	}
	for _, p := range []string{"tests/t2", "tests/t2/goals?list=1", "tests/t2/attempts/a1", "profiles/p2", "profiles/p3", "settings/parent"} {
		if w := do(h, child, "GET", "/api/store/"+p, ""); w.Code != 403 {
			t.Errorf("barn1 läser %s: %d", p, w.Code)
		}
	}
	if w := do(h, child, "GET", "/api/store/tests/t1/goals?list=1", ""); w.Code != 200 || ids(t, w.Body.String()) != "g1" {
		t.Errorf("barn1 egna mål: %d %s", w.Code, w.Body)
	}
}

func TestChildWrites(t *testing.T) {
	_, h := testServer(t)
	seedFamily(t, h)
	allowed := map[string]string{
		"PUT /api/store/tests/t1/attempts/a2":   `{"score":1}`,
		"PATCH /api/store/tests/t1/attempts/a1": `{"disputed":true}`,
		"PUT /api/store/tests/t1/mastery/g1":    `{"level":2}`,
		"PUT /api/store/tests/t1/events/e1":     `{"type":"jump"}`,
		"PUT /api/store/tests/t1/chats/c1":      `{"messages":[]}`,
		"PUT /api/store/tests/t1/exams/x1":      `{"points":1}`,
	}
	for req, body := range allowed {
		m, u, _ := strings.Cut(req, " ")
		if w := do(h, child, m, u, body); w.Code != 204 {
			t.Errorf("%s: %d %s", req, w.Code, w.Body)
		}
	}
	denied := map[string]string{
		"PUT /api/store/tests/t2/attempts/a9":    `{}`, // syskonets prov
		"PUT /api/store/tests/t1":                `{"profileId":"p1"}`,
		"PATCH /api/store/tests/t1":              `{"testDate":"2026-12-01"}`,
		"PUT /api/store/tests/t1/goals/g1":       `{}`,
		"PUT /api/store/tests/t1/banks/g1":       `{"items":[]}`,
		"PUT /api/store/tests/t1/materials/m1":   `{}`,
		"DELETE /api/store/tests/t1/attempts/a1": ``,
		"PUT /api/store/tests/t9/attempts/a1":    `{}`, // prov som inte finns
		"PUT /api/store/profiles/p2":             `{"theme":"dark"}`,
		"PUT /api/store/profiles/pny":            `{"name":"Ny"}`,
		"PUT /api/store/settings/parent":         `{}`,
	}
	for req, body := range denied {
		m, u, _ := strings.Cut(req, " ")
		if w := do(h, child, m, u, body); w.Code != 403 {
			t.Errorf("%s: %d", req, w.Code)
		}
	}
	if w := do(h, child, "POST", "/api/files", "%PDF"); w.Code != 403 {
		t.Errorf("barn laddar upp fil: %d", w.Code)
	}
}

// Barnet byter tema och kompis, men kan inte ändra namn, årskurs eller koppling.
func TestChildProfileFields(t *testing.T) {
	_, h := testServer(t)
	seedFamily(t, h)
	w := do(h, child, "PUT", "/api/store/profiles/p1", `{"id":"p1","name":"Hackat","grade":9,"account":"barn2","theme":"dark","kompis":{"name":"Bläcky"}}`)
	if w.Code != 204 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	got := do(h, child, "GET", "/api/store/profiles/p1", "").Body.String()
	for _, want := range []string{`"name":"Ett"`, `"grade":5`, `"account":"barn1"`, `"theme":"dark"`, `"Bläcky"`} {
		if !strings.Contains(got, want) {
			t.Errorf("saknar %s i %s", want, got)
		}
	}
}

// En förälder utan upplåst läge övar som barn (lånad iPad) men ändrar inget annat.
func TestLockedParent(t *testing.T) {
	_, h := testServer(t)
	pc := seedFamily(t, h)
	if w := do(h, parent, "PUT", "/api/store/tests/t2/attempts/a5", `{}`); w.Code != 204 {
		t.Errorf("låst förälder svarar som barn: %d", w.Code)
	}
	w := do(h, parent, "PUT", "/api/store/tests/t1/goals/g2", `{}`)
	if w.Code != 403 || !strings.Contains(w.Body.String(), "låst") {
		t.Errorf("låst förälder ändrar mål: %d %s", w.Code, w.Body)
	}
	if w := doC(h, parent, "PUT", "/api/store/tests/t1/goals/g2", `{}`, pc); w.Code != 204 {
		t.Errorf("upplåst förälder: %d", w.Code)
	}
	doC(h, parent, "POST", "/api/auth/lock", "", pc)
	if w := doC(h, parent, "PUT", "/api/store/tests/t1/goals/g3", `{}`, pc); w.Code != 403 {
		t.Errorf("efter låsning: %d", w.Code)
	}
}

func TestPIN(t *testing.T) {
	a, h := testServer(t)
	st := do(h, parent, "GET", "/api/auth", "").Body.String()
	if !strings.Contains(st, `"hasPin":false`) || !strings.Contains(st, `"role":"parent"`) {
		t.Fatal(st)
	}
	if w := do(h, child, "POST", "/api/auth/pin", `{"pin":"1234"}`); w.Code != 403 {
		t.Fatalf("barn sätter PIN: %d", w.Code)
	}
	if w := do(h, parent, "POST", "/api/auth/pin", `{"pin":"12a4"}`); w.Code != 400 {
		t.Fatalf("ogiltig PIN: %d", w.Code)
	}
	pc := unlock(t, h)
	// Ny PIN kräver upplåst läge.
	if w := do(h, parent, "POST", "/api/auth/pin", `{"pin":"9999"}`); w.Code != 403 {
		t.Fatalf("byta PIN låst: %d", w.Code)
	}
	if w := doC(h, parent, "GET", "/api/auth", "", pc); !strings.Contains(w.Body.String(), `"unlocked":true`) || !strings.Contains(w.Body.String(), `"barn2"`) {
		t.Fatalf("status upplåst: %s", w.Body)
	}
	if w := do(h, child, "POST", "/api/auth/unlock", `{"pin":"1234"}`); w.Code != 403 {
		t.Fatalf("barn låser upp: %d", w.Code)
	}
	// Kakan gäller bara föräldrakontot som låste upp.
	if w := doC(h, child, "PUT", "/api/store/tests/x/goals/g", `{}`, pc); w.Code != 403 {
		t.Fatalf("barn med förälderns kaka: %d", w.Code)
	}
	// Fem fel → spärr, även för rätt PIN.
	var last string
	for i := 0; i < maxFailures; i++ {
		last = do(h, parent, "POST", "/api/auth/unlock", `{"pin":"0000"}`).Body.String()
	}
	if !strings.Contains(last, "waitSeconds") {
		t.Fatalf("ingen spärr: %s", last)
	}
	if w := do(h, parent, "POST", "/api/auth/unlock", `{"pin":"1234"}`); strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatal("rätt PIN under spärren släpptes igenom")
	}
	// PIN:en ligger aldrig i dokumentlagringen.
	if raw, _ := a.st.Get(t.Context(), "settings/parent"); raw != nil {
		t.Fatalf("settings/parent: %s", raw)
	}
}

func TestOrigin(t *testing.T) {
	_, h := testServer(t)
	pc := unlock(t, h)
	r := doReq(h, "PUT", "/api/store/tests/t1", `{}`, pc, "https://evil.example")
	if r.Code != 403 {
		t.Fatalf("främmande origin: %d", r.Code)
	}
	if r := doReq(h, "PUT", "/api/store/tests/t1", `{}`, pc, "http://example.com"); r.Code != 204 {
		t.Fatalf("egen origin: %d %s", r.Code, r.Body)
	}
}

func doReq(h http.Handler, method, url, body string, c *http.Cookie, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, url, strings.NewReader(body))
	r.RemoteAddr = parent
	r.AddCookie(c)
	r.Header.Set("Origin", origin)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
