package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
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
		"PATCH /api/store/tests/t1":              `{"testDate":"2030-12-01"}`,
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
	w := do(h, child, "PUT", "/api/store/profiles/p1", `{"id":"p1","name":"Hackat","grade":9,"account":"barn2","theme":"dark","kompis":{"color":"#2f4fb8","accessory":"mossa","name":"Bläcky"}}`)
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
	// Barnets anrop bär ingen kaka: utan Origin och Sec-Fetch-Site nekas det.
	req := httptest.NewRequest("PUT", "/api/store/tests/t1/attempts/a1", strings.NewReader(`{}`))
	req.RemoteAddr = child
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("utan origin: %d", w.Code)
	}
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("cross-site: %d", w.Code)
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

// Granskarens blockerare: parallella fel-PIN får inte passera spärren.
func TestPINConcurrent(t *testing.T) {
	_, h := testServer(t)
	unlock(t, h)
	do(h, parent, "POST", "/api/auth/lock", "")
	var wg sync.WaitGroup
	var mu sync.Mutex
	tried := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := do(h, parent, "POST", "/api/auth/unlock", `{"pin":"0000"}`)
			if !strings.Contains(w.Body.String(), "waitSeconds") {
				mu.Lock()
				tried++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if tried != maxFailures-1 {
		t.Fatalf("%d försök prövades utan spärr, väntade %d", tried, maxFailures-1)
	}
	if w := do(h, parent, "POST", "/api/auth/unlock", `{"pin":"1234"}`); strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatal("rätt PIN släpptes igenom under spärren")
	}
}

func TestPINChangeEndsSessions(t *testing.T) {
	a, h := testServer(t)
	old := unlock(t, h)
	tok := a.auth.newSession("forälder@github") // en annan upplåst session
	if w := doC(h, parent, "POST", "/api/auth/pin", `{"pin":"5678"}`, old); w.Code != 200 {
		t.Fatalf("byte: %d %s", w.Code, w.Body)
	}
	if w := doC(h, parent, "PUT", "/api/store/tests/x", `{}`, &http.Cookie{Name: sessionCookie, Value: tok}); w.Code != 403 {
		t.Fatalf("gammal session efter PIN-byte: %d", w.Code)
	}
}

func TestHostCheck(t *testing.T) {
	a, h := testServer(t)
	a.host = "pluggkompis.tailnet.example"
	for host, want := range map[string]int{"pluggkompis.tailnet.example": 200, "pluggkompis.tailnet.example:443": 200, "evil.example": 421} {
		r := httptest.NewRequest("GET", "/api/config", nil)
		r.Host = host
		r.RemoteAddr = parent
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Errorf("%s: %d", host, w.Code)
		}
	}
}

func TestChildProfileValidation(t *testing.T) {
	_, h := testServer(t)
	seedFamily(t, h)
	for _, body := range []string{
		`{"theme":"<script>"}`,
		`{"kompis":{"color":"red;background:url(x)","accessory":"inget","name":"A"}}`,
		`{"kompis":{"color":"#2f4fb8","accessory":"inget","name":"\"><img src=x>långtlångtlångtlångt"}}`,
		`{"kompis":{"color":"#2f4fb8","accessory":"krona","name":"A"}}`,
	} {
		if w := do(h, child, "PATCH", "/api/store/profiles/p1", body); w.Code != 400 {
			t.Errorf("%s: %d", body, w.Code)
		}
	}
	if w := do(h, child, "PATCH", "/api/store/profiles/p1", `{"theme":"dark","kompis":{"color":"#2f4fb8","accessory":"mossa","name":"Bläcky"}}`); w.Code != 204 {
		t.Errorf("giltigt: %d %s", w.Code, w.Body)
	}
}

func TestChildGrade(t *testing.T) {
	at := func(s string) time.Time { tm, _ := time.Parse("2006-01-02", s); return tm }
	for _, c := range []struct {
		by, off int
		now     string
		want    int
	}{
		// Fiktiv framtid (läsåret 2044/45): inga årtal som kan vara verkliga barns.
		{2030, 0, "2044-11-11", 8},
		{2030, 0, "2045-06-30", 8},
		{2030, 0, "2045-07-01", 9}, // läsåret byts 1 juli
		{2030, -1, "2044-11-11", 7},
		{2044, 0, "2044-11-11", 0},
	} {
		if g := childGrade(c.by, c.off, at(c.now)); g != c.want {
			t.Errorf("%d%+d %s: %d, väntade %d", c.by, c.off, c.now, g, c.want)
		}
	}
}

func TestChildNeverSeesBirthYear(t *testing.T) {
	_, h := testServer(t)
	pc := seedFamily(t, h)
	doC(h, parent, "PATCH", "/api/store/profiles/p1", `{"birthYear":2030,"birthMonth":4,"gradeOffset":0}`, pc)
	for _, url := range []string{"/api/store/profiles/p1", "/api/store/profiles?list=1"} {
		b := do(h, child, "GET", url, "").Body.String()
		if strings.Contains(b, "birth") || strings.Contains(b, "gradeOffset") || !strings.Contains(b, `"grade":`) {
			t.Errorf("%s: %s", url, b)
		}
	}
	if b := do(h, parent, "GET", "/api/store/profiles/p1", "").Body.String(); !strings.Contains(b, `"birthYear":2030`) {
		t.Errorf("föräldern: %s", b)
	}
	// Barnets sparning (PUT med hela profilen, och PATCH) får inte radera födelseåret.
	do(h, child, "PATCH", "/api/store/profiles/p1", `{"birthYear":null,"theme":"light"}`)
	if b := do(h, parent, "GET", "/api/store/profiles/p1", "").Body.String(); !strings.Contains(b, `"birthYear":2030`) || !strings.Contains(b, `"theme":"light"`) {
		t.Errorf("efter barnets PATCH: %s", b)
	}
	do(h, child, "PUT", "/api/store/profiles/p1", `{"name":"Ett","grade":5,"theme":"dark"}`)
	if b := do(h, parent, "GET", "/api/store/profiles/p1", "").Body.String(); !strings.Contains(b, `"birthYear":2030`) || !strings.Contains(b, `"theme":"dark"`) {
		t.Errorf("efter barnets temabyte: %s", b)
	}
}

// Skoluppgifter: barnet skapar och skriver sina egna, kan inte byta ägare eller
// stödnivå, och ser inte syskonets.
func TestTasks(t *testing.T) {
	_, h := testServer(t)
	pc := seedFamily(t, h)
	doC(h, parent, "PATCH", "/api/store/profiles/p1", `{"taskSupport":3}`, pc)
	if w := do(h, child, "PUT", "/api/store/tasks/k1", `{"profileId":"p1","support":1,"title":"Vikingar","versions":[]}`); w.Code != 204 {
		t.Fatalf("skapa: %d %s", w.Code, w.Body)
	}
	b := do(h, child, "GET", "/api/store/tasks/k1", "").Body.String()
	if !strings.Contains(b, `"support":3`) {
		t.Fatalf("stödnivån ska komma från profilen: %s", b)
	}
	if w := do(h, child, "PUT", "/api/store/tasks/k1", `{"profileId":"p2","support":1,"title":"Vikingar","versions":[{"text":"a","feedback":{"strength":"Bra."}}]}`); w.Code != 204 {
		t.Fatalf("uppdatera: %d %s", w.Code, w.Body)
	}
	b = do(h, child, "GET", "/api/store/tasks/k1", "").Body.String()
	if !strings.Contains(b, `"profileId":"p1"`) || !strings.Contains(b, `"support":3`) || !strings.Contains(b, `"text":"a"`) {
		t.Fatalf("ägare och nivå ska ligga kvar: %s", b)
	}
	for name, c := range map[string]struct{ from, method, url, body string }{
		"syskonet läser":    {child2, "GET", "/api/store/tasks/k1", ""},
		"syskonet skriver":  {child2, "PUT", "/api/store/tasks/k1", `{"profileId":"p2"}`},
		"skapa åt syskonet": {child, "PUT", "/api/store/tasks/k2", `{"profileId":"p2"}`},
		"skapa utan profil": {child, "PUT", "/api/store/tasks/k3", `{"title":"x"}`},
		"barnet raderar":    {child, "DELETE", "/api/store/tasks/k1", ""},
		"djupare sökväg":    {child, "PUT", "/api/store/tasks/k1/x/y", `{}`},
	} {
		if w := do(h, c.from, c.method, c.url, c.body); w.Code != 403 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if got := ids(t, do(h, child2, "GET", "/api/store/tasks?list=1", "").Body.String()); got != "" {
		t.Errorf("syskonets lista: %q", got)
	}
	if got := ids(t, do(h, parent, "GET", "/api/store/tasks?list=1", "").Body.String()); got != "k1" {
		t.Errorf("förälderns lista: %q", got)
	}
	// Låst förälder (lånad iPad) kan skapa åt vilket barn som helst, men inte välja nivå.
	if w := do(h, parent, "PUT", "/api/store/tasks/k4", `{"profileId":"p2","support":3}`); w.Code != 204 {
		t.Fatalf("låst förälder: %d", w.Code)
	}
	if b := do(h, parent, "GET", "/api/store/tasks/k4", "").Body.String(); !strings.Contains(b, `"support":2`) {
		t.Errorf("förvald nivå 2: %s", b)
	}
	if w := doC(h, parent, "DELETE", "/api/store/tasks/k4", "", pc); w.Code != 204 {
		t.Errorf("förälder raderar: %d", w.Code)
	}
}

// Versionerna är en logg: barnet lägger till en i taget, med feedback, högst tre,
// och ändrar aldrig tidigare. Veckogränsen gäller på servern.
func TestTaskVersionsAppendOnly(t *testing.T) {
	a, h := testServer(t)
	seedFamily(t, h)
	v := func(n int) string { return fmt.Sprintf(`{"n":%d,"text":"t%d","feedback":{"strength":"Bra."}}`, n, n) }
	put := func(id, versions string) int {
		return do(h, child, "PUT", "/api/store/tasks/"+id, `{"profileId":"p1","title":"x","versions":[`+versions+`]}`).Code
	}
	if c := put("k1", ""); c != 204 {
		t.Fatalf("tom: %d", c)
	}
	if c := put("k1", v(1)); c != 204 {
		t.Fatalf("första: %d", c)
	}
	for name, c := range map[string]int{
		"töm loggen":         put("k1", ""),
		"ändra version 1":    put("k1", `{"n":1,"text":"annan","feedback":{"strength":"Bra."}}`),
		"två nya på en gång": put("k1", v(1)+","+v(2)+","+v(3)),
		"utan feedback":      put("k1", v(1)+`,{"n":2,"text":"t2"}`),
	} {
		if c != 403 && c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	if c := put("k1", v(1)+","+v(2)); c != 204 {
		t.Fatalf("andra: %d", c)
	}
	// Ett stoppat försök räknas inte som omgång: efter det går en tredje omgång med feedback.
	b3 := `{"n":3,"text":"t3","blocked":true}`
	if c := put("k1", v(1)+","+v(2)+","+b3); c != 204 {
		t.Fatalf("stoppat försök: %d", c)
	}
	if c := put("k1", v(1)+","+v(2)+","+b3+","+v(4)); c != 204 {
		t.Fatalf("tredje omgången efter ett stoppat försök: %d", c)
	}
	if c := put("k1", v(1)+","+v(2)+","+b3+","+v(4)+","+v(5)); c != 403 {
		t.Fatalf("fjärde omgången med feedback: %d", c)
	}
	// En version med både blocked och feedback nekas (den kunde annars räknas som stoppad).
	if c := put("k1", v(1)+","+v(2)+","+b3+","+v(4)+`,{"n":5,"blocked":true,"feedback":{"strength":"Bra."}}`); c != 400 {
		t.Fatalf("både blocked och feedback: %d", c)
	}
	// Högst tre stoppade försök.
	put("k9", "")
	bs := ""
	for i := 1; i <= 3; i++ {
		bs += fmt.Sprintf(`{"n":%d,"blocked":true},`, i)
		if c := put("k9", strings.TrimSuffix(bs, ",")); c != 204 {
			t.Fatalf("stoppat %d: %d", i, c)
		}
	}
	if c := put("k9", bs+`{"n":4,"blocked":true}`); c != 403 {
		t.Fatalf("fjärde stoppade: %d", c)
	}
	// PATCH som tömmer versionerna nekas också.
	if w := do(h, child, "PATCH", "/api/store/tasks/k1", `{"versions":[]}`); w.Code != 403 {
		t.Fatalf("PATCH tömmer: %d", w.Code)
	}
	// Veckogränsen: k1 + två till med feedback, den fjärde nekas.
	put("k2", "")
	put("k2", v(1))
	put("k3", "")
	put("k3", v(1))
	put("k4", "")
	if w := do(h, child, "PUT", "/api/store/tasks/k4", `{"profileId":"p1","versions":[`+v(1)+`]}`); w.Code != 403 || !strings.Contains(w.Body.String(), "veckan") {
		t.Fatalf("veckogränsen: %d %s", w.Code, w.Body)
	}
	// Barnet kan inte flytta sin egen firstAt.
	do(h, child, "PATCH", "/api/store/tasks/k1", `{"firstAt":0}`)
	if b := do(h, child, "GET", "/api/store/tasks/k1", "").Body.String(); strings.Contains(b, `"firstAt":0`) {
		t.Fatalf("firstAt ändrad: %s", b)
	}
	// Att redigera en gammal uppgift räknar inte in den igen; efter åtta dagar går det.
	real := a.st.now
	a.st.now = func() time.Time { return real().Add(8 * 24 * time.Hour) }
	for _, k := range []string{"k1", "k2", "k3"} { // med updated_at hade alla tre räknats igen
		do(h, child, "PATCH", "/api/store/tasks/"+k, `{"title":"ändrad"}`)
	}
	if w := do(h, child, "PUT", "/api/store/tasks/k4", `{"profileId":"p1","versions":[`+v(1)+`]}`); w.Code != 204 {
		t.Fatalf("ny vecka: %d %s", w.Code, w.Body)
	}
	// Påhittad feedback (null eller inte ett objekt) nekas.
	put("k5", "")
	for _, fb := range []string{`null`, `"bra"`, `{}`, `{"x":null}`, `{"strength":""}`} {
		if c := put("k5", `{"n":1,"feedback":`+fb+`}`); c != 400 {
			t.Errorf("feedback %s: %d", fb, c)
		}
	}
}

// Föräldern på arbetsdatorn: barnläge (bara testprofilen) tills PIN, sedan förälder.
func TestDeviceScopedTestAccount(t *testing.T) {
	a, h := testServer(t)
	a.setUsers([]User{
		{ID: "mamma", Login: "forälder@github", Role: "parent", Devices: []string{"nTELEFON"}},
		{ID: "test", Login: "forälder@github", Role: "parent", PINRequired: true, Devices: []string{"nSERVER"}}, // 1.1.1.2 = arbetsdatorn
		{ID: "barn1", Login: "barn@github", Role: "child"},
		{ID: "barn2", Login: "barn2@github", Role: "child"},
	})
	pc := seedFamily(t, h)
	doC(h, parent, "PUT", "/api/store/profiles/pt", `{"name":"Test","grade":5,"account":"test"}`, pc)
	ws := "1.1.1.2:1"
	if b := do(h, ws, "GET", "/api/auth", "").Body.String(); !strings.Contains(b, `"canUnlock":true`) || !strings.Contains(b, `"role":"child"`) {
		t.Fatalf("status låst: %s", b)
	}
	if got := ids(t, do(h, ws, "GET", "/api/store/profiles?list=1", "").Body.String()); got != "pt" {
		t.Fatalf("arbetsdatorn låst ser: %q", got)
	}
	for _, p := range []string{"profiles/p1", "tests/t1", "tests/t2/attempts?list=1"} {
		if w := do(h, ws, "GET", "/api/store/"+p, ""); w.Code != 403 {
			t.Errorf("arbetsdatorn låst läser %s: %d", p, w.Code)
		}
	}
	// Telefonens upplåsta kaka gäller inte arbetsdatorns barnläge förrän den själv låst upp.
	// (Kakan är knuten till kontot, så samma kaka låser upp; det är samma förälder.)
	if w := do(h, ws, "POST", "/api/auth/unlock", `{"pin":"0000"}`); strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatal("fel PIN låste upp")
	}
	w := do(h, ws, "POST", "/api/auth/unlock", `{"pin":"1234"}`)
	var wc *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			wc = c
		}
	}
	if wc == nil {
		t.Fatalf("PIN på arbetsdatorn: %s", w.Body)
	}
	if got := ids(t, doC(h, ws, "GET", "/api/store/profiles?list=1", "", wc).Body.String()); got != "p1,p2,p3,pt" {
		t.Fatalf("arbetsdatorn upplåst ser: %q", got)
	}
	if w := doC(h, ws, "PUT", "/api/store/tests/t1/goals/gx", `{}`, wc); w.Code != 204 {
		t.Fatalf("arbetsdatorn upplåst skriver: %d", w.Code)
	}
	doC(h, ws, "POST", "/api/auth/lock", "", wc)
	if got := ids(t, doC(h, ws, "GET", "/api/store/profiles?list=1", "", wc).Body.String()); got != "pt" {
		t.Fatalf("efter låsning: %q", got)
	}
	// Telefonen är fortfarande förälder, och testkontot syns som kopplingsbart konto.
	if b := doC(h, parent, "GET", "/api/auth", "", unlock(t, h)).Body.String(); !strings.Contains(b, `"id":"test"`) {
		t.Errorf("konton: %s", b)
	}
}

func TestConfigSharedLogin(t *testing.T) {
	write := func(js string) string {
		p := filepath.Join(t.TempDir(), "c.json")
		os.WriteFile(p, []byte(js), 0o600)
		return p
	}
	ok := `{"users":[{"id":"a","login":"x@g","role":"parent","devices":["n1"]},{"id":"b","login":"x@g","role":"child","devices":["n2"]}]}`
	if _, err := loadConfig(write(ok)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		`{"users":[{"id":"a","login":"x@g","role":"parent"},{"id":"b","login":"x@g","role":"child","devices":["n2"]}]}`,
		`{"users":[{"id":"a","login":"x@g","role":"parent","devices":["n1"]},{"id":"b","login":"x@g","role":"child","devices":["n1"]}]}`,
		`{"users":[{"id":"a","login":"x@g","role":"parent","devices":["n1"]},{"id":"a","login":"y@g","role":"child"}]}`,
	} {
		if _, err := loadConfig(write(bad)); err == nil {
			t.Errorf("borde nekas: %s", bad)
		}
	}
}
