package database

import (
	"context"
	"testing"
	"testing/fstest"
)

func TestStageTwoUpgradePreservesAccountAndSession(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	source := fstest.MapFS{}
	for _, name := range []string{"migrations/001_bootstrap.sql", "migrations/002_users_sessions.sql"} {
		body, err := migrations.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source[name] = &fstest.MapFile{Data: body}
	}
	if err := migrate(ctx, db, source); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO users(id,username,password_hash,display_name,created_at,last_login_at) VALUES('existing','existing','saved-hash','旧厂长','created','last-login')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES('saved-token-hash','existing',1,9999999999)"); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var name, hash, token string
	if err := db.QueryRow("SELECT u.display_name,u.password_hash,s.token_hash FROM users u JOIN sessions s ON s.user_id=u.id").Scan(&name, &hash, &token); err != nil {
		t.Fatal(err)
	}
	if name != "旧厂长" || hash != "saved-hash" || token != "saved-token-hash" {
		t.Fatal("upgrade changed existing account")
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM factories").Scan(&count); err != nil || count != 0 {
		t.Fatal("migration should not auto-create factories")
	}
	if _, err := db.Exec("INSERT INTO factories(id,owner_id,name,width,height,created_at) VALUES('new-factory','existing','新工厂',21,21,'now')"); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM building_instances WHERE building_type='bus' AND x=0 AND y=0").Scan(&count); err != nil || count != 1 {
		t.Fatal("upgraded owner cannot create a Bus")
	}
}

func TestProductionUpgradePreservesExistingFactory(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	source := fstest.MapFS{}
	for _, name := range []string{"migrations/001_bootstrap.sql", "migrations/002_users_sessions.sql", "migrations/003_factories.sql"} {
		body, err := migrations.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source[name] = &fstest.MapFile{Data: body}
	}
	if err := migrate(ctx, db, source); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO users(id,username,password_hash,display_name,created_at,last_login_at) VALUES('legacy','legacy','hash','旧厂长','now','now')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO factories(id,owner_id,name,width,height,created_at) VALUES('legacy-factory','legacy','旧工厂',21,21,'now')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO building_instances(id,factory_id,building_type,x,y,rotation,configuration) VALUES('legacy-miner','legacy-factory','miner',-1,1,270,'{"custom":"preserved"}')`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var config string
	var x, y, rotation, revision int
	if err := db.QueryRow("SELECT b.x,b.y,b.rotation,b.configuration,f.revision FROM building_instances b JOIN factories f ON f.id=b.factory_id WHERE b.id='legacy-miner'").Scan(&x, &y, &rotation, &config, &revision); err != nil {
		t.Fatal(err)
	}
	if x != -1 || y != 1 || rotation != 270 || config != `{"custom":"preserved"}` || revision != 0 {
		t.Fatal("production migration modified an existing building")
	}
	var buses int
	if err := db.QueryRow("SELECT count(*) FROM building_instances WHERE factory_id='legacy-factory' AND building_type='bus'").Scan(&buses); err != nil || buses != 1 {
		t.Fatal("upgrade lost the center Bus")
	}
}

func TestOneSecondTickUpgradePreservesInventory(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	source := fstest.MapFS{}
	for _, name := range []string{"migrations/001_bootstrap.sql", "migrations/002_users_sessions.sql", "migrations/003_factories.sql", "migrations/004_production.sql"} {
		body, err := migrations.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source[name] = &fstest.MapFile{Data: body}
	}
	if err := migrate(ctx, db, source); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO users(id,username,password_hash,display_name,created_at,last_login_at) VALUES('clock-owner','clock_owner','hash','Clock','now','now')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO factories(id,owner_id,name,width,height,created_at) VALUES('clock-factory','clock-owner','旧时钟',21,21,'now')"); err != nil {
		t.Fatal(err)
	}
	const saved = `{"tick":127,"tick_rate":10,"buildings":{"furnace":{"input":[{"item":"iron_ore","count":9}],"output":[{"item":"iron_plate","count":23}],"progress":39,"duration":40,"cooldown":0,"status":"working"},"belt":{"input":[],"output":[],"progress":0,"duration":0,"cooldown":0,"status":"transporting","belt":{"item":"iron_ore","progress":9}},"port":{"input":[],"output":[],"progress":0,"duration":0,"cooldown":3,"status":"transferring"}}}`
	if _, err := db.Exec("INSERT INTO factory_simulations(factory_id,state) VALUES('clock-factory',?)", saved); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO player_warehouses(owner_id,items) VALUES('clock-owner','{"gear":777}')`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Migrate(ctx, db); err != nil {
			t.Fatal(err)
		}
	}
	var tick, rate, progress, duration, cooldown, beltProgress, ore, plate int
	var payloadID string
	err := db.QueryRow(`SELECT json_extract(state,'$.tick'),json_extract(state,'$.tick_rate'),json_extract(state,'$.buildings.furnace.progress'),json_extract(state,'$.buildings.furnace.duration'),json_extract(state,'$.buildings.port.cooldown'),json_extract(state,'$.buildings.belt.belt.progress'),json_extract(state,'$.buildings.belt.belt.id'),json_extract(state,'$.buildings.furnace.input[0].count'),json_extract(state,'$.buildings.furnace.output[0].count') FROM factory_simulations WHERE factory_id='clock-factory'`).Scan(&tick, &rate, &progress, &duration, &cooldown, &beltProgress, &payloadID, &ore, &plate)
	if err != nil {
		t.Fatal(err)
	}
	if tick != 12 || rate != 1 || progress != 3 || duration != 4 || cooldown != 1 || beltProgress != 0 || payloadID != "legacy:belt" || ore != 9 || plate != 23 {
		t.Fatalf("bad clock conversion: %d %d %d %d %d %d %q %d %d", tick, rate, progress, duration, cooldown, beltProgress, payloadID, ore, plate)
	}
	var warehouse, revision int
	if err := db.QueryRow("SELECT json_extract(items,'$.gear') FROM player_warehouses WHERE owner_id='clock-owner'").Scan(&warehouse); err != nil || warehouse != 777 {
		t.Fatal("warehouse changed during clock upgrade")
	}
	if err := db.QueryRow("SELECT revision FROM factories WHERE id='clock-factory'").Scan(&revision); err != nil || revision != 1 {
		t.Fatal("clock upgrade not idempotent")
	}
}
