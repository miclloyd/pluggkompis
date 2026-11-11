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
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

var version = "0.7.0"

// User: ett Tailscale-konto som får använda appen. Devices (stable ID) är
// valfritt; anges det måste även enheten stämma. Det behövs för den förälder som
// äger tjänstenoderna i tailnätet.
type User struct {
	ID      string   `json:"id"` // familjens id (lib/family.nix); kopplar barnkontot till profiler
	Login   string   `json:"login"`
	Name    string   `json:"name"`
	Role    string   `json:"role"` // parent | child
	Devices []string `json:"devices,omitempty"`
}

type Config struct {
	Users  []User `json:"users"`
	Models Models `json:"models"`
	Limits Limits `json:"limits"`
}

func loadConfig(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	seen := map[string]bool{}
	for _, u := range c.Users {
		if u.ID == "" || u.Login == "" || (u.Role != "parent" && u.Role != "child") {
			return c, fmt.Errorf("användare %q: id, login och roll (parent/child) krävs", u.Login)
		}
		if seen[u.ID] || seen["login:"+u.Login] {
			return c, fmt.Errorf("användare %q: id eller login finns två gånger", u.Login)
		}
		seen[u.ID], seen["login:"+u.Login] = true, true
	}
	return c, nil
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
	aiKeyFile := flag.String("anthropic-key-file", "", "API-nyckel till Anthropic (tom = ingen AI)")
	devAIURL := flag.String("dev-ai-url", "", "låtsas-AI i stället för Anthropic (bara med -dev)")
	devAs := flag.String("dev-as", "parent", "dev-identitetens roll: parent | child (barnet heter devbarn)")
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
	auth, err := newAuth(st)
	if err != nil {
		log.Fatal(err)
	}
	if *demo && *dev == "" {
		log.Fatal("-demo går bara med -dev (sätter PIN 1234)")
	}
	if *demo {
		if empty, err := st.Empty(ctx); err != nil {
			log.Fatal(err)
		} else if empty {
			if err := st.importBackup(ctx, demoBackup); err != nil {
				log.Fatal(err)
			}
			// Exempelbarnet kopplas till dev-barnet (-dev-as child).
			if err := st.Update(ctx, "profiles/pdemo01", []byte(`{"account":"devbarn"}`)); err != nil {
				log.Fatal(err)
			}
			if err := auth.setPIN(ctx, "1234"); err != nil {
				log.Fatal(err)
			}
			log.Print("demoläge: exempelprovet inlagt, föräldra-PIN 1234")
		}
	}
	a := &server{st: st, auth: auth, index: index}
	setupAI := func(key string, c Config) {
		if key == "" {
			log.Print("ingen API-nyckel: AI är avstängt")
			return
		}
		if a.ai, err = newAI(st, key, c.Models, c.Limits); err != nil {
			log.Fatal(err)
		}
		log.Printf("AI: %s/%s/%s, tak %d per barn och dag, %d per prov",
			a.ai.models.Quick, a.ai.models.Default, a.ai.models.Complex, a.ai.limits.ChildPerDay, a.ai.limits.PerTest)
	}

	if *dev != "" {
		if *stateDir != "" {
			log.Fatal("-dev går bara utan tsnet")
		}
		host, _, err := net.SplitHostPort(*dev)
		if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
			log.Fatal("-dev lyssnar bara på loopback")
		}
		users := []User{
			{ID: "dev", Login: "dev@local", Name: "Förälder (dev)", Role: "parent"},
			{ID: "devbarn", Login: "devbarn@local", Name: "Barn (dev)", Role: "child"},
		}
		a.setUsers(users)
		me := users[0]
		if *devAs == "child" {
			me = users[1]
		}
		a.who = devWho{who{login: me.Login, node: "dev"}}
		if *devAIURL != "" {
			setupAI("dev", Config{})
			a.ai.url = *devAIURL
		} else {
			setupAI(readKey(*aiKeyFile), Config{})
		}
		log.Printf("pluggkompis %s (dev): http://%s/", version, *dev)
		srv := &http.Server{Addr: *dev, Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
		log.Fatal(srv.ListenAndServe())
	}

	if *stateDir == "" || *cfgPath == "" {
		log.Fatal("-state och -config krävs (eller -dev för lokal utveckling)")
	}
	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Fatal(err)
	}
	a.setUsers(cfg.Users)
	setupAI(readKey(*aiKeyFile), cfg)
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
	a.host = fqdn
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

func readKey(path string) string {
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	return strings.TrimSpace(string(b))
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
