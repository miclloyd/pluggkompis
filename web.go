package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"strings"
)

// web/ är artifactens källkod, orörd. libs/ fylls vid bygget med pinnade
// kopior av biblioteken (flake.nix, eller dev/libs.sh lokalt).
//
//go:embed web
var webFS embed.FS

//go:embed all:libs
var libsFS embed.FS

//go:embed examples/export-exempel.json
var demoBackup []byte

// Det enda som skiljer index.html på servern från artifacten: typsnitt och
// htm+Preact från egna kopior i stället för Google Fonts och cdnjs.
var indexRewrites = []struct{ from, to string }{
	{`<link rel="preconnect" href="https://fonts.googleapis.com">` + "\n", ""},
	{`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` + "\n", ""},
	{`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap">`,
		`<link rel="stylesheet" href="libs/fonts.css">`},
	{`<script src="https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/preact/standalone.umd.min.js"></script>`,
		`<script src="libs/htm-preact-standalone.umd.js"></script>`},
}

func serverIndex() ([]byte, error) {
	b, err := webFS.ReadFile("web/index.html")
	if err != nil {
		return nil, err
	}
	for _, r := range indexRewrites {
		if bytes.Count(b, []byte(r.from)) != 1 {
			return nil, fmt.Errorf("index.html: hittar inte exakt en %q", r.from)
		}
		b = bytes.Replace(b, []byte(r.from), []byte(r.to), 1)
	}
	if bytes.Contains(b, []byte("https://")) {
		return nil, errors.New("index.html: extern adress kvar efter omskrivningen")
	}
	return b, nil
}

// clientConfig är svaret på /api/config (web/adapters/server.js).
func clientConfig(ai bool) map[string]any {
	return map[string]any{
		"env": "server",
		"features": map[string]any{
			"ai":             ai,
			"images":         ai,
			"imageMaxCount":  maxImages,
			"maxPromptBytes": maxPromptBytes,
			"persistent":     true,
			"files":          true,
			"save":           true,
			"tts":            false,
			"dictation":      false,
			"pdfViaApi":      false,
		},
		"libs": map[string]any{
			"pdfjs":       "/libs/pdf.min.js",
			"pdfjsWorker": "/libs/pdf.worker.min.js",
			"jszip":       "/libs/jszip.min.js",
			"jspdf":       "/libs/jspdf.umd.min.js",
		},
	}
}

// Allt från egen origin. style-src 'unsafe-inline': index.html har sin CSS
// inline och komponenterna sätter style-attribut. blob: för sidbilder och
// pdf.js.
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; " +
	"object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

type server struct {
	st       *Store
	auth     *Auth
	ai       *AI // nil = ingen nyckel
	who      whoer
	users    map[string][]User // login → användare (flera bara med egna enheter)
	userList []User            // i konfigurationens ordning
	index    []byte
	host     string        // tailnet-namnet (fqdn) eller LAN-namnet; tomt = dev, http på loopback
	lan      bool          // LAN-lyssnaren (skoldatorer): inloggning med kaka i stället för WhoIs
	heavy    chan struct{} // samtidiga tunga anrop (filer, AI)
}

func (s *server) setUsers(list []User) {
	s.userList = list
	s.users = map[string][]User{}
	for _, u := range list {
		s.users[u.Login] = append(s.users[u.Login], u)
	}
}

func (a *server) routes() http.Handler {
	mux := http.NewServeMux()
	web, _ := fs.Sub(webFS, "web")
	libs, _ := fs.Sub(libsFS, "libs")
	static := noDirs(http.FileServerFS(web))

	mux.HandleFunc("GET /{$}", a.serveIndex)
	mux.HandleFunc("GET /index.html", a.serveIndex)
	mux.Handle("GET /libs/", http.StripPrefix("/libs/", noDirs(http.FileServerFS(libs))))
	mux.Handle("GET /", static)

	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, clientConfig(a.ai != nil))
	})
	mux.HandleFunc("GET /api/auth", a.authStatus)
	if a.lan {
		mux.HandleFunc("POST /api/lan/login", a.lanLogin)
		mux.HandleFunc("POST /api/lan/logout", a.lanLogout)
	} else {
		mux.HandleFunc("GET /api/lan/credentials", a.lanCredsList)
		mux.HandleFunc("PUT /api/lan/credentials", a.lanCredsSet)
		mux.HandleFunc("DELETE /api/lan/credentials/{account}", a.lanCredsDelete)
	}
	if !a.lan { // föräldraläget finns inte ens som väg på LAN
		mux.HandleFunc("POST /api/auth/pin", a.authSetPIN)
		mux.HandleFunc("POST /api/auth/unlock", a.authUnlock)
		mux.HandleFunc("POST /api/auth/lock", a.authLock)
	}
	mux.HandleFunc("GET /api/store/{path...}", a.storeGet)
	mux.HandleFunc("PUT /api/store/{path...}", a.storeSet)
	mux.HandleFunc("PATCH /api/store/{path...}", a.storeUpdate)
	mux.HandleFunc("DELETE /api/store/{path...}", a.storeDelete)
	if a.heavy == nil {
		a.heavy = make(chan struct{}, 3)
	}
	mux.HandleFunc("POST /api/ai", a.limitHeavy(a.aiHandler))
	if !a.lan {
		mux.HandleFunc("GET /api/usage", a.usage)
	}
	mux.HandleFunc("POST /api/files", a.limitHeavy(a.filePut))
	mux.HandleFunc("GET /api/files/{id}", a.limitHeavy(a.fileGet))
	mux.HandleFunc("DELETE /api/files/{id}", a.fileDelete)
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
		apiError(w, http.StatusNotFound, "finns inte")
	})
	id := a.identify
	if a.lan {
		id = a.lanIdentify
	}
	return a.checkHost(id(a.sameOrigin(headers(mux))))
}

// checkHost: bara appens eget namn (skydd mot DNS-rebinding: en främmande
// domän som pekas om till nodens adress får inget svar).
func (a *server) checkHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.host != "" && r.Host != a.host && r.Host != a.host+":443" {
			http.Error(w, "fel värdnamn", http.StatusMisdirectedRequest)
			return
		}
		// Övervakningen (Kuma på edge) är inte en familjeenhet: /healthz svarar
		// utan WhoIs, men bara "ok" eller ett fel — ingen data.
		if r.URL.Path == "/healthz" && r.Method == http.MethodGet {
			if err := a.st.db.PingContext(r.Context()); err != nil {
				http.Error(w, "databasen svarar inte", http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Write([]byte("ok"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// sameOrigin: skrivande anrop måste komma från appens egen sida. Barnets
// identitet är nodens adress (WhoIs), inte en kaka, så SameSite skyddar inte
// barnets anrop — därför krävs Origin eller Sec-Fetch-Site (webbläsare skickar
// alltid något av dem på POST/PUT/PATCH/DELETE).
func (a *server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			want := "https://" + a.host
			if a.host == "" {
				want = "http://" + r.Host
			}
			o, site := r.Header.Get("Origin"), r.Header.Get("Sec-Fetch-Site")
			if !(o == want || (o == "" && site == "same-origin")) {
				apiError(w, http.StatusForbidden, "fel ursprung")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// limitHeavy: högst några tunga anrop åt gången (minnet: filer upp till
// maxFileBytes, sidbilder base64-kodade).
func (a *server) limitHeavy(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case a.heavy <- struct{}{}:
			defer func() { <-a.heavy }()
			h(w, r)
		case <-r.Context().Done():
		}
	}
}

// noDirs: inga kataloglistningar.
func noDirs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "" || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		// Liten app som uppdateras sällan men ska slå igenom direkt efter deploy.
		h.Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

// identify: varje anrop måste komma från en känd login (WhoIs). Okänd = nej.
func (a *server) identify(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := a.who.whois(r.Context(), r.RemoteAddr)
		if err != nil {
			http.Error(w, "Okänd enhet", http.StatusForbidden)
			return
		}
		var u User
		ok := false
		for _, c := range a.users[id.login] {
			if c.allowed(id) {
				u, ok = c, true
				break
			}
		}
		if ok && u.PINRequired && !a.auth.unlocked(r, u.Login) {
			u.Role, u.canUnlock = "child", true
		}
		if !ok {
			log.Printf("nekad: login %q nod %q", id.login, id.node)
			http.Error(w, "Det här kontot har inte tillgång till Pluggkompis.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, u)))
	})
}

type userKey struct{}

func (a *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(a.index)
}

// ── /api/store ───────────────────────────────────────────────────────────────

func (a *server) storeGet(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("path")
	if err := a.canRead(r, p); err != nil {
		accessError(w, err)
		return
	}
	if r.URL.Query().Get("list") == "1" {
		docs, err := a.st.List(r.Context(), p)
		if err == nil {
			docs, err = a.filterList(r, p, docs)
		}
		if err == nil {
			a.forChild(r, p, docs...)
		}
		if err != nil {
			storeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, docs)
		return
	}
	d, err := a.st.Get(r.Context(), p)
	if errors.Is(err, errNotFound) {
		// Saknat dokument = null (som artifactens db), inte ett fel i konsolen.
		writeJSON(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		storeError(w, err)
		return
	}
	docs := []json.RawMessage{d}
	a.forChild(r, p, docs...)
	writeJSON(w, http.StatusOK, docs[0])
}

func (a *server) storeSet(w http.ResponseWriter, r *http.Request) {
	body, err := a.writeBody(w, r)
	if err != nil {
		accessError(w, err)
		return
	}
	if err := a.st.Set(r.Context(), r.PathValue("path"), body); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *server) storeUpdate(w http.ResponseWriter, r *http.Request) {
	body, err := a.writeBody(w, r)
	if err != nil {
		accessError(w, err)
		return
	}
	if err := a.st.Update(r.Context(), r.PathValue("path"), body); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeBody: behörighet + body; för barnets profilskrivning bara de tillåtna fälten.
func (a *server) writeBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	p := r.PathValue("path")
	if _, _, _, err := docPath(p); err != nil {
		return nil, err
	}
	mode, err := a.canWrite(r, p)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r, maxDocBytes)
	if err != nil {
		return nil, err
	}
	switch mode {
	case writeProfile:
		return a.restrictedProfile(r.Context(), p, body)
	case writeTask:
		return a.restrictedTask(r, p, body)
	}
	return body, nil
}

func (a *server) storeDelete(w http.ResponseWriter, r *http.Request) {
	if _, err := a.canWrite(r, r.PathValue("path")); err != nil {
		accessError(w, err)
		return
	}
	if err := a.st.Delete(r.Context(), r.PathValue("path")); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── /api/files ───────────────────────────────────────────────────────────────

// Bara filtyper som appen läser in (extract.js). Allt annat lagras som
// application/octet-stream och visas aldrig inline.
var fileTypes = map[string]bool{
	"application/pdf": true,
	"image/jpeg":      true, "image/png": true, "image/webp": true, "image/heic": true, "image/gif": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"text/plain": true,
}

func (a *server) filePut(w http.ResponseWriter, r *http.Request) {
	if !a.parentMode(r) {
		accessError(w, errForbidden)
		return
	}
	body, err := readBody(w, r, maxFileBytes)
	if err != nil {
		storeError(w, err)
		return
	}
	typ, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if !fileTypes[typ] {
		typ = http.DetectContentType(body)
		if i := strings.IndexByte(typ, ';'); i >= 0 {
			typ = typ[:i]
		}
		if !fileTypes[typ] {
			typ = "application/octet-stream"
		}
	}
	id, err := a.st.PutFile(r.Context(), typ, body)
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "url": "/api/files/" + id})
}

func (a *server) fileGet(w http.ResponseWriter, r *http.Request) {
	typ, data, err := a.st.GetFile(r.Context(), r.PathValue("id"))
	if err != nil {
		storeError(w, err)
		return
	}
	w.Header().Set("Content-Type", typ)
	if !strings.HasPrefix(typ, "image/") && typ != "application/pdf" {
		w.Header().Set("Content-Disposition", "attachment")
	}
	// Filer ändras aldrig (nytt id vid ny uppladdning).
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Write(data)
}

func (a *server) fileDelete(w http.ResponseWriter, r *http.Request) {
	if !a.parentMode(r) {
		accessError(w, errForbidden)
		return
	}
	if err := a.st.DeleteFile(r.Context(), r.PathValue("id")); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── hjälpare ─────────────────────────────────────────────────────────────────

func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		return nil, errTooLarge
	}
	return b, err
}

func storeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		apiError(w, http.StatusNotFound, "finns inte")
	case errors.Is(err, errBadPath), errors.Is(err, errBadDoc):
		apiError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, errTooLarge):
		apiError(w, http.StatusRequestEntityTooLarge, "för stort")
	default:
		log.Printf("lagringsfel: %v", err)
		apiError(w, http.StatusInternalServerError, "lagringsfel")
	}
}

func apiError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"message": msg})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
