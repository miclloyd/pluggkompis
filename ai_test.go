package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeAnthropic svarar med reply (eller status) och sparar senaste anropet.
type fakeAnthropic struct {
	mu     sync.Mutex
	reply  string
	status int
	last   map[string]any
	key    string
	calls  int
}

func (f *fakeAnthropic) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.key = r.Header.Get("x-api-key")
	b, _ := io.ReadAll(r.Body)
	json.Unmarshal(b, &f.last)
	if f.status != 0 {
		w.WriteHeader(f.status)
		w.Write([]byte(`{"type":"error","error":{"type":"overloaded_error","message":"x"}}`))
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"content":     []map[string]string{{"type": "text", "text": f.reply}},
		"stop_reason": "end_turn",
		"usage":       map[string]int{"input_tokens": 100, "output_tokens": 20},
	})
}

func aiServer(t *testing.T, limits Limits) (*server, http.Handler, *fakeAnthropic, *http.Cookie) {
	t.Helper()
	a, h := testServer(t)
	fake := &fakeAnthropic{reply: "Hej!"}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	ai, err := newAI(a.st, "sk-test", Models{}, limits)
	if err != nil {
		t.Fatal(err)
	}
	ai.url = srv.URL
	a.ai = ai
	pc := seedFamily(t, h)
	return a, h, fake, pc
}

func aiCall(h http.Handler, from string, c *http.Cookie, req map[string]any, images ...[]byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	b, _ := json.Marshal(req)
	mw.WriteField("request", string(b))
	for _, im := range images {
		fw, _ := mw.CreateFormFile("images", "sida.jpg")
		fw.Write(im)
	}
	mw.Close()
	r := httptest.NewRequest("POST", "/api/ai", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	r.RemoteAddr = from
	if c != nil {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func code(w *httptest.ResponseRecorder) string {
	var d struct{ Code string }
	json.Unmarshal(w.Body.Bytes(), &d)
	return d.Code
}

func TestAIChildLimit(t *testing.T) {
	a, h, fake, _ := aiServer(t, Limits{ChildPerDay: 2, PerTest: 5})
	req := map[string]any{"prompt": "Förklara", "tier": "quick", "purpose": "child", "profileId": "p1"}
	for i := 0; i < 2; i++ {
		w := aiCall(h, child, nil, req)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"text":"Hej!"`) {
			t.Fatalf("anrop %d: %d %s", i, w.Code, w.Body)
		}
	}
	if mt, _ := fake.last["max_tokens"].(float64); mt != childMaxTokens {
		t.Fatalf("barnets max_tokens: %v", fake.last["max_tokens"])
	}
	if fake.key != "sk-test" || fake.last["model"] != defaultModels.Quick {
		t.Fatalf("nyckel %q modell %v", fake.key, fake.last["model"])
	}
	w := aiCall(h, child, nil, req)
	if w.Code != 429 || code(w) != "limit_reached" || fake.calls != 2 {
		t.Fatalf("taket: %d %s (anrop till Anthropic: %d)", w.Code, w.Body, fake.calls)
	}
	// Syskonet har egen hink.
	if w := aiCall(h, child2, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p2"}); w.Code != 200 {
		t.Fatalf("syskon: %d %s", w.Code, w.Body)
	}
	// Ny dag (svensk tid) = nytt tak.
	a.ai.now = func() time.Time { return time.Now().Add(24 * time.Hour) }
	if w := aiCall(h, child, nil, req); w.Code != 200 {
		t.Fatalf("nästa dag: %d", w.Code)
	}
}

func TestAIScopeChecks(t *testing.T) {
	_, h, fake, pc := aiServer(t, Limits{})
	for name, tc := range map[string]struct {
		from string
		c    *http.Cookie
		req  map[string]any
		want int
	}{
		"barn, syskonets profil":     {child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p2"}, 403},
		"barn, bygga prov":           {child, nil, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1"}, 403},
		"låst förälder, bygga":       {parent, nil, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1"}, 403},
		"upplåst förälder, bygga":    {parent, pc, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1", "tier": "complex"}, 200},
		"bygga prov som saknas":      {parent, pc, map[string]any{"prompt": "x", "purpose": "build", "testId": "t9"}, 400},
		"låst förälder, barnets":     {parent, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p2"}, 200},
		"utan syfte":                 {parent, pc, map[string]any{"prompt": "x"}, 400},
		"okänd nivå":                 {child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p1", "tier": "opus"}, 400},
		"samtal som slutar med AI":   {child, nil, map[string]any{"prompt": []map[string]string{{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}}, "purpose": "child", "profileId": "p1"}, 400},
		"samtal som börjar med AI":   {child, nil, map[string]any{"prompt": []map[string]string{{"role": "assistant", "content": "a"}, {"role": "user", "content": "b"}}, "purpose": "child", "profileId": "p1"}, 400},
		"samtal user/assistant/user": {child, nil, map[string]any{"prompt": []map[string]string{{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "user", "content": "c"}}, "purpose": "child", "profileId": "p1"}, 200},
	} {
		if w := aiCall(h, tc.from, tc.c, tc.req); w.Code != tc.want {
			t.Errorf("%s: %d, väntade %d (%s)", name, w.Code, tc.want, w.Body)
		}
	}
	if fake.last["model"] != defaultModels.Quick && fake.last["model"] != defaultModels.Default {
		t.Errorf("modell: %v", fake.last["model"])
	}
}

func TestAIBuildLimit(t *testing.T) {
	_, h, _, pc := aiServer(t, Limits{PerTest: 1})
	req := map[string]any{"prompt": "x", "purpose": "build", "testId": "t1"}
	aiCall(h, parent, pc, req)
	w := aiCall(h, parent, pc, req)
	if w.Code != 429 || !strings.Contains(w.Body.String(), "1 AI-anrop") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestAIJSON(t *testing.T) {
	_, h, fake, _ := aiServer(t, Limits{})
	req := map[string]any{"prompt": "x", "json": true, "purpose": "child", "profileId": "p1"}
	for _, reply := range []string{`{"met":[true]}`, "```json\n{\"met\":[true]}\n```", "Här är svaret: {\"met\":[true]} klart"} {
		fake.reply = reply
		w := aiCall(h, child, nil, req)
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"json":{"met":[true]}}` {
			t.Errorf("%q: %d %s", reply, w.Code, w.Body)
		}
	}
	if fake.last["system"] != jsonSystem {
		t.Errorf("system: %v", fake.last["system"])
	}
	fake.reply = "inget json här"
	if w := aiCall(h, child, nil, req); w.Code != 502 || code(w) != "invalid_json" {
		t.Errorf("trasigt: %d %s", w.Code, w.Body)
	}
}

func TestAIImagesAndErrors(t *testing.T) {
	_, h, fake, pc := aiServer(t, Limits{})
	jpeg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 64)...)
	req := map[string]any{"prompt": "Tolka sidan", "purpose": "build", "testId": "t1"}
	if w := aiCall(h, parent, pc, req, jpeg, jpeg); w.Code != 200 {
		t.Fatalf("bilder: %d %s", w.Code, w.Body)
	}
	msgs := fake.last["messages"].([]any)
	blocks := msgs[0].(map[string]any)["content"].([]any)
	if len(blocks) != 3 || blocks[0].(map[string]any)["type"] != "image" || blocks[2].(map[string]any)["text"] != "Tolka sidan" {
		t.Fatalf("block: %v", blocks)
	}
	if w := aiCall(h, parent, pc, req, []byte("<html>")); w.Code != 400 || code(w) != "image_rejected" {
		t.Errorf("html som bild: %d %s", w.Code, w.Body)
	}
	if w := aiCall(h, parent, pc, req, jpeg, jpeg, jpeg, jpeg, jpeg); code(w) != "image_rejected" {
		t.Errorf("för många bilder: %d %s", w.Code, w.Body)
	}
	fake.status = 529
	if w := aiCall(h, parent, pc, req); w.Code != 429 || code(w) != "rate_limited" {
		t.Errorf("överbelastad: %d %s", w.Code, w.Body)
	}
}

// Loggen har tokens och status, aldrig prompt eller svar.
func TestAILogHasNoContent(t *testing.T) {
	a, h, _, _ := aiServer(t, Limits{})
	aiCall(h, child, nil, map[string]any{"prompt": "HEMLIG-TEXT", "purpose": "child", "profileId": "p1"})
	rows, err := a.st.db.Query(`SELECT * FROM ai_log`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	n := 0
	for rows.Next() {
		n++
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		rows.Scan(ptrs...)
		for _, v := range vals {
			if s, ok := v.(string); ok && strings.Contains(s, "HEMLIG") {
				t.Fatal("prompten hamnade i loggen")
			}
		}
	}
	if n != 1 {
		t.Fatalf("%d rader", n)
	}
}

func TestConfigWithAI(t *testing.T) {
	_, h, _, _ := aiServer(t, Limits{})
	w := do(h, child, "GET", "/api/config", "")
	if !strings.Contains(w.Body.String(), `"ai":true`) || !strings.Contains(w.Body.String(), `"images":true`) {
		t.Fatal(w.Body)
	}
}

func TestAIChildNoImages(t *testing.T) {
	_, h, fake, _ := aiServer(t, Limits{})
	jpeg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 64)...)
	w := aiCall(h, child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p1"}, jpeg)
	if w.Code != 400 || fake.calls != 0 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// Taket håller även när många anrop kommer samtidigt.
func TestAILimitConcurrent(t *testing.T) {
	_, h, fake, _ := aiServer(t, Limits{ChildPerDay: 5})
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			aiCall(h, child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p1"})
		}()
	}
	wg.Wait()
	if fake.calls != 5 {
		t.Fatalf("%d anrop till Anthropic, taket är 5", fake.calls)
	}
}

func TestUsage(t *testing.T) {
	_, h, _, pc := aiServer(t, Limits{ChildPerDay: 1})
	aiCall(h, child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p1"})
	aiCall(h, child, nil, map[string]any{"prompt": "x", "purpose": "child", "profileId": "p1"}) // taket
	aiCall(h, parent, pc, map[string]any{"prompt": "x", "purpose": "build", "testId": "t1"})
	if w := do(h, parent, "GET", "/api/usage", ""); w.Code != 403 {
		t.Fatalf("låst förälder: %d", w.Code)
	}
	if w := do(h, child, "GET", "/api/usage", ""); w.Code != 403 {
		t.Fatalf("barn: %d", w.Code)
	}
	w := doC(h, parent, "GET", "/api/usage", "", pc)
	var u struct {
		Rows []usageRow
	}
	json.Unmarshal(w.Body.Bytes(), &u)
	if len(u.Rows) != 2 {
		t.Fatalf("%s", w.Body)
	}
	for _, r := range u.Rows {
		switch r.Kind {
		case "child":
			if r.ProfileID != "p1" || r.Calls != 1 || r.Limited != 1 || r.In != 100 {
				t.Errorf("barn: %+v", r)
			}
		case "build":
			if r.TestID != "t1" || r.Calls != 1 {
				t.Errorf("prov: %+v", r)
			}
		}
	}
}

// En hink med bara takstopp (inga anrop till Anthropic) ger nollor, inte fel.
func TestUsageOnlyLimited(t *testing.T) {
	a, h, _, pc := aiServer(t, Limits{})
	a.ai.logCall("child:p1:2026-11-11", "quick", "", "limit", 0, 0)
	w := doC(h, parent, "GET", "/api/usage", "", pc)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"calls":0`) || !strings.Contains(w.Body.String(), `"limited":1`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// Strömning: Anthropics SSE blir NDJSON till klienten, och tokens loggas.
func TestAIStream(t *testing.T) {
	a, h, _, _ := aiServer(t, Limits{})
	var got map[string]any
	sse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&got)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, ev := range []string{
			`{"type":"message_start","message":{"usage":{"input_tokens":42}}}`,
			`{"type":"content_block_delta","delta":{"type":"text_delta","text":"Zakat "}}`,
			`{"type":"content_block_delta","delta":{"type":"text_delta","text":"är allmosan."}}`,
			`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`,
			`{"type":"message_stop"}`,
		} {
			fmt.Fprintf(w, "event: x\ndata: %s\n\n", ev)
		}
	}))
	defer sse.Close()
	a.ai.url = sse.URL
	w := aiCall(h, child, nil, map[string]any{"prompt": "Förklara", "tier": "quick", "stream": true, "purpose": "child", "profileId": "p1"})
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	want := `{"t":"Zakat "}` + "\n" + `{"t":"är allmosan."}` + "\n" + `{"done":true,"truncated":false}` + "\n"
	if w.Body.String() != want {
		t.Fatalf("ström:\n%s", w.Body)
	}
	if got["stream"] != true {
		t.Fatalf("anropet till Anthropic: %v", got)
	}
	var in, out int
	a.st.db.QueryRow(`SELECT input_tokens, output_tokens FROM ai_log ORDER BY ts DESC LIMIT 1`).Scan(&in, &out)
	if in != 42 || out != 7 {
		t.Fatalf("tokens %d/%d", in, out)
	}
	// JSON-anrop strömmas aldrig.
	a.ai.url = sse.URL
	w = aiCall(h, child, nil, map[string]any{"prompt": "x", "json": true, "stream": true, "purpose": "child", "profileId": "p1"})
	if w.Header().Get("Content-Type") == "application/x-ndjson" {
		t.Fatal("JSON-svar strömmades")
	}
}

// Strömmen bryts eller ger ett fel: klienten får en error-rad, inte done.
func TestAIStreamErrors(t *testing.T) {
	a, h, _, _ := aiServer(t, Limits{ChildPerDay: 2})
	events := [][]string{
		{`{"type":"content_block_delta","delta":{"type":"text_delta","text":"Halv "}}`}, // ingen message_stop
		{`{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}`, `{"type":"error","error":{"type":"overloaded_error"}}`, `{"type":"message_stop"}`},
	}
	n := 0
	sse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n >= len(events) {
			http.Error(w, "oväntat anrop", 500)
			return
		}
		for _, ev := range events[n] {
			fmt.Fprintf(w, "data: %s\n\n", ev)
		}
		n++
	}))
	defer sse.Close()
	a.ai.url = sse.URL
	req := map[string]any{"prompt": "x", "tier": "quick", "stream": true, "purpose": "child", "profileId": "p1"}
	for i := 0; i < 2; i++ {
		b := aiCall(h, child, nil, req).Body.String()
		if !strings.Contains(b, `"error"`) || strings.Contains(b, `"done"`) {
			t.Fatalf("fall %d: %s", i, b)
		}
	}
	// Taket räknas även för strömmade (och avbrutna) anrop.
	if w := aiCall(h, child, nil, req); w.Code != 429 {
		t.Fatalf("taket med stream: %d %s", w.Code, w.Body)
	}
	// Båda avbrotten (utan message_stop och med error-event) loggas som fel.
	var n2 int
	a.st.db.QueryRow(`SELECT COUNT(*) FROM ai_log WHERE status = 'upstream_error'`).Scan(&n2)
	if n2 != 2 {
		t.Fatalf("loggade fel: %d", n2)
	}
}
