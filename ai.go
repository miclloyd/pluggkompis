package main

// /api/ai: appens AI-anrop går via servern, som har nyckeln (sops →
// LoadCredential) och håller taken (plan 1.6):
//
//   child  allt barnet startar (rättning, Förklara mer, Lär ut det):
//          högst limits.childPerDay anrop per profil och dygn (svensk tid)
//   build  det föräldern startar när ett prov byggs (tolka material, mål,
//          frågor): högst limits.perTest anrop per prov, totalt
//
// Anropet räknas innan det görs, så även misslyckade anrop räknas. Loggen
// (ai_log) sparar bara antal tokens, aldrig prompt eller svar.

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
	_ "time/tzdata"
)

type Models struct {
	Quick   string `json:"quick"`
	Default string `json:"default"`
	Complex string `json:"complex"`
}

type Limits struct {
	ChildPerDay int `json:"childPerDay"`
	PerTest     int `json:"perTest"`
}

var (
	defaultModels = Models{Quick: "claude-haiku-5-5", Default: "claude-sonnet-5-5", Complex: "claude-sonnet-5-5"}
	defaultLimits = Limits{ChildPerDay: 150, PerTest: 300}
	stockholm, _  = time.LoadLocation("Europe/Stockholm")
)

const (
	maxPromptBytes      = 200000
	maxChildPromptBytes = 40000 // rättning, Förklara mer, Lär ut det (frågan + sidans text)
	childMaxTokens      = 2000
	maxImages           = 4
	maxImageBytes       = 5 << 20
	anthropicURL        = "https://api.anthropic.com/v1/messages"
)

type AI struct {
	key    string
	url    string
	models Models
	limits Limits
	client *http.Client
	db     *sql.DB
	now    func() time.Time
	prices *pricer
}

func newAI(st *Store, key string, models Models, limits Limits) (*AI, error) {
	if models.Quick == "" {
		models.Quick = defaultModels.Quick
	}
	if models.Default == "" {
		models.Default = defaultModels.Default
	}
	if models.Complex == "" {
		models.Complex = defaultModels.Complex
	}
	if limits.ChildPerDay <= 0 {
		limits.ChildPerDay = defaultLimits.ChildPerDay
	}
	if limits.PerTest <= 0 {
		limits.PerTest = defaultLimits.PerTest
	}
	_, err := st.db.Exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  bucket TEXT PRIMARY KEY,   -- child:<profil>:<datum> eller build:<prov>
  n      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_log (
  ts            INTEGER NOT NULL,
  bucket        TEXT NOT NULL,
  tier          TEXT NOT NULL,
  model         TEXT NOT NULL,
  status        TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);`)
	if err == nil {
		// detail kom till i 0.14.2: lägg till kolumnen i befintliga databaser.
		var n int
		st.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('ai_log') WHERE name = 'detail'`).Scan(&n)
		if n == 0 {
			_, err = st.db.Exec(`ALTER TABLE ai_log ADD COLUMN detail TEXT NOT NULL DEFAULT ''`)
		}
	}
	if err == nil {
		// Kostnad per anrop i dollar kom till i 0.16.0. NULL = okänd (modell utan pris).
		// Kolumnerna kontrolleras var för sig, så att en avbruten migrering blir klar nästa gång.
		for _, col := range []string{"cost_in", "cost_out"} {
			var n int
			if err = st.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('ai_log') WHERE name = ?`, col).Scan(&n); err != nil {
				break
			}
			if n == 0 {
				if _, err = st.db.Exec(`ALTER TABLE ai_log ADD COLUMN ` + col + ` REAL`); err != nil {
					break
				}
			}
		}
	}
	if err != nil {
		return nil, err
	}
	a := &AI{
		key: key, url: anthropicURL, models: models, limits: limits,
		client: &http.Client{Timeout: 5 * time.Minute},
		db:     st.db, now: st.now,
	}
	used := []string{models.Quick}
	for _, m := range []string{models.Default, models.Complex} {
		if m != used[len(used)-1] && m != used[0] {
			used = append(used, m)
		}
	}
	if a.prices, err = newPricer(st.db, st.now, used); err != nil {
		return nil, err
	}
	return a, a.prices.backfill()
}

// reserve räknar upp hinken om taket inte är nått, i en enda sats (samtidiga
// anrop kan inte smita förbi).
func (a *AI) reserve(ctx context.Context, bucket string, limit int) (bool, error) {
	res, err := a.db.ExecContext(ctx, `INSERT INTO ai_usage (bucket, n) VALUES (?, 1)
ON CONFLICT(bucket) DO UPDATE SET n = n + 1 WHERE n < ?`, bucket, limit)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (a *AI) logCall(bucket, tier, model, status string, in, out int, detail ...string) {
	d := ""
	if len(detail) > 0 {
		d = detail[0]
	}
	var ci, co any // NULL när modellen saknar pris
	if in == 0 && out == 0 {
		ci, co = 0.0, 0.0
	} else if a.prices != nil {
		if x, y, ok := a.prices.cost(model, in, out); ok {
			ci, co = x, y
		}
	}
	_, err := a.db.Exec(`INSERT INTO ai_log (ts, bucket, tier, model, status, input_tokens, output_tokens, detail, cost_in, cost_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.now().UnixMilli(), bucket, tier, model, status, in, out, d, ci, co)
	if err != nil {
		log.Printf("ai_log: %v", err)
	}
}

// ── anropet till Anthropic ───────────────────────────────────────────────────

type aiError struct {
	status int
	code   string // samma koder som artifactens AiError
	msg    string
	detail string // Anthropics eget felmeddelande (förkortat): bara i loggen och föräldraläget
}

func (e *aiError) Error() string { return e.code + ": " + e.msg }

type message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type image struct {
	typ  string
	data []byte
}

// parsePrompt: en sträng, eller [{role, content}] som börjar och slutar med user.
func parsePrompt(raw json.RawMessage) ([]message, error) {
	if len(raw) > maxPromptBytes {
		return nil, &aiError{413, "prompt_too_large", "Materialet är för stort för ett anrop. Dela upp det i färre filer.", ""}
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if strings.TrimSpace(s) == "" {
			return nil, &aiError{400, "invalid_request", "tom prompt", ""}
		}
		return []message{{Role: "user", Content: s}}, nil
	}
	var turns []struct{ Role, Content string }
	if err := json.Unmarshal(raw, &turns); err != nil || len(turns) == 0 || len(turns) > 60 {
		return nil, &aiError{400, "invalid_request", "ogiltig prompt", ""}
	}
	msgs := make([]message, 0, len(turns))
	for i, t := range turns {
		want := "user"
		if i%2 == 1 {
			want = "assistant"
		}
		if t.Role != want || strings.TrimSpace(t.Content) == "" {
			return nil, &aiError{400, "invalid_request", "samtalet måste växla user/assistant och börja med user", ""}
		}
		msgs = append(msgs, message{Role: t.Role, Content: t.Content})
	}
	if msgs[len(msgs)-1].Role != "user" {
		return nil, &aiError{400, "invalid_request", "samtalet måste sluta med user", ""}
	}
	return msgs, nil
}

const jsonSystem = "Svara enbart med ett giltigt JSON-objekt, utan förklarande text och utan kodblock."

func (a *AI) complete(ctx context.Context, tier string, msgs []message, images []image, wantJSON bool, maxTokens int) (text string, truncated bool, in, out int, err error) {
	model := map[string]string{"quick": a.models.Quick, "default": a.models.Default, "complex": a.models.Complex}[tier]
	if len(images) > 0 {
		last := msgs[len(msgs)-1]
		var blocks []any
		for _, im := range images {
			blocks = append(blocks, map[string]any{"type": "image", "source": map[string]string{
				"type": "base64", "media_type": im.typ, "data": base64.StdEncoding.EncodeToString(im.data),
			}})
		}
		blocks = append(blocks, map[string]string{"type": "text", "text": last.Content.(string)})
		msgs[len(msgs)-1] = message{Role: "user", Content: blocks}
	}
	body := map[string]any{"model": model, "max_tokens": maxTokens, "messages": msgs}
	if wantJSON {
		body["system"] = jsonSystem
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, a.url, bytes.NewReader(b))
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", a.key)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := a.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", false, 0, 0, &aiError{499, "cancelled", "Avbrutet.", ""}
		}
		return "", false, 0, 0, &aiError{502, "upstream_error", "Claude svarade inte. Försök igen om en stund.", ""}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	var r struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			In  int `json:"input_tokens"`
			Out int `json:"output_tokens"`
		} `json:"usage"`
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(raw, &r)
	if resp.StatusCode != http.StatusOK {
		// Aldrig prompten i loggen, bara felets typ.
		e := anthropicError(resp.StatusCode, r.Error.Type, r.Error.Message)
		log.Printf("anthropic: %s → %s", e.detail, e.code)
		return "", false, 0, 0, e
	}
	var sb strings.Builder
	for _, c := range r.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	text = sb.String()
	if r.StopReason == "refusal" {
		return "", false, r.Usage.In, r.Usage.Out, &aiError{422, "refused", "Claude ville inte behandla det här materialet.", ""}
	}
	if strings.TrimSpace(text) == "" {
		return "", false, r.Usage.In, r.Usage.Out, &aiError{502, "empty_completion", "Claude gav inget svar. Försök igen.", ""}
	}
	return text, r.StopReason == "max_tokens", r.Usage.In, r.Usage.Out, nil
}

// anthropicError: Anthropics fel (status, typ, meddelande) som ett begripligt fel. Koden
// sparas i ai_log (status) och syns för föräldern under AI-användning; Anthropics eget
// meddelande skickas aldrig vidare (det kan innehålla detaljer om kontot).
func anthropicError(status int, typ, message string) *aiError {
	e := anthropicErrorCode(status, typ, message)
	d := strings.TrimSpace(fmt.Sprintf("%d %s: %s", status, typ, message))
	if r := []rune(d); len(r) > 200 {
		d = string(r[:200]) + "…"
	}
	e.detail = d
	return e
}

func anthropicErrorCode(status int, typ, message string) *aiError {
	m := strings.ToLower(message)
	switch {
	case status == 401 || typ == "authentication_error":
		return &aiError{502, "auth", "AI-nyckeln godtas inte av Anthropic. En förälder behöver kontrollera nyckeln.", ""}
	case status == 403 || typ == "permission_error":
		return &aiError{502, "permission", "AI-nyckeln saknar behörighet (workspace eller modell). En förälder behöver kontrollera den.", ""}
	case status == 404 || typ == "not_found_error":
		return &aiError{502, "model_not_found", "AI-modellen finns inte för den här nyckeln. En förälder behöver kontrollera inställningen.", ""}
	case strings.Contains(m, "credit balance"):
		return &aiError{502, "no_credits", "Kontot hos Anthropic saknar krediter. En förälder behöver fylla på i Console.", ""}
	case strings.Contains(m, "spend") || strings.Contains(m, "usage limit") || strings.Contains(m, "limit reached"):
		return &aiError{429, "spend_limit", "Utgiftstaket hos Anthropic är nått. En förälder kan höja det i Console.", ""}
	case status == 429 || status == 529 || typ == "overloaded_error" || typ == "rate_limit_error":
		return &aiError{429, "rate_limited", "Claude har mycket att göra just nu. Vänta en stund och försök igen.", ""}
	case status == 413 || typ == "request_too_large" || (status == 400 && strings.Contains(m, "too long")):
		return &aiError{413, "prompt_too_large", "Materialet är för stort för ett anrop. Dela upp det i färre filer.", ""}
	case status == 400 && strings.Contains(m, "image"):
		return &aiError{400, "image_rejected", "En sidbild kunde inte skickas. Prova att ladda upp filen igen.", ""}
	case status == 400:
		return &aiError{502, "invalid_request", "Anthropic avvisade anropet. Försök igen; händer det igen, säg till en förälder.", ""}
	}
	return &aiError{502, "upstream_error", "Något gick fel hos Claude. Försök igen om en stund.", ""}
}

// extractJSON: modellen ska svara med bara JSON, men tål kodblock och text runt.
func extractJSON(text string) (json.RawMessage, bool) {
	t := strings.TrimSpace(text)
	t = strings.TrimPrefix(t, "```json")
	t = strings.TrimPrefix(t, "```")
	t = strings.TrimSuffix(strings.TrimSpace(t), "```")
	if json.Valid([]byte(t)) && strings.HasPrefix(strings.TrimSpace(t), "{") {
		return json.RawMessage(strings.TrimSpace(t)), true
	}
	i, j := strings.IndexByte(t, '{'), strings.LastIndexByte(t, '}')
	if i >= 0 && j > i && json.Valid([]byte(t[i:j+1])) {
		return json.RawMessage(t[i : j+1]), true
	}
	return nil, false
}

// ── handlern ─────────────────────────────────────────────────────────────────

type aiRequest struct {
	Prompt    json.RawMessage `json:"prompt"`
	Tier      string          `json:"tier"`
	JSON      bool            `json:"json"`
	Stream    bool            `json:"stream"`  // text i bitar (NDJSON), som artifactens onText
	Purpose   string          `json:"purpose"` // child | build | task
	TaskID    string          `json:"taskId"`
	TestID    string          `json:"testId"`
	ProfileID string          `json:"profileId"`
}

func aiFail(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"code": code, "message": msg})
}

// bucket: vilken hink anropet räknas mot, efter behörighetskontroll.
func (s *server) aiBucket(r *http.Request, q aiRequest) (bucket string, limit int, err *aiError) {
	ctx := r.Context()
	switch q.Purpose {
	case "build":
		if !s.parentMode(r) {
			return "", 0, &aiError{403, "not_granted", errLocked.Error(), ""}
		}
		if _, _, _, e := docPath("tests/" + q.TestID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "provet saknas", ""}
		}
		if _, e := s.st.Get(ctx, "tests/"+q.TestID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "provet saknas", ""}
		}
		return "build:" + q.TestID, s.ai.limits.PerTest, nil
	case "child":
		if _, _, _, e := docPath("profiles/" + q.ProfileID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "profilen saknas", ""}
		}
		if e := s.canRead(r, "profiles/"+q.ProfileID); e != nil {
			return "", 0, &aiError{403, "not_granted", "Den här profilen är inte din.", ""}
		}
		if _, e := s.st.Get(ctx, "profiles/"+q.ProfileID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "profilen saknas", ""}
		}
		day := s.ai.now().In(stockholm).Format("2006-01-02")
		return "child:" + q.ProfileID + ":" + day, s.ai.limits.ChildPerDay, nil
	case "task":
		// Handskrift från foto (skoluppgift): bara upplåst föräldraläge, som provbygget.
		if !s.parentMode(r) {
			return "", 0, &aiError{403, "not_granted", errLocked.Error(), ""}
		}
		if _, _, _, e := docPath("tasks/" + q.TaskID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "uppgiften saknas", ""}
		}
		if _, e := s.st.Get(ctx, "tasks/"+q.TaskID); e != nil {
			return "", 0, &aiError{400, "invalid_request", "uppgiften saknas", ""}
		}
		return "task:" + q.TaskID, maxTaskReads, nil
	}
	return "", 0, &aiError{400, "invalid_request", "okänt syfte", ""}
}

// Avläsningar av handskrift per skoluppgift (föräldern kan läsa om ett foto några gånger).
const maxTaskReads = 10

func (s *server) aiHandler(w http.ResponseWriter, r *http.Request) {
	if s.ai == nil {
		aiFail(w, 503, "sampling_disabled", "AI är inte påslaget på servern.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPromptBytes+maxImages*maxImageBytes+(1<<20))
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		aiFail(w, 413, "prompt_too_large", "Anropet är för stort.")
		return
	}
	defer r.MultipartForm.RemoveAll()
	var q aiRequest
	if err := json.Unmarshal([]byte(r.FormValue("request")), &q); err != nil {
		aiFail(w, 400, "invalid_request", "ogiltigt anrop")
		return
	}
	if q.Tier == "" {
		q.Tier = "default"
	}
	if q.Tier != "quick" && q.Tier != "default" && q.Tier != "complex" {
		aiFail(w, 400, "invalid_request", "okänd nivå")
		return
	}
	msgs, err := parsePrompt(q.Prompt)
	if err != nil {
		e := err.(*aiError)
		aiFail(w, e.status, e.code, e.msg)
		return
	}
	images, ierr := readImages(r.MultipartForm.File["images"])
	if ierr != nil {
		aiFail(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	bucket, limit, berr := s.aiBucket(r, q)
	if berr != nil {
		aiFail(w, berr.status, berr.code, berr.msg)
		return
	}
	// Barnets anrop: bara de nivåer appen använder där, ingen bild, kortare
	// prompt och svar — så att /api/ai inte blir en fri chattbot på nyckeln.
	maxTokens := 16000
	if q.Purpose == "child" {
		if q.Tier == "complex" || len(images) > 0 || len(q.Prompt) > maxChildPromptBytes {
			aiFail(w, 400, "invalid_request", "Det här anropet går inte att göra när man övar.")
			return
		}
		maxTokens = childMaxTokens
	} else if q.Tier == "quick" {
		maxTokens = 4000
	}
	ok, dberr := s.ai.reserve(r.Context(), bucket, limit)
	if dberr != nil {
		storeError(w, dberr)
		return
	}
	if !ok {
		msg := "Dagens AI-hjälp är slut. Du kan fortsätta öva och rätta själv med facit – i morgon hjälper Pluggkompis till igen."
		if q.Purpose == "build" {
			msg = fmt.Sprintf("Provet har använt sina %d AI-anrop. Hör av dig om taket behöver höjas.", limit)
		}
		s.ai.logCall(bucket, q.Tier, "", "limit", 0, 0)
		aiFail(w, 429, "limit_reached", msg)
		return
	}
	model := map[string]string{"quick": s.ai.models.Quick, "default": s.ai.models.Default, "complex": s.ai.models.Complex}[q.Tier]
	if q.Stream && !q.JSON && len(images) == 0 {
		s.ai.stream(w, r.Context(), bucket, q.Tier, model, msgs, maxTokens)
		return
	}
	text, truncated, in, out, cerr := s.ai.complete(r.Context(), q.Tier, msgs, images, q.JSON, maxTokens)
	if cerr != nil {
		e := cerr.(*aiError)
		s.ai.logCall(bucket, q.Tier, model, e.code, in, out, e.detail)
		aiFail(w, e.status, e.code, e.msg)
		return
	}
	if q.JSON {
		js, ok := extractJSON(text)
		if !ok {
			s.ai.logCall(bucket, q.Tier, model, "invalid_json", in, out)
			aiFail(w, 502, "invalid_json", "Svaret gick inte att läsa. Försök igen.")
			return
		}
		s.ai.logCall(bucket, q.Tier, model, "ok", in, out)
		writeJSON(w, 200, map[string]json.RawMessage{"json": js})
		return
	}
	s.ai.logCall(bucket, q.Tier, model, "ok", in, out)
	writeJSON(w, 200, map[string]any{"text": text, "truncated": truncated})
}

var imageTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true}

func readImages(files []*multipart.FileHeader) ([]image, *aiError) {
	if len(files) > maxImages {
		return nil, &aiError{400, "image_rejected", fmt.Sprintf("Högst %d bilder per anrop.", maxImages), ""}
	}
	var out []image
	for _, fh := range files {
		if fh.Size > maxImageBytes {
			return nil, &aiError{413, "image_rejected", "En sidbild är för stor.", ""}
		}
		f, err := fh.Open()
		if err != nil {
			return nil, &aiError{400, "image_rejected", "En sidbild kunde inte läsas.", ""}
		}
		data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
		f.Close()
		if err != nil || len(data) > maxImageBytes {
			return nil, &aiError{400, "image_rejected", "En sidbild kunde inte läsas.", ""}
		}
		typ := http.DetectContentType(data)
		if !imageTypes[typ] {
			return nil, &aiError{400, "image_rejected", "En sidbild har ett format som inte stöds.", ""}
		}
		out = append(out, image{typ: typ, data: data})
	}
	return out, nil
}

// ── /api/usage: förbrukningen för föräldraläget ──────────────────────────────

type usageRow struct {
	Kind      string  `json:"kind"` // child | build | task
	ProfileID string  `json:"profileId,omitempty"`
	TestID    string  `json:"testId,omitempty"`
	TaskID    string  `json:"taskId,omitempty"`
	Date      string  `json:"date,omitempty"` // svensk dag (bara child)
	Calls     int     `json:"calls"`          // anrop till Anthropic
	Failed    int     `json:"failed"`         // varav fel
	Limited   int     `json:"limited"`        // stoppade av taket
	In        int     `json:"inputTokens"`
	Out       int     `json:"outputTokens"`
	CostIn    float64 `json:"costIn"`   // dollar
	CostOut   float64 `json:"costOut"`  // dollar
	Unpriced  int     `json:"unpriced"` // anrop utan känt pris
}

// usage: de senaste 30 dagarna, per barn och dag och per prov.
func (s *server) usage(w http.ResponseWriter, r *http.Request) {
	if !s.parentMode(r) {
		accessError(w, errLocked)
		return
	}
	if s.ai == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	since := s.ai.now().Add(-30 * 24 * time.Hour).UnixMilli()
	rows, err := s.ai.db.QueryContext(r.Context(), `SELECT bucket,
  COALESCE(SUM(status <> 'limit'), 0), COALESCE(SUM(status NOT IN ('ok', 'limit')), 0), COALESCE(SUM(status = 'limit'), 0),
  COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
  COALESCE(SUM(cost_in), 0), COALESCE(SUM(cost_out), 0), COALESCE(SUM(cost_in IS NULL), 0)
FROM ai_log WHERE ts >= ? GROUP BY bucket ORDER BY bucket`, since)
	if err != nil {
		storeError(w, err)
		return
	}
	defer rows.Close()
	out := []usageRow{}
	for rows.Next() {
		var b string
		var u usageRow
		if err := rows.Scan(&b, &u.Calls, &u.Failed, &u.Limited, &u.In, &u.Out, &u.CostIn, &u.CostOut, &u.Unpriced); err != nil {
			storeError(w, err)
			return
		}
		parts := strings.Split(b, ":")
		switch {
		case parts[0] == "child" && len(parts) == 3:
			u.Kind, u.ProfileID, u.Date = "child", parts[1], parts[2]
		case parts[0] == "build" && len(parts) == 2:
			u.Kind, u.TestID = "build", parts[1]
		case parts[0] == "task" && len(parts) == 2:
			u.Kind, u.TaskID = "task", parts[1]
		default:
			continue
		}
		out = append(out, u)
	}
	// Senaste felen (bara status och tid, aldrig innehåll): visar orsaken när AI inte fungerar.
	type errRow struct {
		Ts     int64  `json:"ts"`
		Status string `json:"status"`
		Tier   string `json:"tier"`
		Model  string `json:"model"`
		Detail string `json:"detail"`
	}
	recent := []errRow{}
	if er, err := s.ai.db.QueryContext(r.Context(), `SELECT ts, status, tier, model, detail FROM ai_log WHERE status NOT IN ('ok', 'limit') ORDER BY ts DESC LIMIT 5`); err == nil {
		for er.Next() {
			var x errRow
			if er.Scan(&x.Ts, &x.Status, &x.Tier, &x.Model, &x.Detail) == nil {
				recent = append(recent, x)
			}
		}
		er.Close()
	}
	// Summor per period och modell (dollar): i dag, denna månad och 30 dagar.
	type costRow struct {
		Period   string  `json:"period"`
		Model    string  `json:"model"`
		In       int     `json:"inputTokens"`
		Out      int     `json:"outputTokens"`
		CostIn   float64 `json:"costIn"`
		CostOut  float64 `json:"costOut"`
		Unpriced int     `json:"unpriced"`
	}
	now := s.ai.now().In(stockholm)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, stockholm).UnixMilli()
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, stockholm).UnixMilli()
	totals := []costRow{}
	for _, per := range []struct {
		name string
		from int64
	}{{"today", day}, {"month", month}, {"30d", since}} {
		cr, err := s.ai.db.QueryContext(r.Context(), `SELECT model, COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
  COALESCE(SUM(cost_in), 0), COALESCE(SUM(cost_out), 0), COALESCE(SUM(cost_in IS NULL), 0)
FROM ai_log WHERE ts >= ? AND model <> '' GROUP BY model ORDER BY model`, per.from)
		if err != nil {
			storeError(w, err)
			return
		}
		for cr.Next() {
			x := costRow{Period: per.name}
			if cr.Scan(&x.Model, &x.In, &x.Out, &x.CostIn, &x.CostOut, &x.Unpriced) == nil {
				totals = append(totals, x)
			}
		}
		cr.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": true,
		"totals":  totals,
		"pricing": s.ai.prices.info(),
		"errors":  recent,
		"today":   s.ai.now().In(stockholm).Format("2006-01-02"),
		"limits":  s.ai.limits,
		"models":  s.ai.models,
		"rows":    out,
	})
}

// ── strömning (Förklara mer) ─────────────────────────────────────────────────

// stream skickar svaret till klienten som NDJSON medan modellen skriver:
// {"t":"bit"} … och sist {"done":true,"truncated":false} eller {"error":{…}}.
// Felet efter att strömmen börjat kan inte bli en HTTP-status, därav error-raden.
func (a *AI) stream(w http.ResponseWriter, ctx context.Context, bucket, tier, model string, msgs []message, maxTokens int) {
	body, _ := json.Marshal(map[string]any{"model": model, "max_tokens": maxTokens, "messages": msgs, "stream": true})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, a.url, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", a.key)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := a.client.Do(req)
	if err != nil {
		a.logCall(bucket, tier, model, "upstream_error", 0, 0)
		aiFail(w, 502, "upstream_error", "Claude svarade inte. Försök igen om en stund.")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var er struct {
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		json.Unmarshal(raw, &er)
		e := anthropicError(resp.StatusCode, er.Error.Type, er.Error.Message)
		log.Printf("anthropic (ström): %s → %s", e.detail, e.code)
		a.logCall(bucket, tier, model, e.code, 0, 0, e.detail)
		aiFail(w, e.status, e.code, e.msg)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	enc := json.NewEncoder(w)
	var in, out int
	stop, status, finished := "", "ok", false
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
			Message struct {
				Usage struct {
					In int `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				Out int `json:"output_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(strings.TrimSpace(line[5:])), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "message_start":
			in = ev.Message.Usage.In
		case "content_block_delta":
			if ev.Delta.Type == "text_delta" && ev.Delta.Text != "" {
				enc.Encode(map[string]string{"t": ev.Delta.Text})
				if flusher != nil {
					flusher.Flush()
				}
			}
		case "message_delta":
			stop, out = ev.Delta.StopReason, ev.Usage.Out
		case "message_stop":
			finished = true
		case "error":
			status = "upstream_error"
		}
	}
	// Utan message_stop är svaret halvt (avbruten anslutning): ett fel, inte ett färdigt svar.
	// Taket räknades redan när anropet reserverades, så ett avbrott kringgår det inte.
	if err := sc.Err(); err != nil || status != "ok" || !finished {
		if ctx.Err() != nil {
			status = "cancelled"
		} else {
			status = "upstream_error"
		}
		enc.Encode(map[string]any{"error": map[string]string{"code": status, "message": "Svaret avbröts. Försök igen."}})
	} else {
		enc.Encode(map[string]any{"done": true, "truncated": stop == "max_tokens"})
	}
	a.logCall(bucket, tier, model, status, in, out)
}

// refreshPrices: föräldern hämtar priser och växelkurs nu i stället för att vänta en vecka.
// Högst en gång per tio minuter, annars skickas de sparade värdena.
func (s *server) refreshPrices(w http.ResponseWriter, r *http.Request) {
	if !s.parentMode(r) {
		accessError(w, errLocked)
		return
	}
	if s.ai == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	p := s.ai.prices
	p.mu.Lock()
	recent := p.now().Sub(p.checked) < 10*time.Minute
	p.mu.Unlock()
	if p.Enabled && !recent {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		// Förälderns knapptryck bekräftar också ett stort prishopp (force).
		_ = p.refresh(ctx, true) // felet syns i info(); errBusy ger de sparade värdena
	}
	writeJSON(w, http.StatusOK, p.info())
}
