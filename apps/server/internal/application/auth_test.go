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
