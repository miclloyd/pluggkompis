package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Sammanfattningen av exempelprovet: rätt antal svar, nivåer och provläge, och inget
// av det som inte ska med (svar, samtal, material, PIN).
func TestProgressSummary(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	if err := st.importBackup(ctx, demoBackup); err != nil {
		t.Fatal(err)
	}
	if err := st.Set(ctx, "tasks/tk1", []byte(`{"profileId":"pdemo01","title":"Uppsats","draft":"hemlig text"}`)); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sum.json")
	now := time.Date(2026, 11, 14, 12, 0, 0, 0, stockholm)
	if err := writeSummary(ctx, st, path, now); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm() != 0o600 {
		t.Errorf("rättigheter %v, väntade 0600", fi.Mode().Perm())
	}
	var s progressSummary
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatal(err)
	}
	if s.Schema != summarySchema || len(s.Profiles) != 1 {
		t.Fatalf("schema/profiler: %s %d", s.Schema, len(s.Profiles))
	}
	p := s.Profiles[0]
	answers := 0
	for _, d := range p.Days {
		answers += d.Answers
		if d.Right+d.Almost+d.Wrong != d.Answers || d.Minutes < 1 {
			t.Errorf("dag %+v", d)
		}
	}
	if answers != 9 || p.Tasks != 1 || len(p.Tests) != 1 {
		t.Fatalf("svar %d, uppgifter %d, prov %d", answers, p.Tasks, len(p.Tests))
	}
	tst := p.Tests[0]
	if len(tst.Goals) != 3 || len(tst.Exams) != 1 || tst.FirstPractice == "" {
		t.Fatalf("prov: %+v", tst)
	}
	// Dagar äldre än 28 dagar räknas inte per dag, men finns kvar per mål.
	old := now.AddDate(0, 0, 40)
	sum, err := buildSummary(ctx, st, old)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Profiles[0].Days) != 0 || sum.Profiles[0].Tests[0].Goals[0].Answers == 0 {
		t.Errorf("gamla dagar: %+v", sum.Profiles[0])
	}
	for _, bad := range []string{`"answer"`, "hemlig text", "salt", "pinHash", `"chats"`, `"pages"`} {
		if strings.Contains(string(raw), bad) {
			t.Errorf("sammanfattningen innehåller %s", bad)
		}
	}
}

func TestMinutesOn(t *testing.T) {
	// Första svaret 20 s, sedan 30 s + 60 s i följd, sedan en lång paus (20 s) = 130 s ≈ 2 min.
	if m := minutesOn([]num{0, 30_000, 90_000, 1_000_000}); m != 2 {
		t.Errorf("minuter %d, väntade 2", m)
	}
}

// Tom databas: listor, inte null.
func TestProgressSummaryEmpty(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	sum, err := buildSummary(ctx, st, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(sum)
	if !strings.Contains(string(b), `"profiles":[]`) {
		t.Errorf("tom databas: %s", b)
	}
}

// Svar utan profileId räknas på provets barn; tal som strängar eller decimaler fäller inte
// posten; okänd dom räknas för sig; dygnen räknas i svensk tid över sommartidsbytet.
func TestProgressSummaryEdges(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	set := func(p, v string) {
		t.Helper()
		if err := st.Set(ctx, p, []byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	set("profiles/p1", `{"name":"A","birthYear":"2016","createdAt":1,"schedule":{"trainingDays":[0,2],"training":[15,30],"free":[20,60],"extra":"nej"}}`)
	set("tests/t1", `{"profileId":"p1","subject":"SO","testDate":"2026-11-02","grade":"4"}`)
	set("tests/t1/goals/g1", `{"text":"Mål","type":"fakta","weight":2.0,"order":"1"}`)
	set("tests/t1/mastery/g1", `{"goalId":"g1","level":2.0,"lastPracticed":1792000000000}`)
	// Natten till sommartidens slut: 23:30 UTC = 01:30 CEST den 25:e, 21:00 UTC = 23:00 CEST den 24:e.
	at := func(utc string) int64 { tt, _ := time.Parse(time.RFC3339, utc); return tt.UnixMilli() }
	set("tests/t1/attempts/a1", fmt.Sprintf(`{"goalId":"g1","score":1,"verdict":"right","ts":%d}`, at("2026-10-24T23:30:00Z")))
	set("tests/t1/attempts/a2", fmt.Sprintf(`{"goalId":"g1","score":"0.5","verdict":"","ts":%d}`, at("2026-10-24T21:00:00Z")))
	set("tests/t1/attempts/a3", `{"goalId":"g1","score":"NaN","verdict":"wrong"}`) // utan tid, NaN-poäng
	set("tests/t1/exams/x1", `{"ts":"inte ett tal","points":"Inf","max":3,"items":"fel typ"}`)
	set("tests/t1/goals/g2", `{"text":["fel typ"]}`) // går inte att avkoda: räknas i skipped
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	sum, err := buildSummary(ctx, st, now)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Skipped != 1 || len(sum.Profiles) != 1 {
		t.Fatalf("skipped %d, profiler %d", sum.Skipped, len(sum.Profiles))
	}
	p := sum.Profiles[0]
	if p.BirthYear != 2016 || p.Schedule == nil || len(p.Schedule.Free) != 2 || p.Schedule.Free[1] != 60 {
		t.Errorf("profil: %+v %+v", p, p.Schedule)
	}
	b, err := json.Marshal(sum)
	if err != nil {
		t.Fatal(err) // NaN/Inf får aldrig nå filen
	}
	if strings.Contains(string(b), "extra") {
		t.Error("okänt fält i schedule följde med")
	}
	if len(p.Days) != 2 || p.Days[0].Date != "2026-10-25" || p.Days[1].Date != "2026-10-24" {
		t.Fatalf("dagar: %+v", p.Days)
	}
	if p.Days[0].Right != 1 || p.Days[1].Other != 1 {
		t.Errorf("domar: %+v", p.Days)
	}
	g := p.Tests[0].Goals[0]
	if p.Tests[0].Grade != 4 || g.Weight != 2 || g.Level != 2 || g.Answers != 3 || g.Score != 0.5 || p.Tests[0].FirstPractice != "2026-10-24" {
		t.Errorf("mål: %+v prov %+v", g, p.Tests[0])
	}
}
