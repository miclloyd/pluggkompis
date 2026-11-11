package main

// Lagringen: samma dokumentmodell som artifactens db (web/repo.js). Ett dokument
// har en sökväg med jämnt antal segment (tests/t1), en samling udda
// (tests/t1/goals). Allt ligger i en SQLite-fil, även uppladdade filer, så att
// en VACUUM INTO-kopia är hela säkerhetskopian.

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	maxDocBytes  = 8 << 20  // ett dokument (material med sidtext, frågebanker)
	maxFileBytes = 25 << 20 // en uppladdad fil (PDF, foto, Word)
)

var (
	errNotFound = errors.New("finns inte")
	errBadPath  = errors.New("ogiltig sökväg")
	errBadDoc   = errors.New("dokumentet måste vara ett JSON-objekt")
	errTooLarge = errors.New("för stort")
)

var segment = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

// splitPath kontrollerar en sökväg och returnerar segmenten.
func splitPath(p string) ([]string, error) {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil, errBadPath
	}
	segs := strings.Split(p, "/")
	if len(segs) > 12 {
		return nil, errBadPath
	}
	for _, s := range segs {
		if !segment.MatchString(s) {
			return nil, errBadPath
		}
	}
	return segs, nil
}

// docPath: ett dokument (jämnt antal segment). Returnerar sökväg och förälder.
func docPath(p string) (path, parent, id string, err error) {
	segs, err := splitPath(p)
	if err != nil || len(segs)%2 != 0 {
		return "", "", "", errBadPath
	}
	return strings.Join(segs, "/"), strings.Join(segs[:len(segs)-1], "/"), segs[len(segs)-1], nil
}

// collPath: en samling (udda antal segment).
func collPath(p string) (string, error) {
	segs, err := splitPath(p)
	if err != nil || len(segs)%2 != 1 {
		return "", errBadPath
	}
	return strings.Join(segs, "/"), nil
}

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func openStore(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// En skrivare åt gången räcker för en familj; undviker SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS docs (
  path       TEXT PRIMARY KEY,
  parent     TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);`)
	return err
}

// decodeObject kräver ett JSON-objekt och returnerar det utan fältet id
// (id är alltid sökvägens sista segment och läggs till vid läsning).
func decodeObject(raw []byte) (map[string]json.RawMessage, error) {
	if len(raw) > maxDocBytes {
		return nil, errTooLarge
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, errBadDoc
	}
	delete(m, "id")
	return m, nil
}

func withID(id string, data []byte) (json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	idj, _ := json.Marshal(id)
	m["id"] = idj
	return json.Marshal(m)
}

func (s *Store) Get(ctx context.Context, p string) (json.RawMessage, error) {
	path, _, id, err := docPath(p)
	if err != nil {
		return nil, err
	}
	var data []byte
	err = s.db.QueryRowContext(ctx, `SELECT data FROM docs WHERE path = ?`, path).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	return withID(id, data)
}

// Set ersätter hela dokumentet.
func (s *Store) Set(ctx context.Context, p string, raw []byte) error {
	path, parent, _, err := docPath(p)
	if err != nil {
		return err
	}
	m, err := decodeObject(raw)
	if err != nil {
		return err
	}
	data, _ := json.Marshal(m)
	_, err = s.db.ExecContext(ctx, `INSERT INTO docs (path, parent, data, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		path, parent, data, s.now().UnixMilli())
	return err
}

// Update slår ihop fälten på översta nivån (som artifactens db.update).
// Dokumentet måste finnas.
func (s *Store) Update(ctx context.Context, p string, raw []byte) error {
	path, _, _, err := docPath(p)
	if err != nil {
		return err
	}
	patch, err := decodeObject(raw)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var cur []byte
	err = tx.QueryRowContext(ctx, `SELECT data FROM docs WHERE path = ?`, path).Scan(&cur)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(cur, &m); err != nil {
		return err
	}
	for k, v := range patch {
		m[k] = v
	}
	data, _ := json.Marshal(m)
	if len(data) > maxDocBytes {
		return errTooLarge
	}
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET data = ?, updated_at = ? WHERE path = ?`,
		data, s.now().UnixMilli(), path); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Delete(ctx context.Context, p string) error {
	path, _, _, err := docPath(p)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM docs WHERE path = ?`, path)
	return err
}

// List returnerar samlingens direkta dokument, utan tak (artifacten hade 1000).
func (s *Store) List(ctx context.Context, p string) ([]json.RawMessage, error) {
	coll, err := collPath(p)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT path, data FROM docs WHERE parent = ? ORDER BY path`, coll)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var path string
		var data []byte
		if err := rows.Scan(&path, &data); err != nil {
			return nil, err
		}
		d, err := withID(path[strings.LastIndexByte(path, '/')+1:], data)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Empty: inga dokument alls (demoläget fyller bara en tom databas).
func (s *Store) Empty(ctx context.Context) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM docs`).Scan(&n)
	return n == 0, err
}

// ── filer ────────────────────────────────────────────────────────────────────

var fileID = regexp.MustCompile(`^f[0-9a-f]{32}$`)

func (s *Store) PutFile(ctx context.Context, typ string, data []byte) (string, error) {
	if len(data) > maxFileBytes {
		return "", errTooLarge
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id := "f" + hex.EncodeToString(b)
	_, err := s.db.ExecContext(ctx, `INSERT INTO files (id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, typ, len(data), data, s.now().UnixMilli())
	return id, err
}

func (s *Store) GetFile(ctx context.Context, id string) (typ string, data []byte, err error) {
	if !fileID.MatchString(id) {
		return "", nil, errNotFound
	}
	err = s.db.QueryRowContext(ctx, `SELECT type, data FROM files WHERE id = ?`, id).Scan(&typ, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, errNotFound
	}
	return typ, data, err
}

func (s *Store) DeleteFile(ctx context.Context, id string) error {
	if !fileID.MatchString(id) {
		return errNotFound
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM files WHERE id = ?`, id)
	return err
}

// ── säkerhetskopian (format pluggkompis-backup, version 1) ───────────────────

// importBackup lägger in ett prov från en exportfil (print.js → backupJson).
// Används av demoläget; den riktiga importen (med sidbilder) är ett eget steg.
func (s *Store) importBackup(ctx context.Context, raw []byte) error {
	var b struct {
		Format    string                     `json:"format"`
		Version   int                        `json:"version"`
		Test      map[string]json.RawMessage `json:"test"`
		Profile   map[string]json.RawMessage `json:"profile"`
		Goals     []map[string]json.RawMessage
		Banks     map[string]json.RawMessage
		Mastery   map[string]json.RawMessage
		Materials []map[string]json.RawMessage
		Attempts  []map[string]json.RawMessage
		Events    []map[string]json.RawMessage
		Chats     []map[string]json.RawMessage
		Exams     []map[string]json.RawMessage
	}
	if err := json.Unmarshal(raw, &b); err != nil {
		return err
	}
	if b.Format != "pluggkompis-backup" || b.Version != 1 {
		return fmt.Errorf("okänt format %q version %d", b.Format, b.Version)
	}
	str := func(m map[string]json.RawMessage, k string) string {
		var v string
		json.Unmarshal(m[k], &v)
		return v
	}
	put := func(path string, m map[string]json.RawMessage) error {
		data, _ := json.Marshal(m)
		return s.Set(ctx, path, data)
	}
	tid := str(b.Test, "id")
	if _, _, _, err := docPath("tests/" + tid); err != nil {
		return fmt.Errorf("provets id: %w", err)
	}
	if b.Profile != nil {
		pid := str(b.Test, "profileId")
		b.Profile["createdAt"] = b.Test["createdAt"]
		if err := put("profiles/"+pid, b.Profile); err != nil {
			return err
		}
	}
	if err := put("tests/"+tid, b.Test); err != nil {
		return err
	}
	lists := map[string][]map[string]json.RawMessage{
		"goals": b.Goals, "materials": b.Materials, "attempts": b.Attempts,
		"events": b.Events, "chats": b.Chats, "exams": b.Exams,
	}
	for coll, docs := range lists {
		for _, d := range docs {
			if err := put("tests/"+tid+"/"+coll+"/"+str(d, "id"), d); err != nil {
				return fmt.Errorf("%s: %w", coll, err)
			}
		}
	}
	for gid, items := range b.Banks {
		if err := put("tests/"+tid+"/banks/"+gid, map[string]json.RawMessage{"items": items}); err != nil {
			return err
		}
	}
	for gid, m := range b.Mastery {
		if err := s.Set(ctx, "tests/"+tid+"/mastery/"+gid, m); err != nil {
			return err
		}
	}
	return nil
}
