// Pluggkompis — barnens pluggapp. Plan 1.6, fas 3: samma frontend som
// artifacten (web/, orörd), med Go-backend för lagring, filer och senare AI.
//
// Nätet: tsnet i binären = egen tailnet-nod `pluggkompis` (tag:pluggkompis),
// HTTPS med Tailscales cert, identitet via WhoIs (samma mönster som pengar och
// Control). En okänd login nekas alltid. Lokalt (-dev) körs utan tsnet med en
// fast dev-identitet.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

var version = "0.1.0"

// User: ett Tailscale-konto som får använda appen. Devices (stable ID) är
// valfritt; anges det måste även enheten stämma. Det behövs för den förälder som
// äger tjänstenoderna i tailnätet.
type User struct {
	Login   string   `json:"login"`
	Name    string   `json:"name"`
	Role    string   `json:"role"` // parent | child
	Devices []string `json:"devices,omitempty"`
}

type Config struct {
	Users []User `json:"users"`
}

func loadConfig(path string) (map[string]User, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	users := map[string]User{}
	for _, u := range c.Users {
		if u.Login == "" || (u.Role != "parent" && u.Role != "child") {
			return nil, fmt.Errorf("användare %q: login och roll (parent/child) krävs", u.Login)
		}
		users[u.Login] = u
	}
	return users, nil
}

func main() {
	cfgPath := flag.String("config", os.Getenv("PLUGGKOMPIS_CONFIG"), "användare (JSON)")
	dbPath := flag.String("db", "pluggkompis.db", "SQLite-databas")
	stateDir := flag.String("state", "", "tsnet-katalog (tom = ingen tsnet; kräver -dev)")
	hostname := flag.String("hostname", "pluggkompis", "tailnet-namn")
	tsPort := flag.Uint("ts-port", 0, "UDP-port för WireGuard")
	keyFile := flag.String("authkey-file", "", "Tailscale-nyckel (bara första inloggningen)")
	dev := flag.String("dev", "", "lokal utveckling utan tsnet, t.ex. 127.0.0.1:8095")
	demo := flag.Bool("demo", false, "fyll en tom databas med exempelprovet (examples/)")
	flag.Parse()

	index, err := serverIndex()
	if err != nil {
		log.Fatal(err)
	}
	st, err := openStore(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if *demo {
		if empty, err := st.Empty(ctx); err != nil {
			log.Fatal(err)
		} else if empty {
			if err := st.importBackup(ctx, demoBackup); err != nil {
				log.Fatal(err)
			}
			// Föräldra-PIN 1234 i webbläsarens format (repo.js → hashPin).
			sum := sha256.Sum256([]byte("demo:1234"))
			pin := fmt.Sprintf(`{"salt":"demo","pinHash":%q}`, hex.EncodeToString(sum[:]))
			if err := st.Set(ctx, "settings/parent", []byte(pin)); err != nil {
				log.Fatal(err)
			}
			log.Print("demoläge: exempelprovet inlagt, föräldra-PIN 1234")
		}
	}

	a := &server{st: st, index: index}

	if *dev != "" {
		if *stateDir != "" {
			log.Fatal("-dev går bara utan tsnet")
		}
		host, _, _ := strings.Cut(*dev, ":")
		if host != "127.0.0.1" && host != "localhost" && host != "[::1]" {
			log.Fatal("-dev lyssnar bara på loopback")
		}
		u := User{Login: "dev@local", Name: "Utvecklare", Role: "parent"}
		a.users = map[string]User{u.Login: u}
		a.who = devWho{who{login: u.Login, node: "dev"}}
		log.Printf("pluggkompis %s (dev): http://%s/", version, *dev)
		srv := &http.Server{Addr: *dev, Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
		log.Fatal(srv.ListenAndServe())
	}

	if *stateDir == "" || *cfgPath == "" {
		log.Fatal("-state och -config krävs (eller -dev för lokal utveckling)")
	}
	if a.users, err = loadConfig(*cfgPath); err != nil {
		log.Fatal(err)
	}
	var key string
	if *keyFile != "" {
		b, err := os.ReadFile(*keyFile)
		if err != nil {
			log.Fatal(err)
		}
		key = strings.TrimSpace(string(b))
	}
	ts := &tsnet.Server{
		Hostname:      *hostname,
		Dir:           *stateDir,
		AuthKey:       key, // bara vid första inloggningen; sedan räcker state
		AdvertiseTags: []string{"tag:pluggkompis"},
		Port:          uint16(*tsPort),
		UserLogf:      log.Printf,
		Logf:          func(string, ...any) {},
	}
	defer ts.Close()
	log.Printf("pluggkompis %s: ansluter som %q (en ny nod kan behöva godkännas i admin-konsolen)", version, *hostname)
	status, err := ts.Up(ctx)
	if err != nil {
		log.Fatal(err)
	}
	lc, err := ts.LocalClient()
	if err != nil {
		log.Fatal(err)
	}
	a.who = tsWho{lc}
	fqdn := strings.TrimSuffix(status.Self.DNSName, ".")
	ln80, err := ts.Listen("tcp", ":80")
	if err != nil {
		log.Fatal(err)
	}
	go http.Serve(ln80, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://"+fqdn+r.URL.RequestURI(), http.StatusMovedPermanently)
	}))
	ln, err := ts.ListenTLS("tcp", ":443")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("pluggkompis lyssnar på https://%s", fqdn)
	srv := &http.Server{Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.Serve(ln))
}

// ── identitet ────────────────────────────────────────────────────────────────

type whoer interface {
	whois(ctx context.Context, remoteAddr string) (who, error)
}

type who struct {
	login, node, stableID string
	tagged                bool
}

type devWho struct{ w who }

func (d devWho) whois(context.Context, string) (who, error) { return d.w, nil }

type tsWho struct{ lc *local.Client }

// whois: kontot som äger den anslutande noden. Taggade noder (servrar,
// tjänster) har ingen person bakom sig och nekas.
func (t tsWho) whois(ctx context.Context, remoteAddr string) (who, error) {
	res, err := t.lc.WhoIs(ctx, remoteAddr)
	if err != nil {
		return who{}, err
	}
	if res.Node == nil || res.UserProfile == nil {
		return who{}, errors.New("okänd nod")
	}
	node := strings.SplitN(strings.TrimSuffix(res.Node.Name, "."), ".", 2)[0]
	return who{
		login:    res.UserProfile.LoginName,
		node:     node,
		stableID: string(res.Node.StableID),
		tagged:   res.Node.IsTagged(),
	}, nil
}

// allowed: känd login, inte taggad nod, och rätt enhet om enheter är angivna.
func (u User) allowed(w who) bool {
	if w.tagged || w.login != u.Login {
		return false
	}
	return len(u.Devices) == 0 || slices.Contains(u.Devices, w.stableID)
}
