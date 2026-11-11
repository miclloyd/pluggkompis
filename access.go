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
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
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
	case len(sg) == 1 && (sg[0] == "profiles" || sg[0] == "tests"):
		return nil // listan filtreras
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
	key := map[string]string{"profiles": "id", "tests": "profileId"}[sg[0]]
	out := []json.RawMessage{}
	for _, d := range docs {
		if own[field(d, key)] {
			out = append(out, d)
		}
	}
	return out, nil
}

// canWrite: nil = fri skrivning; restrictProfile = bara barnets profilfält.
func (s *server) canWrite(r *http.Request, p string) (restrictProfile bool, err error) {
	sg := segs(p)
	if sg[0] == "settings" {
		return false, errForbidden
	}
	if s.parentMode(r) {
		return false, nil
	}
	u := currentUser(r)
	deny := errForbidden
	if u.Role == "parent" {
		deny = errLocked
	}
	if r.Method == http.MethodDelete {
		return false, deny
	}
	var own map[string]bool
	if u.Role == "child" {
		if own, err = s.ownProfiles(r.Context(), u); err != nil {
			return false, err
		}
	}
	allowed := func(profileID string) bool { return profileID != "" && (u.Role == "parent" || own[profileID]) }
	switch {
	case sg[0] == "profiles" && len(sg) == 2:
		if _, err := s.st.Get(r.Context(), p); err != nil {
			return false, deny // nya profiler skapas bara i föräldraläget
		}
		if allowed(sg[1]) {
			return true, nil
		}
	case sg[0] == "tests" && len(sg) == 4 && childCollections[sg[2]]:
		owner, err := s.testOwner(r.Context(), sg[1])
		if err != nil {
			return false, err
		}
		if allowed(owner) {
			return false, nil
		}
	}
	return false, deny
}

// restrictedProfile: lägger bara barnets fält ovanpå den sparade profilen.
func (s *server) restrictedProfile(ctx context.Context, p string, body []byte) ([]byte, error) {
	cur, err := s.st.Get(ctx, p)
	if err != nil {
		return nil, err
	}
	var doc, in map[string]json.RawMessage
	if err := json.Unmarshal(cur, &doc); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(body, &in); err != nil || in == nil {
		return nil, errBadDoc
	}
	for k, v := range in {
		if childProfileFields[k] {
			doc[k] = v
		}
	}
	return json.Marshal(doc)
}

func accessError(w http.ResponseWriter, err error) {
	if errors.Is(err, errForbidden) || errors.Is(err, errLocked) {
		apiError(w, http.StatusForbidden, err.Error())
		return
	}
	storeError(w, err)
}
