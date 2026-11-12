package main

// Kostnaden för AI-anropen. Priserna (dollar per miljon tokens) läses från Anthropics prissida
// och växelkursen (kronor per dollar) från ECB:s dagliga referenskurser, en gång i veckan.
// Går hämtningen inte att lita på behålls de gamla värdena och felet visas för föräldern.
// Varje anrop får sin kostnad när det loggas, med de priser som gällde då.

import (
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	pricesURL     = "https://platform.claude.com/docs/en/about-claude/pricing.md"
	fxURL         = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
	priceInterval = 7 * 24 * time.Hour
	fetchMaxBytes = 2 << 20
)

// Price är dollar per miljon tokens. Över LongOver input-tokens gäller LongIn/LongOut
// (Haiku 5.5 är dyrare för långa prompter).
type Price struct {
	In       float64 `json:"in"`
	Out      float64 `json:"out"`
	LongOver int     `json:"longOver,omitempty"`
	LongIn   float64 `json:"longIn,omitempty"`
	LongOut  float64 `json:"longOut,omitempty"`
}

// Inbyggda värden från prissidan och ECB 2026-11-11/12, tills första hämtningen lyckats.
var (
	defaultPrices = map[string]Price{
		"claude-sonnet-5-5": {In: 2, Out: 10},
		"claude-haiku-5-5":  {In: 0.10, Out: 0.50, LongOver: 100000, LongIn: 0.50, LongOut: 2.50},
	}
	defaultPricesAt = time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	defaultSEK      = 9.93 // 11.0510 SEK / 1.1127 USD per euro
	defaultSEKAt    = time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
)

// cost i dollar, uppdelat på input och output. ok = false om modellen saknar pris.
func (p Price) cost(in, out int) (float64, float64) {
	pi, po := p.In, p.Out
	if p.LongOver > 0 && in > p.LongOver {
		pi, po = p.LongIn, p.LongOut
	}
	return float64(in) * pi / 1e6, float64(out) * po / 1e6
}

type pricer struct {
	mu        sync.Mutex
	db        *sql.DB
	now       func() time.Time
	client    *http.Client
	pricesURL string
	fxURL     string
	models    []string // modellerna appen använder: de måste finnas på prissidan

	prices   map[string]Price
	pricesAt time.Time // när priserna senast hämtades (eller de inbyggdas datum)
	sek      float64
	sekAt    time.Time // ECB:s datum för kursen
	checked  time.Time // senaste försöket
	lastErr  string
	busy     bool // en hämtning pågår
	Enabled  bool // false: ingen hämtning alls (lokal utveckling utan -price-refresh)
	changes  []priceChange
}

type priceChange struct {
	Ts    int64  `json:"ts"`
	Model string `json:"model"`
	What  string `json:"what"`
}

func newPricer(db *sql.DB, now func() time.Time, models []string) (*pricer, error) {
	client := &http.Client{Timeout: 30 * time.Second,
		// Omdirigeringar bara till https på samma värd.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Host != via[0].URL.Host {
				return errors.New("omdirigering till annan värd")
			}
			return nil
		}}
	p := &pricer{db: db, now: now, client: client,
		pricesURL: pricesURL, fxURL: fxURL, models: models}
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS ai_prices (
  model TEXT PRIMARY KEY,
  price TEXT NOT NULL          -- Price som JSON
);
CREATE TABLE IF NOT EXISTS ai_price_meta (
  key   TEXT PRIMARY KEY,      -- pricesAt | sek | sekAt | checked | lastErr
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_price_changes (
  ts    INTEGER NOT NULL,
  model TEXT NOT NULL,
  what  TEXT NOT NULL
);`)
	if err != nil {
		return nil, err
	}
	return p, p.load()
}

func (p *pricer) load() error {
	p.prices = map[string]Price{}
	rows, err := p.db.Query(`SELECT model, price FROM ai_prices`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var m, js string
		var pr Price
		if rows.Scan(&m, &js) == nil && jsonUnmarshal(js, &pr) == nil {
			p.prices[m] = pr
		}
	}
	rows.Close()
	meta := map[string]string{}
	mr, err := p.db.Query(`SELECT key, value FROM ai_price_meta`)
	if err != nil {
		return err
	}
	for mr.Next() {
		var k, v string
		if mr.Scan(&k, &v) == nil {
			meta[k] = v
		}
	}
	mr.Close()
	if len(p.prices) == 0 {
		for m, pr := range defaultPrices {
			p.prices[m] = pr
		}
		p.pricesAt = defaultPricesAt
	} else {
		p.pricesAt = parseTime(meta["pricesAt"])
	}
	p.sek, p.sekAt = defaultSEK, defaultSEKAt
	if v, err := strconv.ParseFloat(meta["sek"], 64); err == nil && v > 0 {
		p.sek, p.sekAt = v, parseTime(meta["sekAt"])
	}
	p.checked = parseTime(meta["checked"])
	p.lastErr = meta["lastErr"]
	cr, err := p.db.Query(`SELECT ts, model, what FROM ai_price_changes ORDER BY ts DESC LIMIT 10`)
	if err != nil {
		return err
	}
	defer cr.Close()
	for cr.Next() {
		var c priceChange
		if cr.Scan(&c.Ts, &c.Model, &c.What) == nil {
			p.changes = append(p.changes, c)
		}
	}
	return nil
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// cost för ett anrop i dollar. known = false när modellen saknar pris.
func (p *pricer) cost(model string, in, out int) (ci, co float64, known bool) {
	p.mu.Lock()
	pr, ok := p.prices[model]
	p.mu.Unlock()
	if !ok {
		return 0, 0, false
	}
	ci, co = pr.cost(in, out)
	return ci, co, true
}

// run kontrollerar varje timme om det gått en vecka sedan senaste försöket, eller sex
// timmar om det försöket misslyckades.
func (p *pricer) run(ctx context.Context) {
	for {
		p.mu.Lock()
		wait := priceInterval
		if p.lastErr != "" {
			wait = 6 * time.Hour
		}
		due := p.now().Sub(p.checked) >= wait
		p.mu.Unlock()
		if due {
			if err := p.refresh(ctx, false); err != nil {
				log.Printf("priser: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

var errBusy = errors.New("en hämtning pågår redan")

// maxJump: ett pris som ändras mer än så (upp eller ner) tas inte in automatiskt. Föräldern
// bekräftar med Uppdatera nu (force) efter att ha kontrollerat Anthropics prissida.
const maxJump = 3.0

func jumped(a, b float64) bool { return a > 0 && b > 0 && (b/a > maxJump || a/b > maxJump) }

// refresh hämtar priser och växelkurs. Delarna sparas var för sig: en trasig prissida
// stoppar inte en ny växelkurs och tvärtom.
func (p *pricer) refresh(ctx context.Context, force bool) error {
	p.mu.Lock()
	if p.busy {
		p.mu.Unlock()
		return errBusy
	}
	p.busy = true
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.busy = false; p.mu.Unlock() }()

	var errs []string
	prices, perr := p.fetchPrices(ctx)
	if perr == nil && !force {
		p.mu.Lock()
		for _, m := range sortedKeys(prices) {
			o, n := p.prices[m], prices[m]
			if jumped(o.In, n.In) || jumped(o.Out, n.Out) || jumped(o.LongIn, n.LongIn) || jumped(o.LongOut, n.LongOut) {
				perr = fmt.Errorf("%s ändras mer än %g gånger (%s); kontrollera Anthropics prissida och tryck Uppdatera nu", m, maxJump, describeChange(o, n))
				break
			}
		}
		p.mu.Unlock()
	}
	if perr != nil {
		errs = append(errs, "priser: "+perr.Error())
	}
	sek, sekAt, ferr := p.fetchFX(ctx)
	if ferr != nil {
		errs = append(errs, "växelkurs: "+ferr.Error())
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	put := func(k, v string) error {
		_, err := tx.Exec(`INSERT INTO ai_price_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v)
		return err
	}
	var changes []priceChange
	if perr == nil {
		for _, m := range sortedKeys(prices) {
			np := prices[m]
			old, had := p.prices[m]
			if had && old != np {
				changes = append(changes, priceChange{Ts: now.UnixMilli(), Model: m, What: describeChange(old, np)})
			}
			js, _ := jsonMarshal(np)
			if _, err := tx.Exec(`INSERT INTO ai_prices (model, price) VALUES (?, ?) ON CONFLICT(model) DO UPDATE SET price = excluded.price`, m, js); err != nil {
				return err
			}
		}
		for _, c := range changes {
			if _, err := tx.Exec(`INSERT INTO ai_price_changes (ts, model, what) VALUES (?, ?, ?)`, c.Ts, c.Model, c.What); err != nil {
				return err
			}
		}
		if err := put("pricesAt", now.UTC().Format(time.RFC3339)); err != nil {
			return err
		}
	}
	if ferr == nil {
		if err := put("sek", strconv.FormatFloat(sek, 'f', 4, 64)); err != nil {
			return err
		}
		if err := put("sekAt", sekAt.UTC().Format(time.RFC3339)); err != nil {
			return err
		}
	}
	lastErr := strings.Join(errs, "; ")
	if err := put("checked", now.UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	if err := put("lastErr", lastErr); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if perr == nil {
		for m, np := range prices {
			p.prices[m] = np
		}
		p.pricesAt = now
		p.changes = append(changes, p.changes...)
		if len(p.changes) > 10 {
			p.changes = p.changes[:10]
		}
	}
	if ferr == nil {
		p.sek, p.sekAt = sek, sekAt
	}
	p.checked, p.lastErr = now, lastErr
	for _, c := range changes {
		log.Printf("priser: %s %s", c.Model, c.What)
	}
	if lastErr != "" {
		return errors.New(lastErr)
	}
	return nil
}

func describeChange(a, b Price) string {
	f := func(x float64) string { return "$" + strconv.FormatFloat(x, 'f', -1, 64) }
	var parts []string
	if a.In != b.In {
		parts = append(parts, "input "+f(a.In)+" → "+f(b.In))
	}
	if a.Out != b.Out {
		parts = append(parts, "output "+f(a.Out)+" → "+f(b.Out))
	}
	if a.LongOver != b.LongOver || a.LongIn != b.LongIn || a.LongOut != b.LongOut {
		parts = append(parts, "pris för långa prompter ändrat")
	}
	return strings.Join(parts, ", ") + " per miljon tokens"
}

func (p *pricer) get(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, errors.New("gick inte att hämta")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("svarade %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, fetchMaxBytes+1))
	if err != nil {
		return nil, errors.New("avbröts")
	}
	if len(b) > fetchMaxBytes {
		return nil, errors.New("för stort svar")
	}
	return b, nil
}

func (p *pricer) fetchPrices(ctx context.Context) (map[string]Price, error) {
	b, err := p.get(ctx, p.pricesURL)
	if err != nil {
		return nil, err
	}
	all, err := parsePricing(string(b))
	if err != nil {
		return nil, err
	}
	out := map[string]Price{}
	for _, m := range p.models {
		pr, ok := all[m]
		if !ok {
			return nil, fmt.Errorf("%s saknas på prissidan", m)
		}
		out[m] = pr
	}
	return out, nil
}

var (
	reSup    = regexp.MustCompile(`<sup>.*?</sup>`)
	reLink   = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	reParen  = regexp.MustCompile(`\s*\(.*\)\s*$`)
	reDollar = regexp.MustCompile(`^\$([0-9]+(?:\.[0-9]+)?)\s*/\s*MTok$`)
	reModel  = regexp.MustCompile(`^Claude ([A-Za-z]+) ([0-9]+(?:\.[0-9]+)?)$`)
	reLong   = regexp.MustCompile(`prompts (up to|over) ([0-9,]+) tokens`)
)

// parsePricing läser tabellen under "## Model pricing": kolumnerna hittas på rubrikerna
// "Model", "Base input tokens" och "Output tokens", inte på sin plats.
func parsePricing(md string) (map[string]Price, error) {
	i := strings.Index(md, "\n## Model pricing")
	if i < 0 {
		return nil, errors.New("tabellen hittades inte")
	}
	sec := md[i+1:]
	if j := strings.Index(sec[3:], "\n## "); j >= 0 {
		sec = sec[:j+3]
	}
	var head []string
	out := map[string]Price{}
	long := map[string]Price{}
	// Bara den första tabellen i avsnittet: senare tabeller (till exempel batchpriser) har
	// andra rubriker och får aldrig läsas med de här.
	for _, line := range strings.Split(sec, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			if head != nil {
				break
			}
			continue
		}
		cells := strings.Split(strings.Trim(line, "|"), "|")
		for k := range cells {
			cells[k] = strings.TrimSpace(reLink.ReplaceAllString(reSup.ReplaceAllString(cells[k], ""), "$1"))
		}
		if head == nil {
			head = cells
			continue
		}
		if strings.HasPrefix(cells[0], ":-") || strings.HasPrefix(cells[0], "--") {
			continue
		}
		col := func(name string) int {
			for k, h := range head {
				if strings.EqualFold(h, name) {
					return k
				}
			}
			return -1
		}
		cm, ci, co := col("Model"), col("Base input tokens"), col("Output tokens")
		if cm < 0 || ci < 0 || co < 0 {
			return nil, errors.New("tabellens rubriker har ändrats")
		}
		if len(cells) != len(head) {
			continue
		}
		name := cells[cm]
		lm := reLong.FindStringSubmatch(name)
		mm := reModel.FindStringSubmatch(reParen.ReplaceAllString(name, ""))
		if mm == nil {
			continue
		}
		id := "claude-" + strings.ToLower(mm[1]) + "-" + strings.ReplaceAll(mm[2], ".", "-")
		in, err1 := dollars(cells[ci])
		outp, err2 := dollars(cells[co])
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("priset för %s gick inte att läsa", id)
		}
		pr := Price{In: in, Out: outp}
		dst := out
		if lm != nil && lm[1] == "over" {
			n, _ := strconv.Atoi(strings.ReplaceAll(lm[2], ",", ""))
			pr.LongOver = n
			dst = long
		}
		// Samma modell två gånger med olika pris: sidan går inte att lita på.
		if prev, dup := dst[id]; dup && prev != pr {
			return nil, fmt.Errorf("%s har två olika priser", id)
		}
		dst[id] = pr
	}
	for id, lp := range long {
		base, ok := out[id]
		if !ok || lp.LongOver <= 0 {
			return nil, fmt.Errorf("%s har bara pris för långa prompter", id)
		}
		base.LongOver, base.LongIn, base.LongOut = lp.LongOver, lp.In, lp.Out
		out[id] = base
	}
	if len(out) == 0 {
		return nil, errors.New("inga priser i tabellen")
	}
	return out, nil
}

func dollars(s string) (float64, error) {
	m := reDollar.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, errors.New("okänt format")
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil || v <= 0 || v > 1000 {
		return 0, errors.New("orimligt pris")
	}
	return v, nil
}

// fetchFX: kronor per dollar ur ECB:s kurser (båda mot euro).
func (p *pricer) fetchFX(ctx context.Context) (float64, time.Time, error) {
	b, err := p.get(ctx, p.fxURL)
	if err != nil {
		return 0, time.Time{}, err
	}
	return parseECB(b)
}

func parseECB(b []byte) (float64, time.Time, error) {
	var doc struct {
		Cube struct {
			Cube []struct {
				Time  string `xml:"time,attr"`
				Rates []struct {
					Currency string  `xml:"currency,attr"`
					Rate     float64 `xml:"rate,attr"`
				} `xml:"Cube"`
			} `xml:"Cube"`
		} `xml:"Cube"`
	}
	if err := xml.Unmarshal(b, &doc); err != nil || len(doc.Cube.Cube) == 0 {
		return 0, time.Time{}, errors.New("gick inte att läsa")
	}
	day := doc.Cube.Cube[0]
	at, err := time.Parse("2006-01-02", day.Time)
	if err != nil {
		return 0, time.Time{}, errors.New("datum saknas")
	}
	var usd, sek float64
	for _, r := range day.Rates {
		switch r.Currency {
		case "USD":
			usd = r.Rate
		case "SEK":
			sek = r.Rate
		}
	}
	if usd <= 0 || sek <= 0 {
		return 0, time.Time{}, errors.New("USD eller SEK saknas")
	}
	v := sek / usd
	if v < 5 || v > 20 || math.IsNaN(v) {
		return 0, time.Time{}, errors.New("orimlig kurs")
	}
	return math.Round(v*10000) / 10000, at, nil
}

// priceInfo till föräldern: priserna, kursen, när de hämtades och om något gick fel.
func (p *pricer) info() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	prices := map[string]Price{}
	for _, m := range p.models {
		if pr, ok := p.prices[m]; ok {
			prices[m] = pr
		}
	}
	ms := func(t time.Time) int64 { // 0 = aldrig
		if t.IsZero() {
			return 0
		}
		return t.UnixMilli()
	}
	return map[string]any{
		"prices":   prices,
		"pricesAt": ms(p.pricesAt),
		"sek":      p.sek,
		"sekAt":    ms(p.sekAt),
		"checked":  ms(p.checked),
		"error":    p.lastErr,
		"changes":  p.changes,
		"source":   "Anthropics prissida och ECB:s referenskurs",
	}
}

func jsonMarshal(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func jsonUnmarshal(s string, v any) error { return json.Unmarshal([]byte(s), v) }

func sortedKeys(m map[string]Price) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// backfill ger gamla anrop utan kostnad en kostnad med dagens priser (en gång, vid start).
func (p *pricer) backfill() error {
	rows, err := p.db.Query(`SELECT rowid, model, input_tokens, output_tokens FROM ai_log WHERE cost_in IS NULL`)
	if err != nil {
		return err
	}
	type upd struct {
		id     int64
		ci, co float64
	}
	var ups []upd
	for rows.Next() {
		var id int64
		var m string
		var in, out int
		if rows.Scan(&id, &m, &in, &out) != nil {
			continue
		}
		if in == 0 && out == 0 {
			ups = append(ups, upd{id, 0, 0})
		} else if ci, co, ok := p.cost(m, in, out); ok {
			ups = append(ups, upd{id, ci, co})
		}
	}
	rows.Close()
	for _, u := range ups {
		if _, err := p.db.Exec(`UPDATE ai_log SET cost_in = ?, cost_out = ? WHERE rowid = ?`, u.ci, u.co, u.id); err != nil {
			return err
		}
	}
	return nil
}
