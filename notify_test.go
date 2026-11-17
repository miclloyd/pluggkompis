package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// En ny flagga från barnet ger en notis med barnets namn och ämnet, men inget av svaret
// eller kommentaren. Samma flagga igen (till exempel förälderns statusändring) ger ingen ny.
func TestFlagNotifies(t *testing.T) {
	var mu sync.Mutex
	var got []string
	var auth []string
	ntfy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Header.Get("Title")+"|"+string(b))
		auth = append(auth, r.Header.Get("Authorization"))
		mu.Unlock()
	}))
	defer ntfy.Close()
	a, h := testServer(t)
	a.notify = &notifier{url: ntfy.URL, header: "Authorization: Basic eDp5", client: ntfy.Client()}
	pc := seedFamily(t, h)

	body := `{"kind":"question","profileId":"p1","itemId":"i1","answer":"HEMLIGT SVAR","comment":"HEMLIG KOMMENTAR","status":"open"}`
	if w := do(h, child, "PUT", "/api/store/tests/t1/flags/f1", body); w.Code != 204 {
		t.Fatalf("barnet får flagga: %d %s", w.Code, w.Body)
	}
	if w := do(h, child, "PUT", "/api/store/tests/t1/flags/f1", body); w.Code != 403 {
		t.Fatalf("barnet får inte ändra en befintlig flagga: %d", w.Code)
	}
	if w := doC(h, parent, "PATCH", "/api/store/tests/t1/flags/f1", `{"status":"ok"}`, pc); w.Code != 204 {
		t.Fatalf("föräldern ändrar status: %d %s", w.Code, w.Body)
	}
	// En ny flagga (nytt id) på samma fråga går alltid, även efter förälderns beslut.
	if w := do(h, child, "PUT", "/api/store/tests/t1/flags/f3", body); w.Code != 204 {
		t.Errorf("barnet flaggar igen: %d", w.Code)
	}
	if w := do(h, child, "PUT", "/api/store/tests/t2/flags/f2", body); w.Code == 204 {
		t.Error("barnet får inte flagga syskonets prov")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n >= 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond) // en eventuell andra notis hinner komma
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 2 {
		t.Fatalf("notiser (f1 och f3, inte förälderns ändring): %q", got)
	}
	if !strings.Contains(got[0], "Ett flaggade en fråga i SO") || strings.Contains(got[0], "HEMLIG") {
		t.Errorf("notisen: %q", got[0])
	}
	if auth[0] != "Basic eDp5" {
		t.Errorf("auth: %q", auth[0])
	}
}

func TestFlagNoticeLimit(t *testing.T) {
	n := &notifier{}
	now := time.Now()
	for i := 0; i < maxFlagNotices; i++ {
		if !n.allow("p1", now) {
			t.Fatalf("notis %d stoppades", i+1)
		}
	}
	if n.allow("p1", now) {
		t.Error("taket släppte igenom en notis till")
	}
	if !n.allow("p2", now) {
		t.Error("taket gäller per barn")
	}
	if !n.allow("p1", now.Add(24*time.Hour)) {
		t.Error("taket gäller per dag")
	}
}

// Granskningens flaggor: "förståelse" (kind review) ger ingen notis, ett fynd ger en egen text.
func TestFlagNoticeReview(t *testing.T) {
	var mu sync.Mutex
	var got []string
	ntfy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, string(b))
		mu.Unlock()
	}))
	defer ntfy.Close()
	a, h := testServer(t)
	a.notify = &notifier{url: ntfy.URL, client: ntfy.Client()}
	seedFamily(t, h)
	do(h, child, "PUT", "/api/store/tests/t1/flags/r1", `{"kind":"review","from":"granskning","status":"ok"}`)
	do(h, child, "PUT", "/api/store/tests/t1/flags/r2", `{"kind":"question","from":"granskning","status":"open"}`)
	deadline := time.Now().Add(3 * time.Second)
	for {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n >= 1 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || !strings.Contains(got[0], "Granskningen hittade en fråga som kan vara fel i SO") {
		t.Errorf("notiser: %q", got)
	}
}

// Granskningens "förståelse" (kind review) skickar ingen notis och räknas inte mot taket.
func TestFlagCreatedReviewSilent(t *testing.T) {
	a, h := testServer(t)
	a.notify = &notifier{url: "http://127.0.0.1:1", client: &http.Client{Timeout: time.Second}} // ingen server: bara räknaren prövas
	seedFamily(t, h)
	a.flagCreated(context.Background(), "t1", []byte(`{"kind":"review","from":"granskning"}`))
	if len(a.notify.sent) != 0 {
		t.Errorf("review räknades som notis: %v", a.notify.sent)
	}
	a.flagCreated(context.Background(), "t1", []byte(`{"kind":"question","from":"granskning"}`))
	if len(a.notify.sent) != 1 {
		t.Errorf("ett fynd ska räknas: %v", a.notify.sent)
	}
}
