package repository

import (
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"context"
	"encoding/json"
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
