package main

// Vem får läsa och skriva vad i dokumentlagringen.
//
//   Upplåst föräldraläge   allt (utom settings/, som inte används på servern)
//   Förälder, låst         läsa allt; skriva som ett barn (lånad iPad), för alla profiler
//   Barn                   bara sina egna profiler (profiles/{id}.account = kontots id)
//                          och deras prov; skriva svar, nivåer, hopp, samtal och
//                          provlägen samt tema och kompis på sin profil
//
// Allt annat (prov, material, mål, frågebanker, filer, nya profiler, radering)
// kräver upplåst föräldraläge.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	errForbidden = errors.New("Det här kan bara göras i föräldraläget.")
	errLocked    = errors.New("Föräldraläget är låst. Lås upp det igen.")
)

// Samlingarna under ett prov som barnet skriver när det övar.
var childCollections = map[string]bool{
	"attempts": true, "mastery": true, "events": true, "chats": true, "exams": true,
}

// Fälten på en profil som barnet själv väljer (kompisstudion, tema).
var childProfileFields = map[string]bool{
	"theme": true, "kompis": true, "updatedAt": true, "schemaVersion": true,
}

func currentUser(r *http.Request) User {
	u, _ := r.Context().Value(userKey{}).(User)
	return u
}

func (s *server) parentMode(r *http.Request) bool {
	u := currentUser(r)
	return u.Role == "parent" && s.auth.unlocked(r, u.Login)
}

func field(raw json.RawMessage, key string) string {
	var m map[string]json.RawMessage
	var v string
	if json.Unmarshal(raw, &m) == nil {
		json.Unmarshal(m[key], &v)
	}
	return v
}

// ownProfiles: profilerna som är kopplade till barnets konto.
func (s *server) ownProfiles(ctx context.Context, u User) (map[string]bool, error) {
	docs, err := s.st.List(ctx, "profiles")
	if err != nil {
		return nil, err
	}
	own := map[string]bool{}
	for _, d := range docs {
		if u.ID != "" && field(d, "account") == u.ID {
			own[field(d, "id")] = true
		}
	}
	return own, nil
}

// testOwner: provets profil ("" om provet inte finns).
func (s *server) testOwner(ctx context.Context, testID string) (string, error) {
	d, err := s.st.Get(ctx, "tests/"+testID)
	if errors.Is(err, errNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return field(d, "profileId"), nil
}

func segs(p string) []string { return strings.Split(strings.Trim(p, "/"), "/") }

func (s *server) canRead(r *http.Request, p string) error {
	sg := segs(p)
	if sg[0] == "settings" {
		return errForbidden
	}
	u := currentUser(r)
	if u.Role == "parent" {
		return nil
	}
	own, err := s.ownProfiles(r.Context(), u)
	if err != nil {
		return err
	}
	switch {
	case len(sg) == 1 && (sg[0] == "profiles" || sg[0] == "tests" || sg[0] == "tasks"):
		return nil // listan filtreras
	case sg[0] == "tasks" && len(sg) == 2:
		d, err := s.st.Get(r.Context(), p)
		if errors.Is(err, errNotFound) {
			return nil // finns inte: null
		}
		if err != nil {
			return err
		}
		if own[field(d, "profileId")] {
			return nil
		}
	case sg[0] == "profiles" && len(sg) == 2:
		if own[sg[1]] {
			return nil
		}
	case sg[0] == "tests" && len(sg) >= 2:
		owner, err := s.testOwner(r.Context(), sg[1])
		if err != nil {
			return err
		}
		if own[owner] {
			return nil
		}
	}
	return errForbidden
}

// filterList: barnet ser bara sina profiler och deras prov.
func (s *server) filterList(r *http.Request, p string, docs []json.RawMessage) ([]json.RawMessage, error) {
	u := currentUser(r)
	sg := segs(p)
	if u.Role == "parent" || len(sg) != 1 {
		return docs, nil
	}
	own, err := s.ownProfiles(r.Context(), u)
	if err != nil {
		return nil, err
	}
	key := map[string]string{"profiles": "id", "tests": "profileId", "tasks": "profileId"}[sg[0]]
	out := []json.RawMessage{}
	for _, d := range docs {
		if own[field(d, key)] {
			out = append(out, d)
		}
	}
	return out, nil
}

// Hur en skrivning utan upplåst föräldraläge begränsas.
const (
	writeFree    = ""
	writeProfile = "profile" // bara barnets profilfält
	writeTask    = "task"    // skoluppgift: ägare och stödnivå låsta
)

// canWrite: vilken begränsning skrivningen får, eller ett fel.
func (s *server) canWrite(r *http.Request, p string) (mode string, err error) {
	sg := segs(p)
	if sg[0] == "settings" {
		return "", errForbidden
	}
	if s.parentMode(r) {
		return writeFree, nil
	}
	u := currentUser(r)
	deny := errForbidden
	if u.Role == "parent" {
		deny = errLocked
	}
	if r.Method == http.MethodDelete {
		return "", deny
	}
	var own map[string]bool
	if u.Role == "child" {
		if own, err = s.ownProfiles(r.Context(), u); err != nil {
			return "", err
		}
	}
	allowed := func(profileID string) bool { return profileID != "" && (u.Role == "parent" || own[profileID]) }
	switch {
	case sg[0] == "profiles" && len(sg) == 2:
		if _, err := s.st.Get(r.Context(), p); err != nil {
			return "", deny // nya profiler skapas bara i föräldraläget
		}
		if allowed(sg[1]) {
			return writeProfile, nil
		}
	case sg[0] == "tests" && len(sg) == 4 && childCollections[sg[2]]:
		owner, err := s.testOwner(r.Context(), sg[1])
		if err != nil {
			return "", err
		}
		if allowed(owner) {
			return writeFree, nil
		}
	case sg[0] == "tasks" && len(sg) == 2:
		return writeTask, nil // ägaren kontrolleras i restrictedTask (behöver dokumentet)
	}
	return "", deny
}

// restrictedTask: barnet (eller en låst förälder) skriver en skoluppgift. Ägaren
// (profileId) och stödnivån (support, förälderns val på profilen) går inte att
// ändra; en ny uppgift får stödnivån från profilen.
func (s *server) restrictedTask(r *http.Request, p string, body []byte) ([]byte, error) {
	ctx := r.Context()
	u := currentUser(r)
	in, err := decodeObject(body)
	if err != nil {
		return nil, err
	}
	allowed := func(profileID string) (json.RawMessage, error) {
		if _, _, _, e := docPath("profiles/" + profileID); e != nil {
			return nil, errForbidden
		}
		prof, err := s.st.Get(ctx, "profiles/"+profileID)
		if err != nil {
			return nil, errForbidden
		}
		if u.Role == "child" {
			own, err := s.ownProfiles(ctx, u)
			if err != nil {
				return nil, err
			}
			if !own[profileID] {
				return nil, errForbidden
			}
		}
		return prof, nil
	}
	cur, err := s.st.Get(ctx, p)
	switch {
	case err == nil:
		var stored map[string]json.RawMessage
		if json.Unmarshal(cur, &stored) != nil || stored == nil {
			return nil, errBadDoc
		}
		var owner string
		json.Unmarshal(stored["profileId"], &owner)
		if _, err := allowed(owner); err != nil {
			return nil, err
		}
		for _, k := range []string{"profileId", "support", "createdAt", "firstAt"} {
			if v, ok := stored[k]; ok {
				in[k] = v
			} else {
				delete(in, k)
			}
		}
		if err := s.checkTaskVersions(r, owner, stored["versions"], in); err != nil {
			return nil, err
		}
	case errors.Is(err, errNotFound):
		if r.Method != http.MethodPut {
			return nil, errNotFound
		}
		var owner string
		json.Unmarshal(in["profileId"], &owner)
		prof, err := allowed(owner)
		if err != nil {
			return nil, err
		}
		var pf struct {
			TaskSupport int `json:"taskSupport"`
		}
		json.Unmarshal(prof, &pf)
		if pf.TaskSupport < 1 || pf.TaskSupport > 3 {
			pf.TaskSupport = 2
		}
		sup, _ := json.Marshal(pf.TaskSupport)
		in["support"] = sup
		if err := s.checkTaskVersions(r, owner, nil, in); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	return json.Marshal(in)
}

const (
	maxTaskRounds   = 3 // samma som MAX_ROUNDS i web/tasklogic.js
	maxTasksPerWeek = 3 // samma som TASKS_PER_WEEK
)

// checkTaskVersions: versionerna är en logg som barnet bara får lägga till i, en åt
// gången och högst maxTaskRounds; varje ny version har feedback eller är stoppad.
// En första version på en ny uppgift räknas mot veckogränsen (serverns tid).
func (s *server) checkTaskVersions(r *http.Request, owner string, storedRaw json.RawMessage, in map[string]json.RawMessage) error {
	var stored, next []json.RawMessage
	if len(storedRaw) > 0 && string(storedRaw) != "null" {
		if json.Unmarshal(storedRaw, &stored) != nil {
			return errBadDoc
		}
	}
	if v, ok := in["versions"]; ok && string(v) != "null" {
		if json.Unmarshal(v, &next) != nil {
			return errBadDoc
		}
	} else if r.Method == http.MethodPatch {
		return nil // versionerna rörs inte
	}
	if len(next) < len(stored) || len(next) > len(stored)+1 || len(next) > maxTaskRounds {
		return errForbidden
	}
	for i := range stored {
		if !jsonEqual(stored[i], next[i]) {
			return errForbidden // tidigare versioner är förälderns insyn och ändras inte
		}
	}
	if len(next) == len(stored) {
		return nil
	}
	var v struct {
		Feedback *struct {
			Strength string `json:"strength"`
		} `json:"feedback"`
		Blocked bool `json:"blocked"`
	}
	if json.Unmarshal(next[len(next)-1], &v) != nil || !(v.Blocked || (v.Feedback != nil && strings.TrimSpace(v.Feedback.Strength) != "")) {
		return errBadDoc
	}
	if len(stored) == 0 {
		// Veckan räknas från varje uppgifts första feedback (firstAt, satt här av
		// servern och låst), inte från senaste ändringen.
		now := s.st.now()
		var n int
		err := s.st.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM docs WHERE parent = 'tasks' AND path <> ?
  AND json_extract(data, '$.profileId') = ? AND json_extract(data, '$.firstAt') >= ?`,
			r.PathValue("path"), owner, now.Add(-7*24*time.Hour).UnixMilli()).Scan(&n)
		if err != nil {
			return err
		}
		if n >= maxTasksPerWeek {
			return errWeekLimit
		}
		at, _ := json.Marshal(now.UnixMilli())
		in["firstAt"] = at
	}
	return nil
}

var errWeekLimit = errors.New("Du har fått hjälp med tre uppgifter den här veckan. Nästa vecka kan du få hjälp igen.")

func jsonEqual(a, b json.RawMessage) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return string(ja) == string(jb)
}

// restrictedProfile: lägger bara barnets fält ovanpå den sparade profilen.
func (s *server) restrictedProfile(ctx context.Context, p string, body []byte) ([]byte, error) {
	cur, err := s.st.Get(ctx, p)
	if err != nil {
		return nil, err
	}
	var doc, in map[string]json.RawMessage
	if err := json.Unmarshal(cur, &doc); err != nil || doc == nil {
		return nil, errBadDoc
	}
	if err := json.Unmarshal(body, &in); err != nil || in == nil {
		return nil, errBadDoc
	}
	for k, v := range in {
		if !childProfileFields[k] {
			continue
		}
		// Oförändrat värde (hela profilen skickas vid temabyte) prövas inte igen.
		if old, ok := doc[k]; ok && bytes.Equal(old, v) {
			continue
		}
		if err := validChildField(k, v); err != nil {
			return nil, err
		}
		doc[k] = v
	}
	return json.Marshal(doc)
}

var (
	kompisColor  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	kompisAccess = map[string]bool{"inget": true, "glasogon": true, "mossa": true, "rosett": true}
	themes       = map[string]bool{"auto": true, "light": true, "dark": true}
)

// validChildField: barnets egna fält har kända former (studio.js, theme.js).
func validChildField(k string, v json.RawMessage) error {
	switch k {
	case "theme":
		var t string
		if json.Unmarshal(v, &t) != nil || !themes[t] {
			return errBadDoc
		}
	case "kompis":
		var c struct {
			Color, Accessory, Name string
		}
		var extra map[string]json.RawMessage
		if json.Unmarshal(v, &c) != nil || json.Unmarshal(v, &extra) != nil || len(extra) > 3 ||
			!kompisColor.MatchString(c.Color) || !kompisAccess[c.Accessory] ||
			c.Name == "" || utf8.RuneCountInString(c.Name) > 24 {
			return errBadDoc
		}
	case "updatedAt", "schemaVersion":
		var n float64
		if json.Unmarshal(v, &n) != nil {
			return errBadDoc
		}
	}
	return nil
}

func accessError(w http.ResponseWriter, err error) {
	if errors.Is(err, errForbidden) || errors.Is(err, errLocked) || errors.Is(err, errWeekLimit) {
		apiError(w, http.StatusForbidden, err.Error())
		return
	}
	storeError(w, err)
}

// ── barnets vy av profilen ───────────────────────────────────────────────────

// childGrade: samma regel som web/grade.js. Läsåret som börjar på hösten år Å:
// årskurs = Å − födelseår − 6 + gradeOffset, läsåret byts 1 juli.
func childGrade(birthYear, offset int, now time.Time) int {
	now = now.In(stockholm)
	start := now.Year()
	if now.Month() < time.July {
		start--
	}
	return max(0, min(9, start-birthYear-6+offset))
}

// childProfileView: barnet ser aldrig födelseår eller -månad (plan 1.6), bara
// årskursen som räknas fram ur dem.
func childProfileView(raw json.RawMessage, now time.Time) json.RawMessage {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return json.RawMessage(`{}`) // aldrig rådokumentet (fail-closed)
	}
	var by, off int
	if json.Unmarshal(m["birthYear"], &by) == nil && by > 0 {
		json.Unmarshal(m["gradeOffset"], &off)
		g, _ := json.Marshal(childGrade(by, off, now))
		m["grade"] = g
	}
	delete(m, "birthYear")
	delete(m, "birthMonth")
	delete(m, "gradeOffset")
	out, err := json.Marshal(m)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}

// forChild: profiler som barnet läser går genom childProfileView.
func (s *server) forChild(r *http.Request, p string, docs ...json.RawMessage) {
	if currentUser(r).Role != "child" {
		return
	}
	if sg := segs(p); len(sg) == 0 || sg[0] != "profiles" {
		return
	}
	for i := range docs {
		docs[i] = childProfileView(docs[i], s.st.now())
	}
}
