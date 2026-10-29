package application

import (
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"bakafactory/server/internal/repository"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAuthExpiryValidationAndHashCapacity(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	s := NewAuthService(repository.NewAccounts(db), time.Hour)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	result, err := s.Authenticate(ctx, "User_01", "correct password", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Current(ctx, result.Token); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	if _, err := s.Current(ctx, result.Token); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("session accepted at expiry")
	}
	for _, name := range []string{"", strings.Repeat("中", 33), "name\nline"} {
		if _, err := s.UpdateProfile(ctx, result.Token, name); !errors.Is(err, domain.ErrValidation) {
			t.Fatalf("invalid name accepted %q", name)
		}
	}
	s.slots <- struct{}{}
	s.slots <- struct{}{}
	if _, err := s.Authenticate(ctx, "User_01", "correct password", "", false); !errors.Is(err, domain.ErrAuthBusy) {
		t.Fatal("hash capacity not enforced")
	}
}

func TestRenewExtendsOnlyActiveSessionWithoutChangingIdentity(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	ttl := 30 * 24 * time.Hour
	s := NewAuthService(repository.NewAccounts(db), ttl)
	now := time.Unix(1800000000, 0).UTC()
	s.now = func() time.Time { return now }
	login, err := s.Authenticate(ctx, "renew_user", "correct-password", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !login.ExpiresAt.Equal(now.Add(ttl)) {
		t.Fatal("login must last 30 days")
	}
	// An existing seven-day login should adopt the new lifetime on its next visit.
	if _, err := db.Exec("UPDATE sessions SET expires_at=?", now.Add(7*24*time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	now = now.Add(6 * 24 * time.Hour)
	renewed, err := s.Renew(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	if renewed.User != login.User || renewed.Token != login.Token || !renewed.ExpiresAt.Equal(now.Add(ttl)) {
		t.Fatal("renewal changed identity or did not extend 30 days from the visit")
	}
	var count int
	var hash string
	var created, expires int64
	if err := db.QueryRow("SELECT count(*),token_hash,created_at,expires_at FROM sessions").Scan(&count, &hash, &created, &expires); err != nil {
		t.Fatal(err)
	}
	if count != 1 || hash != tokenHash(login.Token) || created != now.Add(-6*24*time.Hour).Unix() || expires != renewed.ExpiresAt.Unix() {
		t.Fatal("renewal must preserve the sole session, original creation and game identity")
	}
	// It remains usable beyond the old expiry and can be renewed repeatedly.
	now = now.Add(2 * 24 * time.Hour)
	if _, err := s.Current(ctx, login.Token); err != nil {
		t.Fatal("old expiry still applies after renewal")
	}
	renewed, err = s.Renew(ctx, login.Token)
	if err != nil || !renewed.ExpiresAt.Equal(now.Add(ttl)) {
		t.Fatalf("second visit did not renew: %v", err)
	}
	now = renewed.ExpiresAt
	if _, err := s.Renew(ctx, login.Token); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("session renewed at expiry")
	}
	if err := db.QueryRow("SELECT expires_at FROM sessions").Scan(&expires); err != nil || expires != now.Unix() {
		t.Fatal("failed renewal modified expired session")
	}
	for _, token := range []string{"", "short", strings.Repeat("x", 43)} {
		if _, err := s.Renew(ctx, token); !errors.Is(err, domain.ErrUnauthenticated) {
			t.Fatal("missing or unknown token renewed")
		}
	}
	newLogin, err := s.Authenticate(ctx, "renew_user", "correct-password", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Renew(ctx, login.Token); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("renewal resurrected session revoked by a new login")
	}
	if err := s.Logout(ctx, newLogin.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Renew(ctx, newLogin.Token); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatal("renewal resurrected logged-out session")
	}
}
