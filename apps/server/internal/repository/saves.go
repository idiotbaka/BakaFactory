package repository

import (
	"bakafactory/server/internal/domain"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type Saves struct{ db *sql.DB }

func NewSaves(db *sql.DB) *Saves { return &Saves{db: db} }

// Session ownership is checked INSIDE the same transaction as the save. A login
// revocation and an upload cannot interleave to let a kicked device write later.
func saveOwner(ctx context.Context, tx *sql.Tx, hash string, now int64) (string, error) {
	var owner string
	err := tx.QueryRowContext(ctx, "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?", hash, now).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", domain.ErrUnauthenticated
	}
	return owner, err
}
func readCloud(ctx context.Context, tx *sql.Tx, owner string) (*domain.CloudSave, error) {
	var result domain.CloudSave
	var raw string
	err := tx.QueryRowContext(ctx, "SELECT version,saved_at,state FROM cloud_saves WHERE owner_id=?", owner).Scan(&result.Version, &result.SavedAt, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(raw), &result.Save); err != nil {
		return nil, err
	}
	return &result, nil
}
func (r *Saves) Get(ctx context.Context, hash string, now int64) (*domain.CloudSave, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	owner, err := saveOwner(ctx, tx, hash, now)
	if err != nil {
		return nil, err
	}
	result, err := readCloud(ctx, tx, owner)
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}
func (r *Saves) Put(ctx context.Context, hash string, now int64, savedAt string, base int64, save domain.GameSave) (*domain.CloudSave, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	owner, err := saveOwner(ctx, tx, hash, now)
	if err != nil {
		return nil, err
	}
	if save.Factory.OwnerID != owner {
		return nil, domain.ErrUnauthenticated
	}
	current, err := readCloud(ctx, tx, owner)
	if err != nil {
		return nil, err
	}
	version := int64(0)
	if current != nil {
		version = current.Version
	}
	if version != base || version >= domain.MaxSafeInteger {
		return nil, domain.ErrSaveConflict
	}
	raw, err := json.Marshal(save)
	if err != nil {
		return nil, err
	}
	result := &domain.CloudSave{Version: version + 1, SavedAt: savedAt, Save: save}
	_, err = tx.ExecContext(ctx, "INSERT INTO cloud_saves(owner_id,version,saved_at,state) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET version=excluded.version,saved_at=excluded.saved_at,state=excluded.state", owner, result.Version, result.SavedAt, string(raw))
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}
