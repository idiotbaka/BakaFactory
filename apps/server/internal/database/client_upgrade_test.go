package database

import (
	"context"
	"testing"
	"testing/fstest"
)

func TestClientSaveUpgradeKeepsLegacyDataButStartsCloudEmpty(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	source := fstest.MapFS{}
	for _, name := range []string{"001_bootstrap.sql", "002_users_sessions.sql", "003_factories.sql", "004_production.sql", "005_one_second_ticks.sql"} {
		path := "migrations/" + name
		content, err := migrations.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		source[path] = &fstest.MapFile{Data: content}
	}
	if err := migrate(ctx, db, source); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"INSERT INTO users(id,username,password_hash,display_name,created_at,last_login_at) VALUES('owner','owner','kept-hash','厂长','now','now')",
		"INSERT INTO factories(id,owner_id,name,width,height,created_at) VALUES('legacy','owner','旧工厂',21,21,'now')",
		"INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES('old','owner',1,9999999999),('new','owner',2,9999999999)",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal("migration not idempotent", err)
	}
	var count int
	var session, name string
	if err := db.QueryRow("SELECT name FROM factories WHERE id='legacy'").Scan(&name); err != nil || name != "旧工厂" {
		t.Fatal("legacy data removed", err)
	}
	if err := db.QueryRow("SELECT token_hash FROM sessions WHERE user_id='owner'").Scan(&session); err != nil || session != "new" {
		t.Fatal("wrong surviving session", err)
	}
	if err := db.QueryRow("SELECT count(*) FROM cloud_saves").Scan(&count); err != nil || count != 0 {
		t.Fatal("legacy factory imported into new game", err)
	}
	if _, err := db.Exec("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES('duplicate','owner',3,9999999999)"); err == nil {
		t.Fatal("multiple sessions accepted")
	}
}
