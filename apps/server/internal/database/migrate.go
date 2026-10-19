package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
)

//go:embed migrations/*.sql
var migrations embed.FS

func Migrate(ctx context.Context, db *sql.DB) error { return migrate(ctx, db, migrations) }

func migrate(ctx context.Context, db *sql.DB, source fs.FS) error {
	// Reserve the writer before reading migration state, including on simultaneous startup.
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`); err != nil {
		return err
	}
	files, err := fs.Glob(source, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	known := make(map[string]string)
	for _, name := range files {
		content, err := fs.ReadFile(source, name)
		if err != nil {
			return err
		}
		known[name] = fmt.Sprintf("%x", sha256.Sum256(content))
	}
	rows, err := conn.QueryContext(ctx, "SELECT name, checksum FROM schema_migrations ORDER BY name")
	if err != nil {
		return err
	}
	applied := make(map[string]bool)
	for rows.Next() {
		var name, checksum string
		if err := rows.Scan(&name, &checksum); err != nil {
			rows.Close()
			return err
		}
		if expected, ok := known[name]; !ok || expected != checksum {
			rows.Close()
			return fmt.Errorf("migration %s is missing or has changed; refusing startup", name)
		}
		applied[name] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, name := range files {
		if applied[name] {
			continue
		}
		content, _ := fs.ReadFile(source, name)
		if _, err := conn.ExecContext(ctx, string(content)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)", name, known[name]); err != nil {
			return err
		}
	}
	_, err = conn.ExecContext(ctx, "COMMIT")
	return err
}
