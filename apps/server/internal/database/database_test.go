package database

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"testing/fstest"
)

func openTest(t *testing.T) *sql.DB {
	t.Helper()
	db, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func TestMigrationFromEmptyAndIdempotent(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	for range 2 {
		if err := Migrate(ctx, db); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 6 {
		t.Fatalf("count=%d, err=%v", count, err)
	}
	var initialized string
	if err := db.QueryRow("SELECT value FROM application_metadata WHERE key='initialized_at'").Scan(&initialized); err != nil || initialized == "" {
		t.Fatalf("bootstrap missing: %v", err)
	}
	var enabled int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("foreign keys disabled: %v", err)
	}
}
func TestPersistenceAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "含 空格", "factory.db")
	ctx := context.Background()
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := db.QueryRow("SELECT value FROM application_metadata").Scan(&before); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := db.QueryRow("SELECT value FROM application_metadata").Scan(&after); err != nil || before != after {
		t.Fatalf("data not persisted: %v", err)
	}
}
func TestMigrationRollsBackFailure(t *testing.T) {
	db := openTest(t)
	source := fstest.MapFS{"migrations/001_test.sql": {Data: []byte("CREATE TABLE transient (id INTEGER); INSERT INTO missing VALUES (1);")}}
	if err := migrate(context.Background(), db, source); err == nil {
		t.Fatal("expected failure")
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name IN ('transient', 'schema_migrations')").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial migration committed: %d %v", count, err)
	}
}
func TestMigrationRejectsModifiedAndUnknown(t *testing.T) {
	for _, changed := range []bool{true, false} {
		db := openTest(t)
		ctx := context.Background()
		if err := Migrate(ctx, db); err != nil {
			t.Fatal(err)
		}
		var source fstest.MapFS
		if changed {
			source = fstest.MapFS{"migrations/001_bootstrap.sql": {Data: []byte("SELECT 1;")}}
		} else {
			source = fstest.MapFS{}
		}
		if err := migrate(ctx, db, source); err == nil {
			t.Fatal("expected mismatch failure")
		}
	}
}

func TestConcurrentMigrationStartup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "concurrent.db")
	ctx := context.Background()
	first, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	var workers sync.WaitGroup
	errors := make(chan error, 2)
	for _, db := range []*sql.DB{first, second} {
		workers.Add(1)
		go func() { defer workers.Done(); errors <- Migrate(ctx, db) }()
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := first.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 6 {
		t.Fatalf("duplicate migrations: %d %v", count, err)
	}
}

func TestStageOneDatabaseUpgrade(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	initial, err := migrations.ReadFile("migrations/001_bootstrap.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db, fstest.MapFS{"migrations/001_bootstrap.sql": {Data: initial}}); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := db.QueryRow("SELECT value FROM application_metadata").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := db.QueryRow("SELECT value FROM application_metadata").Scan(&after); err != nil || after != before {
		t.Fatal("upgrade changed existing metadata")
	}
	var users int
	if err := db.QueryRow("SELECT count(*) FROM users").Scan(&users); err != nil || users != 0 {
		t.Fatalf("account schema not created: %v", err)
	}
}
