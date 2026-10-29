package repository

import (
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestRegistrationRollsBackIfSessionCannotBeStored(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	repo := NewAccounts(db)
	account := domain.Account{User: domain.User{ID: "test-user", Username: "test_user", DisplayName: "test_user", CreatedAt: "now", LastLoginAt: "now"}, PasswordHash: "private-password-hash"}
	if err := repo.Create(ctx, account, domain.Session{TokenHash: "hash", UserID: "missing-user", CreatedAt: 1, ExpiresAt: 2}, ""); err == nil {
		t.Fatal("invalid session accepted")
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM users").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial account committed")
	}
	encoded, err := json.Marshal(account)
	if err != nil || strings.Contains(string(encoded), account.PasswordHash) {
		t.Fatal("password hash serialized")
	}
}

func TestSessionRenewalDoesNotShortenOrRecreateSessions(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	repo := NewAccounts(db)
	account := domain.Account{User: domain.User{ID: "owner", Username: "renew_user", DisplayName: "厂长", CreatedAt: "created", LastLoginAt: "login"}, PasswordHash: "hash"}
	if err := repo.Create(ctx, account, domain.Session{TokenHash: "session", UserID: account.ID, CreatedAt: 1, ExpiresAt: 100}, ""); err != nil {
		t.Fatal(err)
	}
	user, expires, err := repo.Renew(ctx, "session", 50, 200)
	if err != nil || user != account.User || expires != 200 {
		t.Fatalf("renewal failed: expires=%d err=%v", expires, err)
	}
	_, expires, err = repo.Renew(ctx, "session", 40, 190)
	if err != nil || expires != 200 {
		t.Fatal("out-of-order renewal shortened expiry")
	}
	if _, _, err := repo.Renew(ctx, "session", 200, 300); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("expired session revived")
	}
	if err := repo.Logout(ctx, "session"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.Renew(ctx, "session", 50, 300); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("deleted session recreated")
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM sessions").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed renewal created a session")
	}
}
