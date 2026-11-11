package main

// Föräldraläget och rollerna (plan 1.6, fas 3).
//
// Rollen kommer från Tailscale-kontot (WhoIs + användarlistan): ett barnkonto
// är alltid barn. Ett föräldrakonto övar som barn tills föräldraläget låses
// upp med PIN, så att ett barn kan låna en förälders iPad. PIN:en hashas med
// argon2id här på servern och syns aldrig i webbläsaren; den gamla
// settings/parent i dokumentlagringen används inte på servern.

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	sessionIdle   = 30 * time.Minute // föräldraläget låses efter så lång tid utan anrop
	sessionCookie = "pk_parent"
	maxFailures   = 5 // fel PIN i rad innan spärren
	firstLockout  = 5 * time.Minute
	maxLockout    = time.Hour
)

var pinFormat = regexp.MustCompile(`^[0-9]{4,6}$`)

// argon2id: 3 varv, 64 MiB, 1 tråd (RFC 9106, andra rekommendationen).
func hashPIN(pin string, salt []byte) []byte {
	return argon2.IDKey([]byte(pin), salt, 3, 64*1024, 1, 32)
}

type session struct {
	login string
	until time.Time
}

type failure struct {
	n      int
	until  time.Time     // spärrad till
	period time.Duration // nästa spärrtid
}

type Auth struct {
	db  *sql.DB
	now func() time.Time

	mu       sync.Mutex
	hashMu   sync.Mutex // en argon2-hash åt gången (minnet)
	sessions map[string]session
	failures map[string]*failure
}

func newAuth(st *Store) (*Auth, error) {
	_, err := st.db.Exec(`CREATE TABLE IF NOT EXISTS pin (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  hash       BLOB NOT NULL,
  salt       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
)`)
	return &Auth{db: st.db, now: st.now, sessions: map[string]session{}, failures: map[string]*failure{}}, err
}

func (a *Auth) hasPIN(ctx context.Context) (bool, error) {
	var n int
	err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pin`).Scan(&n)
	return n > 0, err
}

func (a *Auth) setPIN(ctx context.Context, pin string) error {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	a.hashMu.Lock()
	h := hashPIN(pin, salt)
	a.hashMu.Unlock()
	_, err := a.db.ExecContext(ctx, `INSERT INTO pin (id, hash, salt, updated_at) VALUES (1, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, updated_at = excluded.updated_at`,
		h, salt, a.now().UnixMilli())
	return err
}

// checkPIN: rätt PIN nollställer felräkningen; fel PIN räknas per konto och
// ger en spärr som fördubblas (5 min, 10 min … högst en timme).
func (a *Auth) checkPIN(ctx context.Context, login, pin string) (ok bool, wait time.Duration, err error) {
	a.mu.Lock()
	f := a.failures[login]
	if f != nil && a.now().Before(f.until) {
		wait = f.until.Sub(a.now())
		a.mu.Unlock()
		return false, wait, nil
	}
	a.mu.Unlock()

	var h, salt []byte
	if err := a.db.QueryRowContext(ctx, `SELECT hash, salt FROM pin WHERE id = 1`).Scan(&h, &salt); err != nil {
		return false, 0, err
	}
	a.hashMu.Lock()
	ok = pinFormat.MatchString(pin) && subtle.ConstantTimeCompare(hashPIN(pin, salt), h) == 1
	a.hashMu.Unlock()

	a.mu.Lock()
	defer a.mu.Unlock()
	if ok {
		delete(a.failures, login)
		return true, 0, nil
	}
	f = a.failures[login]
	if f == nil {
		f = &failure{period: firstLockout}
		a.failures[login] = f
	}
	f.n++
	if f.n >= maxFailures {
		f.n = 0
		f.until = a.now().Add(f.period)
		wait = f.period
		f.period = min(2*f.period, maxLockout)
	}
	return false, wait, nil
}

func (a *Auth) newSession(login string) string {
	b := make([]byte, 32)
	rand.Read(b)
	tok := base64.RawURLEncoding.EncodeToString(b)
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for t, s := range a.sessions { // städa gamla
		if now.After(s.until) {
			delete(a.sessions, t)
		}
	}
	a.sessions[tok] = session{login: login, until: now.Add(sessionIdle)}
	return tok
}

// unlocked: giltig session för just det här kontot. Förlänger den.
func (a *Auth) unlocked(r *http.Request, login string) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[c.Value]
	if !ok || s.login != login || a.now().After(s.until) {
		return false
	}
	s.until = a.now().Add(sessionIdle)
	a.sessions[c.Value] = s
	return true
}

func (a *Auth) endSession(r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, c.Value)
		a.mu.Unlock()
	}
}

func setSessionCookie(w http.ResponseWriter, tok string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/api/",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: maxAge,
	})
}

// ── /api/auth ────────────────────────────────────────────────────────────────

type account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *server) authStatus(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	has, err := s.auth.hasPIN(r.Context())
	if err != nil {
		storeError(w, err)
		return
	}
	res := map[string]any{"role": u.Role, "hasPin": has, "unlocked": s.parentMode(r)}
	if u.Role == "child" {
		res["account"] = u.ID
	}
	if s.parentMode(r) {
		// Barnkontona, för att koppla en profil till ett konto.
		accs := []account{}
		for _, x := range s.userList {
			if x.Role == "child" {
				accs = append(accs, account{x.ID, x.Name})
			}
		}
		res["accounts"] = accs
	}
	writeJSON(w, http.StatusOK, res)
}

func readPIN(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct{ Pin string }
	b, err := readBody(w, r, 1024)
	if err != nil || json.Unmarshal(b, &body) != nil || !pinFormat.MatchString(body.Pin) {
		apiError(w, http.StatusBadRequest, "PIN-koden ska vara 4–6 siffror.")
		return "", false
	}
	return body.Pin, true
}

// authSetPIN: första PIN:en sätts av ett föräldrakonto; en ny PIN kräver
// upplåst föräldraläge. Ger en upplåst session.
func (s *server) authSetPIN(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role != "parent" {
		apiError(w, http.StatusForbidden, "Bara en förälder kan sätta PIN-koden.")
		return
	}
	pin, ok := readPIN(w, r)
	if !ok {
		return
	}
	has, err := s.auth.hasPIN(r.Context())
	if err != nil {
		storeError(w, err)
		return
	}
	if has && !s.parentMode(r) {
		apiError(w, http.StatusForbidden, "Lås upp föräldraläget för att byta PIN-kod.")
		return
	}
	if err := s.auth.setPIN(r.Context(), pin); err != nil {
		storeError(w, err)
		return
	}
	setSessionCookie(w, s.auth.newSession(u.Login), 0)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) authUnlock(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role != "parent" {
		apiError(w, http.StatusForbidden, "Föräldraläget är bara för föräldrar.")
		return
	}
	pin, ok := readPIN(w, r)
	if !ok {
		return
	}
	good, wait, err := s.auth.checkPIN(r.Context(), u.Login, pin)
	if errors.Is(err, sql.ErrNoRows) {
		apiError(w, http.StatusConflict, "Ingen PIN-kod är satt än.")
		return
	}
	if err != nil {
		storeError(w, err)
		return
	}
	if !good {
		res := map[string]any{"ok": false}
		if wait > 0 {
			res["waitSeconds"] = int(wait.Seconds() + 0.5)
		}
		writeJSON(w, http.StatusOK, res)
		return
	}
	setSessionCookie(w, s.auth.newSession(u.Login), 0)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) authLock(w http.ResponseWriter, r *http.Request) {
	s.auth.endSession(r)
	setSessionCookie(w, "", -1)
	w.WriteHeader(http.StatusNoContent)
}
