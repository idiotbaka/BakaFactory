package repository

import (
	"bakafactory/server/internal/domain"
	"context"
	"database/sql"
	"errors"
	"modernc.org/sqlite"
)

type Accounts struct{ db *sql.DB }

func NewAccounts(db *sql.DB) *Accounts { return &Accounts{db: db} }
func (r *Accounts) Find(ctx context.Context, username string) (domain.Account, error) {
	var account domain.Account
	err := r.db.QueryRowContext(ctx, `SELECT id,username,display_name,created_at,last_login_at,password_hash FROM users WHERE username = ?`, username).Scan(&account.ID, &account.Username, &account.DisplayName, &account.CreatedAt, &account.LastLoginAt, &account.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return account, domain.ErrCredentials
	}
	return account, err
}
func (r *Accounts) Create(ctx context.Context, account domain.Account, session domain.Session, oldHash string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO users(id,username,display_name,created_at,last_login_at,password_hash) VALUES(?,?,?,?,?,?)`, account.ID, account.Username, account.DisplayName, account.CreatedAt, account.LastLoginAt, account.PasswordHash)
	if err != nil {
		var sqliteErr *sqlite.Error
		if errors.As(err, &sqliteErr) && sqliteErr.Code() == 2067 {
			return domain.ErrUsernameTaken
		}
		return err
	}
	if err := storeSession(ctx, tx, session, oldHash); err != nil {
		return err
	}
	return tx.Commit()
}
func storeSession(ctx context.Context, tx *sql.Tx, session domain.Session, oldHash string) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? OR token_hash = ? OR expires_at <= ?", session.UserID, oldHash, session.CreatedAt); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)", session.TokenHash, session.UserID, session.CreatedAt, session.ExpiresAt)
	return err
}
func (r *Accounts) Login(ctx context.Context, user domain.User, session domain.Session, oldHash string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE users SET last_login_at = ? WHERE id = ?", user.LastLoginAt, user.ID); err != nil {
		return err
	}
	if err := storeSession(ctx, tx, session, oldHash); err != nil {
		return err
	}
	return tx.Commit()
}
func (r *Accounts) Current(ctx context.Context, hash string, now int64) (domain.User, error) {
	var user domain.User
	err := r.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.display_name,u.created_at,u.last_login_at FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`, hash, now).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.LastLoginAt)
	if errors.Is(err, sql.ErrNoRows) {
		return user, domain.ErrUnauthenticated
	}
	return user, err
}

func (r *Accounts) Renew(ctx context.Context, hash string, now, expires int64) (domain.User, int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.User{}, 0, err
	}
	defer tx.Rollback()
	var owner string
	// Validate and extend in one statement so login/logout revocation cannot be
	// undone. MAX also prevents out-of-order refreshes from shortening the lease.
	err = tx.QueryRowContext(ctx, `UPDATE sessions SET expires_at=MAX(expires_at,?) WHERE token_hash=? AND expires_at>? RETURNING user_id,expires_at`, expires, hash, now).Scan(&owner, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, 0, domain.ErrUnauthenticated
	}
	if err != nil {
		return domain.User{}, 0, err
	}
	var user domain.User
	err = tx.QueryRowContext(ctx, `SELECT id,username,display_name,created_at,last_login_at FROM users WHERE id=?`, owner).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.LastLoginAt)
	if err != nil {
		return domain.User{}, 0, err
	}
	if err := tx.Commit(); err != nil {
		return domain.User{}, 0, err
	}
	return user, expires, nil
}
func (r *Accounts) UpdateProfile(ctx context.Context, hash string, now int64, name string) (domain.User, error) {
	var user domain.User
	err := r.db.QueryRowContext(ctx, `UPDATE users SET display_name=? WHERE id=(SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?) RETURNING id,username,display_name,created_at,last_login_at`, name, hash, now).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.LastLoginAt)
	if errors.Is(err, sql.ErrNoRows) {
		return user, domain.ErrUnauthenticated
	}
	return user, err
}
func (r *Accounts) Logout(ctx context.Context, hash string) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", hash)
	return err
}
