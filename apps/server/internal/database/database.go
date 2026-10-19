package database

import (
	"context"
	"database/sql"
	"fmt"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
)

func Open(ctx context.Context, path string) (*sql.DB, error) {
	var dsn string
	if path == ":memory:" {
		dsn = ":memory:"
	} else {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
			return nil, err
		}
		dsn = (&url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(absolute)}).String()
		if filepath.IsAbs(absolute) && filepath.VolumeName(absolute) == "" {
			dsn = (&url.URL{Scheme: "file", Path: absolute}).String()
		}
	}
	dsn += "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One writer connection keeps SQLite transactions predictable at this stage.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("open database: %w", err)
	}
	return db, nil
}
