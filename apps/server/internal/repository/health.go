package repository

import (
	"context"
	"database/sql"
)

type Health struct{ db *sql.DB }

func NewHealth(db *sql.DB) *Health { return &Health{db: db} }
func (r *Health) Check(ctx context.Context) error {
	var value string
	return r.db.QueryRowContext(ctx, "SELECT value FROM application_metadata WHERE key = 'initialized_at'").Scan(&value)
}
