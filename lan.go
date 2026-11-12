package main

// LAN-vägen för skoldatorer (plan 1.6, fas 3b): en egen HTTPS-lyssnare på hemnätet,
// där barnet loggar in med eget användarnamn och lösenord (skoldatorn är inte med i
// tailnätet, så WhoIs finns inte). Bara barnkonton: föräldraläget nås aldrig från LAN.
// Lösenorden sätter en förälder i föräldraläget via tailnätet. Brandväggen (i driften)
// släpper bara in hemnätet, aldrig gäst, IoT eller internet.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	lanCookie       = "pk_lan"
	lanSessionTTL   = 30 * 24 * time.Hour
	lanMaxFailures  = 5
	lanLockout      = 5 * time.Minute
	lanMaxPassBytes = 128
	lanMaxTracked   = 4096 // spärrposter i minnet
)

var (
	lanUsername = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)
	sixDigits   = regexp.MustCompile(`^[0-9]{6}$`)
)

// Lösenordet: minst 8 tecken, eller en PIN på exakt 6 siffror (plan 1.6).
func lanPasswordOK(p string) bool {
	return len(p) <= lanMaxPassBytes && (len([]rune(p)) >= 8 || sixDigits.MatchString(p))
}

func (a *Auth) migrateLAN() error {
	_, err := a.db.Exec(`
CREATE TABLE IF NOT EXISTS lan_logins (
  account    TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  hash       BLOB NOT NULL,
  salt       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lan_sessions (
  token_hash TEXT PRIMARY KEY,  -- sha256 av kakan; själva kakan sparas aldrig
  account    TEXT NOT NULL,
  expires    INTEGER NOT NULL
);`)
	return err
}

func tokenHash(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

// lanFailKey: spärren gäller per konto och adress (plan 1.6).
func lanFailKey(username, remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	return username + "|" + host
}

// checkLAN prövar ett användarnamn och lösenord. Ett försök åt gången (hashMu), och
// spärren kontrolleras och räknas under samma lås (samma lärdom som PIN-spärren).
func (a *Auth) checkLAN(ctx context.Context, username, password, remote string) (account string, wait time.Duration, err error) {
	a.hashMu.Lock()
	defer a.hashMu.Unlock()
	key := lanFailKey(username, remote)
	a.mu.Lock()
	if f := a.lanFail[key]; f != nil && a.now().Before(f.until) {
		wait = f.until.Sub(a.now())
		a.mu.Unlock()
		return "", wait, nil
	}
	a.mu.Unlock()

	var acc string
	var h, salt []byte
	err = a.db.QueryRowContext(ctx, `SELECT account, hash, salt FROM lan_logins WHERE username = ?`, username).Scan(&acc, &h, &salt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", 0, err
	}
	// Okänt användarnamn: hasha ändå (samma arbete), så att svarstiden inte avslöjar vilka namn som finns.
	if errors.Is(err, sql.ErrNoRows) {
		h, salt, acc = make([]byte, 32), make([]byte, 16), ""
	}
	pw := password
	if len(pw) > lanMaxPassBytes {
		pw = pw[:lanMaxPassBytes]
	}
	match := subtle.ConstantTimeCompare(hashPIN(pw, salt), h) == 1
	ok := acc != "" && len(password) <= lanMaxPassBytes && match

	a.mu.Lock()
	defer a.mu.Unlock()
	if ok {
		delete(a.lanFail, key)
		return acc, 0, nil
	}
	f := a.lanFail[key]
	if f == nil {
		// Taket på minnet: städa utgångna spärrar, och vid för många poster den äldsta halvan.
		if len(a.lanFail) >= lanMaxTracked {
			now := a.now()
			for k, v := range a.lanFail {
				if v.until.Before(now) {
					delete(a.lanFail, k)
				}
			}
			for k := range a.lanFail {
				if len(a.lanFail) < lanMaxTracked/2 {
					break
				}
				delete(a.lanFail, k)
			}
		}
		f = &failure{}
		a.lanFail[key] = f
	}
	f.n++
	if f.n >= lanMaxFailures {
		f.n = 0
		f.until = a.now().Add(lanLockout)
		wait = lanLockout
	}
	return "", wait, nil
}

func (a *Auth) newLANSession(ctx context.Context, account string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	now := a.now()
	if _, err := a.db.ExecContext(ctx, `DELETE FROM lan_sessions WHERE expires < ?`, now.UnixMilli()); err != nil {
		return "", err
	}
	_, err := a.db.ExecContext(ctx, `INSERT INTO lan_sessions (token_hash, account, expires) VALUES (?, ?, ?)`,
		tokenHash(tok), account, now.Add(lanSessionTTL).UnixMilli())
	return tok, err
}

func (a *Auth) lanAccount(ctx context.Context, r *http.Request) string {
	c, err := r.Cookie(lanCookie)
	if err != nil || c.Value == "" {
		return ""
	}
	var acc string
	err = a.db.QueryRowContext(ctx, `SELECT account FROM lan_sessions WHERE token_hash = ? AND expires >= ?`,
		tokenHash(c.Value), a.now().UnixMilli()).Scan(&acc)
	if err != nil {
		return ""
	}
	return acc
}

// ── LAN-servern ──────────────────────────────────────────────────────────────

// childByID: barnkontot (från konfigurationen) som en LAN-inloggning hör till.
func (s *server) childByID(id string) (User, bool) {
	for _, u := range s.userList {
		if u.ID == id && u.Role == "child" {
			return u, true
		}
	}
	return User{}, false
}

// lanIdentify ersätter WhoIs på LAN: identiteten kommer från inloggningskakan.
// Utan inloggning går bara sidan, biblioteken, /api/config, /api/auth och inloggningen.
func (s *server) lanIdentify(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var u User
		if acc := s.auth.lanAccount(r.Context(), r); acc != "" {
			if c, ok := s.childByID(acc); ok {
				u = User{ID: c.ID, Login: "lan:" + c.ID, Name: c.Name, Role: "child"}
			}
		}
		if u.ID == "" {
			open := !strings.HasPrefix(r.URL.Path, "/api/") ||
				(r.Method == http.MethodGet && (r.URL.Path == "/api/config" || r.URL.Path == "/api/auth")) ||
				(r.Method == http.MethodPost && (r.URL.Path == "/api/lan/login" || r.URL.Path == "/api/lan/logout"))
			if !open {
				apiError(w, http.StatusUnauthorized, "Logga in först.")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, u)))
	})
}

func (s *server) lanLogin(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	b, err := readBody(w, r, 1024)
	if err != nil || json.Unmarshal(b, &body) != nil {
		apiError(w, http.StatusBadRequest, "ogiltigt anrop")
		return
	}
	user := strings.ToLower(strings.TrimSpace(body.Username))
	acc, wait, err := s.auth.checkLAN(r.Context(), user, body.Password, r.RemoteAddr)
	if err != nil {
		storeError(w, err)
		return
	}
	if acc == "" {
		res := map[string]any{"ok": false}
		if wait > 0 {
			res["waitSeconds"] = int(wait.Seconds() + 0.5)
		}
		writeJSON(w, http.StatusOK, res)
		return
	}
	if _, ok := s.childByID(acc); !ok {
		log.Printf("lan: inloggning för konto %q som inte längre är ett barnkonto", acc)
		writeJSON(w, http.StatusOK, map[string]any{"ok": false})
		return
	}
	tok, err := s.auth.newLANSession(r.Context(), acc)
	if err != nil {
		storeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: lanCookie, Value: tok, Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteStrictMode, MaxAge: int(lanSessionTTL.Seconds())})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) lanLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(lanCookie); err == nil {
		if _, err := s.st.db.ExecContext(r.Context(), `DELETE FROM lan_sessions WHERE token_hash = ?`, tokenHash(c.Value)); err != nil {
			log.Printf("lan: utloggning: %v", err)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: lanCookie, Value: "", Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// ── förälderns hantering (bara via tailnätet, upplåst föräldraläge) ──────────

func (s *server) lanCredsList(w http.ResponseWriter, r *http.Request) {
	if !s.parentMode(r) {
		accessError(w, errLocked)
		return
	}
	rows, err := s.st.db.QueryContext(r.Context(), `SELECT account, username, updated_at FROM lan_logins ORDER BY account`)
	if err != nil {
		storeError(w, err)
		return
	}
	defer rows.Close()
	type row struct {
		Account   string `json:"account"`
		Username  string `json:"username"`
		UpdatedAt int64  `json:"updatedAt"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if rows.Scan(&x.Account, &x.Username, &x.UpdatedAt) == nil {
			out = append(out, x)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// lanCredsSet: sätter eller byter användarnamn och lösenord för ett barnkonto.
// Ett byte loggar ut kontots alla skoldatorer.
func (s *server) lanCredsSet(w http.ResponseWriter, r *http.Request) {
	if !s.parentMode(r) {
		accessError(w, errLocked)
		return
	}
	var body struct{ Account, Username, Password string }
	b, err := readBody(w, r, 1024)
	if err != nil || json.Unmarshal(b, &body) != nil {
		apiError(w, http.StatusBadRequest, "ogiltigt anrop")
		return
	}
	user := strings.ToLower(strings.TrimSpace(body.Username))
	if _, ok := s.childByID(body.Account); !ok {
		apiError(w, http.StatusBadRequest, "Inloggning på skoldator finns bara för barnkonton.")
		return
	}
	if !lanUsername.MatchString(user) {
		apiError(w, http.StatusBadRequest, "Användarnamnet ska vara 3–32 tecken: a–z, siffror, punkt, bindestreck eller understreck.")
		return
	}
	if !lanPasswordOK(body.Password) {
		apiError(w, http.StatusBadRequest, "Lösenordet ska vara minst 8 tecken, eller en PIN på exakt 6 siffror.")
		return
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		storeError(w, err)
		return
	}
	s.auth.hashMu.Lock()
	h := hashPIN(body.Password, salt)
	s.auth.hashMu.Unlock()
	ctx := r.Context()
	tx, err := s.st.db.BeginTx(ctx, nil)
	if err != nil {
		storeError(w, err)
		return
	}
	defer tx.Rollback()
	var other string
	if tx.QueryRowContext(ctx, `SELECT account FROM lan_logins WHERE username = ? AND account <> ?`, user, body.Account).Scan(&other) == nil {
		apiError(w, http.StatusConflict, "Användarnamnet är redan taget.")
		return
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO lan_logins (account, username, hash, salt, updated_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(account) DO UPDATE SET username = excluded.username, hash = excluded.hash, salt = excluded.salt, updated_at = excluded.updated_at`,
		body.Account, user, h, salt, s.st.now().UnixMilli()); err != nil {
		storeError(w, err)
		return
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM lan_sessions WHERE account = ?`, body.Account); err != nil {
		storeError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// lanCredsDelete: tar bort kontots LAN-inloggning och loggar ut alla dess skoldatorer.
func (s *server) lanCredsDelete(w http.ResponseWriter, r *http.Request) {
	if !s.parentMode(r) {
		accessError(w, errLocked)
		return
	}
	acc := r.PathValue("account")
	for _, q := range []string{`DELETE FROM lan_logins WHERE account = ?`, `DELETE FROM lan_sessions WHERE account = ?`} {
		if _, err := s.st.db.ExecContext(r.Context(), q, acc); err != nil {
			storeError(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
