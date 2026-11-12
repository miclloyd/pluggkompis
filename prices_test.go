package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-12 }

func TestParsePricing(t *testing.T) {
	b, err := os.ReadFile("testdata/pricing.md")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parsePricing(string(b))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]Price{
		"claude-sonnet-5-5": {In: 2, Out: 10},
		"claude-haiku-5-5":  {In: 0.10, Out: 0.50, LongOver: 100000, LongIn: 0.50, LongOut: 2.50},
		"claude-opus-5-5":   {In: 4, Out: 20},
		"claude-mythos-5-2": {In: 8, Out: 40}, // namn med länk i parentes
	}
	for m, w := range want {
		if p[m] != w {
			t.Errorf("%s: %+v, vill ha %+v", m, p[m], w)
		}
	}
	// De inbyggda priserna stämmer med sidan de är hämtade från.
	for m, d := range defaultPrices {
		if p[m] != d {
			t.Errorf("inbyggt pris för %s (%+v) skiljer sig från sidan (%+v)", m, d, p[m])
		}
	}
}

func TestParsePricingRejectsChangedPage(t *testing.T) {
	b, _ := os.ReadFile("testdata/pricing.md")
	for name, md := range map[string]string{
		"rubrik":      strings.Replace(string(b), "Base input tokens", "Input", 1),
		"belopp":      strings.Replace(string(b), "$2 / MTok", "2 dollar", 1),
		"orimligt":    strings.Replace(string(b), "$10 / MTok             |\n| Claude Sonnet 5 ", "$9999 / MTok             |\n| Claude Sonnet 5 ", 1),
		"utan tabell": "# Pricing\n\nNothing here.",
	} {
		if _, err := parsePricing(md); err == nil {
			t.Errorf("%s: borde ge fel", name)
		}
	}
}

func TestParseECB(t *testing.T) {
	b, _ := os.ReadFile("testdata/ecb.xml")
	v, at, err := parseECB(b)
	if err != nil || v < 5 || v > 20 || at.IsZero() {
		t.Fatalf("%v %v %v", v, at, err)
	}
	if _, _, err := parseECB([]byte(`<x/>`)); err == nil {
		t.Error("trasig XML borde ge fel")
	}
}

func TestPriceCostLongPrompt(t *testing.T) {
	h := defaultPrices["claude-haiku-5-5"]
	ci, co := h.cost(100000, 1000)
	if !near(ci, 0.01) || !near(co, 0.0005) {
		t.Errorf("kort: %v %v", ci, co)
	}
	ci, co = h.cost(100001, 1000)
	if !near(ci, 100001*0.5/1e6) || !near(co, 0.0025) {
		t.Errorf("lång: %v %v", ci, co)
	}
}

type fixedSource struct {
	body   []byte
	status int
}

func (f *fixedSource) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	w.Write(f.body)
}

func TestPriceRefresh(t *testing.T) {
	a, h, _, pc := aiServer(t, Limits{})
	page, _ := os.ReadFile("testdata/pricing.md")
	ecb, _ := os.ReadFile("testdata/ecb.xml")
	ps := &fixedSource{body: []byte(strings.Replace(string(page), "| Claude Sonnet 5.5                                                                                                                                                      | $2 / MTok ", "| Claude Sonnet 5.5                                                                                                                                                      | $3 / MTok ", 1))}
	fs := &fixedSource{body: ecb}
	s1, s2 := httptest.NewServer(ps), httptest.NewServer(fs)
	defer s1.Close()
	defer s2.Close()
	p := a.ai.prices
	p.pricesURL, p.fxURL = s1.URL, s2.URL
	p.Enabled = true

	if err := p.refresh(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if _, ok := p.prices["claude-sonnet-5-5"]; !ok || p.prices["claude-sonnet-5-5"].In != 3 {
		t.Fatalf("nytt pris: %+v", p.prices)
	}
	if len(p.changes) != 1 || !strings.Contains(p.changes[0].What, "input $2 → $3") {
		t.Fatalf("ändring: %+v", p.changes)
	}
	if p.sek == defaultSEK && p.sekAt.Equal(defaultSEKAt) {
		t.Error("växelkursen uppdaterades inte")
	}

	// Trasig prissida: gamla priser kvar, felet syns, kursen uppdateras ändå.
	ps.status = 500
	if err := p.refresh(context.Background(), false); err == nil || !strings.Contains(p.lastErr, "priser") {
		t.Fatalf("fel: %v / %q", err, p.lastErr)
	}
	if p.prices["claude-sonnet-5-5"].In != 3 {
		t.Error("priset ska ligga kvar")
	}

	// En modell som appen använder saknas på sidan: inga priser ändras.
	ps.status, ps.body = 0, []byte(strings.Replace(string(page), "Claude Haiku 5.5", "Claude Haiku 9.9", -1))
	if err := p.refresh(context.Background(), false); err == nil || !strings.Contains(p.lastErr, "claude-haiku-5-5 saknas") {
		t.Fatalf("saknad modell: %v / %q", err, p.lastErr)
	}

	// Priserna överlever omstart.
	p2, err := newPricer(a.st.db, a.st.now, p.models)
	if err != nil || p2.prices["claude-sonnet-5-5"].In != 3 || len(p2.changes) != 1 || p2.lastErr == "" {
		t.Fatalf("efter omstart: %+v %v", p2, err)
	}

	// Föräldern kan be om uppdatering; barnet och låst förälder kan inte.
	if w := do(h, child, "POST", "/api/usage/prices", ""); w.Code != 403 {
		t.Errorf("barn: %d", w.Code)
	}
	if w := do(h, parent, "POST", "/api/usage/prices", ""); w.Code != 403 {
		t.Errorf("låst förälder: %d", w.Code)
	}
	if w := doC(h, parent, "POST", "/api/usage/prices", "", pc); w.Code != 200 || !strings.Contains(w.Body.String(), `"sek"`) {
		t.Errorf("förälder: %d %s", w.Code, w.Body)
	}
}

func TestUsageCost(t *testing.T) {
	a, h, _, pc := aiServer(t, Limits{})
	// Ett gammalt anrop utan kostnad (före 0.16.0) får en vid start.
	a.ai.db.Exec(`INSERT INTO ai_log (ts, bucket, tier, model, status, input_tokens, output_tokens) VALUES (?, 'build:t0', 'default', 'claude-sonnet-5-5', 'ok', 1000000, 100000)`, a.ai.now().UnixMilli())
	if err := a.ai.prices.backfill(); err != nil {
		t.Fatal(err)
	}
	aiCall(h, parent, pc, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1"}) // default = Sonnet, 100 in / 20 ut
	aiCall(h, parent, pc, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1", "tier": "quick"})
	a.ai.db.Exec(`INSERT INTO ai_log (ts, bucket, tier, model, status, input_tokens, output_tokens) VALUES (?, 'build:t1', 'default', 'claude-okand-1', 'ok', 10, 10)`, a.ai.now().UnixMilli())
	a.ai.logCall("build:t1", "default", "claude-okand-1", "ok", 10, 10)

	w := doC(h, parent, "GET", "/api/usage", "", pc)
	var u struct {
		Rows   []usageRow
		Totals []struct {
			Period, Model   string
			CostIn, CostOut float64
			Unpriced        int
		}
		Pricing struct {
			Sek    float64
			Prices map[string]Price
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &u); err != nil {
		t.Fatal(err)
	}
	var t0, t1 usageRow
	for _, r := range u.Rows {
		switch r.TestID {
		case "t0":
			t0 = r
		case "t1":
			t1 = r
		}
	}
	if !near(t0.CostIn, 2) || !near(t0.CostOut, 1) {
		t.Errorf("efterhand: %+v", t0)
	}
	wantIn := 100*2/1e6 + 100*0.1/1e6
	wantOut := 20*10/1e6 + 20*0.5/1e6
	if !near(t1.CostIn, wantIn) || !near(t1.CostOut, wantOut) || t1.Unpriced != 2 {
		t.Errorf("t1: %+v (vill ha %v / %v)", t1, wantIn, wantOut)
	}
	seen := map[string]bool{}
	for _, x := range u.Totals {
		seen[x.Period+"/"+x.Model] = true
		if x.Model == "claude-okand-1" && x.Unpriced != 2 {
			t.Errorf("okänd modell: %+v", x)
		}
	}
	for _, k := range []string{"today/claude-sonnet-5-5", "month/claude-haiku-5-5", "30d/claude-sonnet-5-5"} {
		if !seen[k] {
			t.Errorf("saknar %s i %+v", k, u.Totals)
		}
	}
	if u.Pricing.Sek != defaultSEK || u.Pricing.Prices["claude-haiku-5-5"].In != 0.10 {
		t.Errorf("prisinfo: %+v", u.Pricing)
	}
}

// Utan nät eller med -dev: priser finns ändå (inbyggda), och run gör inget förrän en vecka gått.
func TestPricerDefaults(t *testing.T) {
	a, _ := testServer(t)
	p, err := newPricer(a.st.db, func() time.Time { return time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC) }, []string{"claude-haiku-5-5"})
	if err != nil || p.prices["claude-haiku-5-5"].In != 0.10 || p.sek != defaultSEK {
		t.Fatalf("%+v %v", p, err)
	}
}

func TestParsePricingOnlyFirstTable(t *testing.T) {
	b, _ := os.ReadFile("testdata/pricing.md")
	md := string(b)
	// En senare tabell (till exempel batchpriser) med samma kolumner får inte läsas.
	batch := "\n\n### Batch\n\n| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |\n| :- | :- | :- | :- | :- | :- |\n| Claude Sonnet 5.5 | $1 / MTok | $1 / MTok | $1 / MTok | $1 / MTok | $5 / MTok |\n"
	i := strings.Index(md, "*<sup>1")
	p, err := parsePricing(md[:i] + batch + md[i:])
	if err != nil || p["claude-sonnet-5-5"].In != 2 {
		t.Fatalf("%v %+v", err, p["claude-sonnet-5-5"])
	}
	// Samma modell två gånger i tabellen med olika pris: fel.
	dup := strings.Replace(md, "| Claude Haiku 4.5 ", "| Claude Sonnet 5.5 ", 1)
	if _, err := parsePricing(dup); err == nil || !strings.Contains(err.Error(), "två olika priser") {
		t.Fatalf("dubblett: %v", err)
	}
}

func TestPriceJumpNeedsConfirmation(t *testing.T) {
	a, h, _, pc := aiServer(t, Limits{})
	page, _ := os.ReadFile("testdata/pricing.md")
	ecb, _ := os.ReadFile("testdata/ecb.xml")
	ps := &fixedSource{body: []byte(strings.Replace(string(page), "| $2 / MTok             | $2.50 / MTok", "| $20 / MTok             | $2.50 / MTok", 1))}
	s1, s2 := httptest.NewServer(ps), httptest.NewServer(&fixedSource{body: ecb})
	defer s1.Close()
	defer s2.Close()
	p := a.ai.prices
	p.pricesURL, p.fxURL = s1.URL, s2.URL
	// Den automatiska hämtningen stoppar tiodubblingen.
	if err := p.refresh(context.Background(), false); err == nil || !strings.Contains(p.lastErr, "mer än 3 gånger") || p.prices["claude-sonnet-5-5"].In != 2 {
		t.Fatalf("hopp: %v %q %+v", err, p.lastErr, p.prices["claude-sonnet-5-5"])
	}
	// Med -dev utan flagga hämtar knappen ingenting, inte heller när spärren inte gäller.
	p.checked = p.now().Add(-11 * time.Minute)
	if w := doC(h, parent, "POST", "/api/usage/prices", "", pc); w.Code != 200 || p.prices["claude-sonnet-5-5"].In != 2 {
		t.Fatalf("avstängd: %d %+v", w.Code, p.prices["claude-sonnet-5-5"])
	}
	// Förälderns knapptryck bekräftar direkt: ett väntande prishopp går förbi tiominutersspärren.
	p.Enabled = true
	p.checked = p.now()
	if w := doC(h, parent, "POST", "/api/usage/prices", "", pc); w.Code != 200 || p.prices["claude-sonnet-5-5"].In != 20 {
		t.Fatalf("bekräftat: %d %+v", w.Code, p.prices["claude-sonnet-5-5"])
	}
	// Pågår redan en hämtning: ingen ny.
	p.busy = true
	if err := p.refresh(context.Background(), false); err != errBusy {
		t.Fatalf("pågår: %v", err)
	}
	p.busy = false
}

func TestCheckRedirect(t *testing.T) {
	req := func(u string) *http.Request { r, _ := http.NewRequest("GET", u, nil); return r }
	first := []*http.Request{req("https://platform.claude.com/a")}
	if err := checkRedirect(req("https://platform.claude.com/b"), first); err != nil {
		t.Errorf("samma värd: %v", err)
	}
	if err := checkRedirect(req("https://example.org/b"), first); err == nil || !strings.Contains(err.Error(), "annan värd") {
		t.Errorf("annan värd: %v", err)
	}
	if err := checkRedirect(req("http://platform.claude.com/b"), first); err == nil || !strings.Contains(err.Error(), "https") {
		t.Errorf("http: %v", err)
	}
	three := []*http.Request{first[0], first[0], first[0]}
	if err := checkRedirect(req("https://platform.claude.com/b"), three); err == nil || !strings.Contains(err.Error(), "för många") {
		t.Errorf("tak: %v", err)
	}
}

func TestPricerRedirect(t *testing.T) {
	other := httptest.NewServer(&fixedSource{body: []byte("x")})
	defer other.Close()
	red := httptest.NewServer(http.RedirectHandler(other.URL, http.StatusFound))
	defer red.Close()
	a, _ := testServer(t)
	p, _ := newPricer(a.st.db, time.Now, []string{"claude-haiku-5-5"})
	if _, err := p.get(context.Background(), red.URL); err == nil {
		t.Fatal("omdirigering till annan värd ska stoppas")
	}
}
