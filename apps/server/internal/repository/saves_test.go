package repository

import (
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"context"
	"errors"
	"testing"
)

func TestCloudWriteRechecksSessionInsideTransaction(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	account := domain.Account{User: domain.User{ID: "owner", Username: "owner", DisplayName: "owner", CreatedAt: "now", LastLoginAt: "now"}, PasswordHash: "unused"}
	accounts := NewAccounts(db)
	old := domain.Session{TokenHash: "old", UserID: "owner", CreatedAt: 1, ExpiresAt: 100}
	if err := accounts.Create(ctx, account, old, ""); err != nil {
		t.Fatal(err)
	}
	// Model a request that authenticated before a concurrent new login.
	if _, err := accounts.Current(ctx, "old", 2); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Login(ctx, account.User, domain.Session{TokenHash: "new", UserID: "owner", CreatedAt: 3, ExpiresAt: 100}, ""); err != nil {
		t.Fatal(err)
	}
	_, err = NewSaves(db).Put(ctx, "old", 4, "now", 0, domain.GameSave{Factory: domain.FactoryDetail{Factory: domain.Factory{OwnerID: "owner"}}})
	if !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("revoked request committed a backup", err)
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM cloud_saves").Scan(&count); err != nil || count != 0 {
		t.Fatal("unauthorized backup persisted", err)
	}
}
