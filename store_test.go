package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestPaths(t *testing.T) {
	for _, p := range []string{"tests/t1", "settings/parent", "tests/t1/goals/g1"} {
		if _, _, _, err := docPath(p); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	}
	for _, p := range []string{"", "tests", "tests/t1/goals", "tests/../x", "tests/t 1", "tests//t1", "tests/t1.json", "a/b/c/d/e/f/g/h/i/j/k/l/m/n"} {
		if _, _, _, err := docPath(p); err == nil {
			t.Errorf("%q: borde nekas som dokument", p)
		}
	}
	if _, err := collPath("tests/t1/goals"); err != nil {
		t.Error(err)
	}
	if _, err := collPath("tests/t1"); err == nil {
		t.Error("tests/t1 är inte en samling")
	}
}

func TestDocs(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	if _, err := st.Get(ctx, "tests/t1"); !errors.Is(err, errNotFound) {
		t.Fatalf("tom: %v", err)
	}
	// id i dokumentet ignoreras; sökvägen bestämmer.
	if err := st.Set(ctx, "tests/t1", []byte(`{"id":"fel","subject":"SO","grade":5}`)); err != nil {
		t.Fatal(err)
	}
	raw, err := st.Get(ctx, "tests/t1")
	if err != nil {
		t.Fatal(err)
	}
	if m := decode(t, raw); m["id"] != "t1" || m["subject"] != "SO" {
		t.Fatalf("get: %v", m)
	}
	if err := st.Update(ctx, "tests/t1", []byte(`{"status":"ready","grade":6}`)); err != nil {
		t.Fatal(err)
	}
	raw, _ = st.Get(ctx, "tests/t1")
	if m := decode(t, raw); m["status"] != "ready" || m["grade"] != 6.0 || m["subject"] != "SO" {
		t.Fatalf("update: %v", m)
	}
	if err := st.Update(ctx, "tests/saknas", []byte(`{}`)); !errors.Is(err, errNotFound) {
		t.Fatalf("update saknat: %v", err)
	}
	for _, bad := range []string{`[]`, `"x"`, `null`, `{`} {
		if err := st.Set(ctx, "tests/t2", []byte(bad)); !errors.Is(err, errBadDoc) {
			t.Errorf("%s: %v", bad, err)
		}
	}

	// Listan: bara direkta barn, inte barnbarn eller syskonsamlingar.
	st.Set(ctx, "tests/t1/goals/g1", []byte(`{"order":0}`))
	st.Set(ctx, "tests/t1/goals/g2", []byte(`{"order":1}`))
	st.Set(ctx, "tests/t1/banks/g1", []byte(`{"items":[]}`))
	st.Set(ctx, "tests/t2/goals/g9", []byte(`{}`))
	list, err := st.List(ctx, "tests/t1/goals")
	if err != nil || len(list) != 2 || decode(t, list[0])["id"] != "g1" {
		t.Fatalf("list: %v %s", err, list)
	}
	tests, _ := st.List(ctx, "tests")
	if len(tests) != 1 {
		t.Fatalf("tests: %s", tests)
	}
	empty, _ := st.List(ctx, "profiles")
	if empty == nil || len(empty) != 0 {
		t.Fatal("tom samling ska vara [] (inte null)")
	}

	if err := st.Delete(ctx, "tests/t1/goals/g1"); err != nil {
		t.Fatal(err)
	}
	if list, _ := st.List(ctx, "tests/t1/goals"); len(list) != 1 {
		t.Fatal("delete")
	}
}

func TestFiles(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	id, err := st.PutFile(ctx, "application/pdf", []byte("%PDF-1.4"))
	if err != nil {
		t.Fatal(err)
	}
	typ, data, err := st.GetFile(ctx, id)
	if err != nil || typ != "application/pdf" || string(data) != "%PDF-1.4" {
		t.Fatalf("%v %s %q", err, typ, data)
	}
	if _, _, err := st.GetFile(ctx, "../etc/passwd"); !errors.Is(err, errNotFound) {
		t.Fatal(err)
	}
	st.DeleteFile(ctx, id)
	if _, _, err := st.GetFile(ctx, id); !errors.Is(err, errNotFound) {
		t.Fatal("borttagen fil finns kvar")
	}
}

// Exportfilen från artifacten ska gå att läsa in, och läsas ut i samma form
// som repo.js förväntar sig.
func TestImportExample(t *testing.T) {
	st, ctx := testStore(t), context.Background()
	if err := st.importBackup(ctx, demoBackup); err != nil {
		t.Fatal(err)
	}
	prof, err := st.Get(ctx, "profiles/pdemo01")
	if err != nil || decode(t, prof)["name"] != "Testbarn" {
		t.Fatalf("profil: %v %s", err, prof)
	}
	counts := map[string]int{"goals": 3, "banks": 3, "mastery": 3, "materials": 1, "attempts": 9, "events": 1, "chats": 2, "exams": 1}
	for coll, n := range counts {
		l, err := st.List(ctx, "tests/tdemo01/"+coll)
		if err != nil || len(l) != n {
			t.Errorf("%s: %d st, väntade %d (%v)", coll, len(l), n, err)
		}
	}
	bank, _ := st.Get(ctx, "tests/tdemo01/banks/g1")
	if items := decode(t, bank)["items"].([]any); len(items) != 4 {
		t.Fatalf("bank g1: %d frågor", len(items))
	}
	if err := st.importBackup(ctx, []byte(`{"format":"annat","version":1}`)); err == nil {
		t.Fatal("fel format ska nekas")
	}
}
