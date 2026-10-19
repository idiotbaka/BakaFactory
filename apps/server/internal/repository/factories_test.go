package repository

import (
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFactoryPersistenceAndFailedCreation(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "factories.db")
	db, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO users(id,username,password_hash,display_name,created_at,last_login_at) VALUES('owner','owner','hash','Owner','now','now')"); err != nil {
		t.Fatal(err)
	}
	repo := NewFactories(db)
	created, err := repo.Create(ctx, domain.Factory{ID: "factory", OwnerID: "owner", Name: "持久化工厂", Width: 21, Height: 21, CreatedAt: "now"})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	got, err := NewFactories(db).Get(ctx, "owner", "factory")
	if err != nil || !reflect.DeepEqual(got, created) {
		t.Fatal("restart lost factory or bus")
	}
	if _, err := NewFactories(db).Create(ctx, domain.Factory{ID: "invalid", OwnerID: "missing-owner", Name: "bad", Width: 21, Height: 21, CreatedAt: "now"}); err == nil {
		t.Fatal("missing owner accepted")
	}
	var count int
	db.QueryRow("SELECT count(*) FROM building_instances").Scan(&count)
	if count != 1 {
		t.Fatal("failed creation left bus")
	}
}
