// Framstegssammanfattning för driften: en fil med det en förälder ser i föräldraläget,
// i kort form, så att driftverktyg kan läsa framstegen utan att få databasen.
//
// Med -progress-summary skriver tjänsten filen vid start och sedan var tionde minut
// (atomiskt: tmp + rename, 0600). Med bara: profiler (namn, födelseår, schema),
// övningstid och svar per dag de senaste 28 dagarna, prov med mål och nivåer,
// provlägen och antal skoluppgifter. Utan: barnens svar, samtal, material, filer,
// PIN och AI-användning.
package main

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	summarySchema   = "pluggkompis-progress/1"
	summaryDays     = 28
	summaryInterval = 10 * time.Minute
)

// num: ett tal i ett dokument. Webben sparar ibland tal som strängar (formulärfält) eller
// decimaltal; ett sådant fält ska inte göra att hela posten faller bort. Annat blir 0.
type num float64

func (n *num) UnmarshalJSON(b []byte) error {
	var f float64
	if json.Unmarshal(b, &f) == nil {
		*n = num(f)
		return nil
	}
	var str string
	if json.Unmarshal(b, &str) == nil {
		if f, err := strconv.ParseFloat(strings.TrimSpace(str), 64); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			*n = num(f)
			return nil
		}
	}
	*n = 0
	return nil
}

func (n num) int() int { return int(math.Round(float64(n))) }

var typeMax = map[string]int{"begrepp": 3, "fakta": 3, "glosa": 4, "samband": 5, "resonemang": 5, "matematik": 4} // = TYPE_MAX i web/engine.js

type summaryDay struct {
	Date    string  `json:"date"`
	Minutes int     `json:"minutes"`
	Answers int     `json:"answers"`
	Right   int     `json:"right"`
	Almost  int     `json:"almost"`
	Wrong   int     `json:"wrong"`
	Other   int     `json:"other,omitempty"` // tom eller okänd dom
	Score   float64 `json:"score"`           // medel av poängen (0–1)
}

type summaryGoal struct {
	Text          string  `json:"text"`
	Type          string  `json:"type,omitempty"`
	Weight        int     `json:"weight,omitempty"`
	Level         int     `json:"level"` // 0 = inte övat än
	MaxLevel      int     `json:"maxLevel"`
	PassedMax     bool    `json:"passedMax"`
	Answers       int     `json:"answers"`
	Score         float64 `json:"score"` // medel av poängen på alla svar
	LastPracticed string  `json:"lastPracticed,omitempty"`
}

type summaryExam struct {
	Date   string  `json:"date,omitempty"`
	Points float64 `json:"points"`
	Max    int     `json:"max"`
}

type summaryTest struct {
	Subject       string        `json:"subject"`
	TestDate      string        `json:"testDate,omitempty"`
	Grade         int           `json:"grade,omitempty"`
	Status        string        `json:"status,omitempty"`
	Reviewed      *bool         `json:"reviewed,omitempty"`
	OffDates      []string      `json:"offDates,omitempty"`
	FirstPractice string        `json:"firstPractice,omitempty"`
	Goals         []summaryGoal `json:"goals"`
	Exams         []summaryExam `json:"exams,omitempty"`
}

// Schemat för dagsplanen (profile.schedule): träningsdagar (0 = måndag) och minuter
// [min, max] på träningsdagar respektive lediga dagar. nil = appens standard.
type summarySchedule struct {
	TrainingDays []int `json:"trainingDays"`
	Training     []int `json:"training"`
	Free         []int `json:"free"`
}

type summaryProfile struct {
	Name      string           `json:"name"`
	BirthYear int              `json:"birthYear,omitempty"`
	Schedule  *summarySchedule `json:"schedule,omitempty"`
	Days      []summaryDay     `json:"days"` // de senaste 28 dagarna, nyaste först, bara dagar med svar
	Tests     []summaryTest    `json:"tests"`
	Tasks     int              `json:"tasks"` // egna skoluppgifter
}

type progressSummary struct {
	Schema      string           `json:"schema"`
	Version     string           `json:"version"`
	GeneratedAt string           `json:"generatedAt"`
	Note        string           `json:"note"`
	Skipped     int              `json:"skipped,omitempty"` // dokument som inte gick att läsa
	Profiles    []summaryProfile `json:"profiles"`
}

type rawAttempt struct {
	ProfileID string `json:"profileId"`
	GoalID    string `json:"goalId"`
	Score     num    `json:"score"`
	Verdict   string `json:"verdict"`
	TS        num    `json:"ts"`
}

func listAs[T any](ctx context.Context, st *Store, coll string, skipped *int) ([]T, error) {
	raws, err := st.List(ctx, coll)
	if err != nil {
		return nil, err
	}
	out := make([]T, 0, len(raws))
	for _, r := range raws {
		var v T
		if json.Unmarshal(r, &v) == nil {
			out = append(out, v)
		} else {
			*skipped++
		}
	}
	return out, nil
}

func dayOf(ms num) string { return time.UnixMilli(int64(ms)).In(stockholm).Format("2006-01-02") }

// minutesOn räknar som minutesOnDay i web/plan.js: tiden mellan svar i följd (< 3 min),
// annars 20 s per svar.
func minutesOn(ts []num) int {
	sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })
	sec := 0.0
	for i := range ts {
		if i > 0 && float64(ts[i]-ts[i-1])/1000 < 180 {
			sec += float64(ts[i]-ts[i-1]) / 1000
		} else {
			sec += 20
		}
	}
	return int(sec/60 + 0.5)
}

func round2(x float64) float64 { return float64(int(x*100+0.5)) / 100 }

func buildSummary(ctx context.Context, st *Store, now time.Time) (*progressSummary, error) {
	type profile struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		BirthYear num    `json:"birthYear"`
		Schedule  *struct {
			TrainingDays []num `json:"trainingDays"`
			Training     []num `json:"training"`
			Free         []num `json:"free"`
		} `json:"schedule"`
		CreatedAt num `json:"createdAt"`
	}
	type test struct {
		ID        string   `json:"id"`
		ProfileID string   `json:"profileId"`
		Subject   string   `json:"subject"`
		TestDate  string   `json:"testDate"`
		Grade     num      `json:"grade"`
		Status    string   `json:"status"`
		Reviewed  *bool    `json:"reviewed"`
		OffDates  []string `json:"offDates"`
	}
	type goal struct {
		ID      string `json:"id"`
		Text    string `json:"text"`
		Type    string `json:"type"`
		Weight  num    `json:"weight"`
		Order   num    `json:"order"`
		Removed bool   `json:"removed"`
	}
	type bank struct {
		ID    string `json:"id"`
		Items []struct {
			Level num `json:"level"`
		} `json:"items"`
	}
	type mastery struct {
		GoalID        string `json:"goalId"`
		Level         num    `json:"level"`
		PassedMax     bool   `json:"passedMax"`
		LastPracticed num    `json:"lastPracticed"`
	}
	type exam struct {
		ProfileID string `json:"profileId"`
		TS        num    `json:"ts"`
		Points    num    `json:"points"`
		Max       num    `json:"max"`
	}
	type task struct {
		ProfileID string `json:"profileId"`
	}

	skipped := 0
	profiles, err := listAs[profile](ctx, st, "profiles", &skipped)
	if err != nil {
		return nil, err
	}
	sort.Slice(profiles, func(i, j int) bool { return profiles[i].CreatedAt < profiles[j].CreatedAt })
	tests, err := listAs[test](ctx, st, "tests", &skipped)
	if err != nil {
		return nil, err
	}
	sort.Slice(tests, func(i, j int) bool { return tests[i].TestDate < tests[j].TestDate })
	tasks, err := listAs[task](ctx, st, "tasks", &skipped)
	if err != nil {
		return nil, err
	}

	since := now.In(stockholm).AddDate(0, 0, -(summaryDays - 1)).Format("2006-01-02")
	dayTS := map[string]map[string][]num{} // profil → dag → svarens tider
	dayAgg := map[string]map[string]*summaryDay{}
	testsBy := map[string][]summaryTest{}

	for _, t := range tests {
		coll := "tests/" + t.ID
		goals, err := listAs[goal](ctx, st, coll+"/goals", &skipped)
		if err != nil {
			return nil, err
		}
		banks, err := listAs[bank](ctx, st, coll+"/banks", &skipped)
		if err != nil {
			return nil, err
		}
		mast, err := listAs[mastery](ctx, st, coll+"/mastery", &skipped)
		if err != nil {
			return nil, err
		}
		atts, err := listAs[rawAttempt](ctx, st, coll+"/attempts", &skipped)
		if err != nil {
			return nil, err
		}
		exams, err := listAs[exam](ctx, st, coll+"/exams", &skipped)
		if err != nil {
			return nil, err
		}
		top := map[string]int{}
		for _, b := range banks {
			for _, it := range b.Items {
				top[b.ID] = max(top[b.ID], it.Level.int())
			}
		}
		mBy := map[string]mastery{}
		for _, m := range mast {
			mBy[m.GoalID] = m
		}
		type acc struct {
			n     int
			score float64
		}
		perGoal := map[string]*acc{}
		first := ""
		for _, a := range atts {
			pid := a.ProfileID
			if pid == "" {
				pid = t.ProfileID
			}
			g := perGoal[a.GoalID]
			if g == nil {
				g = &acc{}
				perGoal[a.GoalID] = g
			}
			g.n++
			g.score += float64(a.Score)
			if a.TS <= 0 {
				continue // utan tid: räknas per mål men inte per dag
			}
			d := dayOf(a.TS)
			if first == "" || d < first {
				first = d
			}
			if d < since {
				continue
			}
			if dayTS[pid] == nil {
				dayTS[pid], dayAgg[pid] = map[string][]num{}, map[string]*summaryDay{}
			}
			dayTS[pid][d] = append(dayTS[pid][d], a.TS)
			sd := dayAgg[pid][d]
			if sd == nil {
				sd = &summaryDay{Date: d}
				dayAgg[pid][d] = sd
			}
			sd.Answers++
			sd.Score += float64(a.Score)
			switch a.Verdict {
			case "right":
				sd.Right++
			case "almost":
				sd.Almost++
			case "wrong":
				sd.Wrong++
			default:
				sd.Other++
			}
		}

		sort.Slice(goals, func(i, j int) bool { return goals[i].Order < goals[j].Order })
		out := summaryTest{Subject: t.Subject, TestDate: t.TestDate, Grade: t.Grade.int(), Status: t.Status, Reviewed: t.Reviewed, OffDates: t.OffDates, FirstPractice: first, Goals: []summaryGoal{}}
		for _, g := range goals {
			if g.Removed {
				continue
			}
			mx := typeMax[g.Type]
			if mx == 0 {
				mx = 3
			}
			if top[g.ID] > 0 {
				mx = max(1, min(mx, top[g.ID]))
			}
			sg := summaryGoal{Text: g.Text, Type: g.Type, Weight: g.Weight.int(), MaxLevel: mx}
			if m, ok := mBy[g.ID]; ok {
				sg.Level, sg.PassedMax = m.Level.int(), m.PassedMax
				if m.LastPracticed > 0 {
					sg.LastPracticed = dayOf(m.LastPracticed)
				}
			}
			if a := perGoal[g.ID]; a != nil {
				sg.Answers, sg.Score = a.n, round2(a.score/float64(a.n))
			}
			out.Goals = append(out.Goals, sg)
		}
		sort.Slice(exams, func(i, j int) bool { return exams[i].TS < exams[j].TS })
		for _, x := range exams {
			date := ""
			if x.TS > 0 {
				date = dayOf(x.TS)
			}
			out.Exams = append(out.Exams, summaryExam{Date: date, Points: float64(x.Points), Max: x.Max.int()})
		}
		testsBy[t.ProfileID] = append(testsBy[t.ProfileID], out)
	}

	sum := &progressSummary{
		Schema: summarySchema, Version: version, GeneratedAt: now.In(stockholm).Format(time.RFC3339),
		Note:     "Minuter räknas som appens dagsplan (tid mellan svar i följd). Nivå 0 = målet inte övat än.",
		Profiles: []summaryProfile{},
		Skipped:  skipped,
	}
	for _, p := range profiles {
		sp := summaryProfile{Name: p.Name, BirthYear: p.BirthYear.int(), Days: []summaryDay{}, Tests: testsBy[p.ID]}
		if p.Schedule != nil {
			ints := func(l []num) []int {
				out := make([]int, 0, len(l))
				for _, n := range l {
					out = append(out, n.int())
				}
				return out
			}
			sp.Schedule = &summarySchedule{TrainingDays: ints(p.Schedule.TrainingDays), Training: ints(p.Schedule.Training), Free: ints(p.Schedule.Free)}
		}
		if sp.Tests == nil {
			sp.Tests = []summaryTest{}
		}
		for d, sd := range dayAgg[p.ID] {
			sd.Minutes = minutesOn(dayTS[p.ID][d])
			sd.Score = round2(sd.Score / float64(sd.Answers))
			sp.Days = append(sp.Days, *sd)
		}
		sort.Slice(sp.Days, func(i, j int) bool { return sp.Days[i].Date > sp.Days[j].Date })
		for _, t := range tasks {
			if t.ProfileID == p.ID {
				sp.Tasks++
			}
		}
		sum.Profiles = append(sum.Profiles, sp)
	}
	return sum, nil
}

func writeSummary(ctx context.Context, st *Store, path string, now time.Time) error {
	sum, err := buildSummary(ctx, st, now)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(sum, "", " ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".progress-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path) // CreateTemp ger redan 0600
}

func runSummary(st *Store, path string) {
	for {
		if err := writeSummary(context.Background(), st, path, time.Now()); err != nil {
			log.Printf("framstegssammanfattning: %v", err)
		}
		time.Sleep(summaryInterval)
	}
}
