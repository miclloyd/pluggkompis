// Notis till föräldern när ett barn flaggar en fråga eller en rättning (ntfy).
//
// Notisen säger bara vem och vilket ämne ("<namn> flaggade en fråga i <ämne>"): inga svar
// eller frågor på låsskärmen. Detaljerna finns i föräldraläget under Flaggat.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type notifier struct {
	url    string // t.ex. http://127.0.0.1:8011/monitoring
	header string // "Authorization: Basic …" (fil från ntfy-modulen)
	client *http.Client

	mu   sync.Mutex
	sent map[string]int // "profil|dag" → antal notiser
}

// Högst så många notiser per barn och dag; fler flaggor sparas ändå och syns i föräldraläget.
const maxFlagNotices = 10

// allow räknar en notis för barnet i dag och säger om den får skickas.
func (n *notifier) allow(profileID string, now time.Time) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sent == nil {
		n.sent = map[string]int{}
	}
	day := now.In(stockholm).Format("2006-01-02")
	for k := range n.sent {
		if !strings.HasSuffix(k, "|"+day) {
			delete(n.sent, k) // gårdagens räknare
		}
	}
	k := profileID + "|" + day
	n.sent[k]++
	return n.sent[k] <= maxFlagNotices
}

func newNotifier(url, headerFile string) (*notifier, error) {
	if url == "" {
		return nil, nil
	}
	n := &notifier{url: url, client: &http.Client{Timeout: 10 * time.Second}}
	if headerFile != "" {
		b, err := os.ReadFile(headerFile)
		if err != nil {
			return nil, err
		}
		n.header = strings.TrimSpace(string(b))
	}
	return n, nil
}

func (n *notifier) send(title, msg string) {
	if n == nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, n.url, strings.NewReader(msg))
	if err != nil {
		log.Printf("notis: %v", err)
		return
	}
	req.Header.Set("Title", title)
	req.Header.Set("Tags", "triangular_flag_on_post")
	if k, v, ok := strings.Cut(n.header, ":"); ok {
		req.Header.Set(strings.TrimSpace(k), strings.TrimSpace(v))
	}
	resp, err := n.client.Do(req)
	if err != nil {
		log.Printf("notis: %v", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Printf("notis: ntfy svarade %d", resp.StatusCode)
	}
}

// flagCreated: en ny flagga (tests/{id}/flags/{fid}) → notis med barnets namn och ämnet.
func (s *server) flagCreated(ctx context.Context, testID string, body []byte) {
	if s.notify == nil {
		return
	}
	var f struct {
		Kind string `json:"kind"` // grading | question
	}
	_ = json.Unmarshal(body, &f)
	var t struct {
		Subject   string `json:"subject"`
		ProfileID string `json:"profileId"`
	}
	if raw, err := s.st.Get(ctx, "tests/"+testID); err == nil {
		_ = json.Unmarshal(raw, &t)
	}
	// Namnet från provets ägare, inte från flaggan (som barnets klient skriver).
	pid := t.ProfileID
	if !s.notify.allow(pid, time.Now()) {
		return
	}
	name := "Ett barn"
	if raw, err := s.st.Get(ctx, "profiles/"+pid); err == nil {
		var p struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(raw, &p) == nil && p.Name != "" {
			name = p.Name
		}
	}
	what := map[string]string{"grading": "en rättning", "question": "en fråga"}[f.Kind]
	if what == "" {
		what = "något"
	}
	subject := t.Subject
	if subject == "" {
		subject = "ett prov"
	}
	var msg bytes.Buffer
	msg.WriteString(name + " flaggade " + what + " i " + subject + ". Se Flaggat i föräldraläget.")
	go s.notify.send("Pluggkompis", msg.String())
}
