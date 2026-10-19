package repository

import (
	"bakafactory/server/internal/catalog"
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"context"
	"path/filepath"
	"testing"
)

func TestSimulationPersistenceAndDemolitionRefund(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "simulation.db")
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
	factory, err := repo.Create(ctx, domain.Factory{ID: "factory", OwnerID: "owner", Name: "生产存档", Width: 21, Height: 21, CreatedAt: "now"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.Place(ctx, "owner", factory.ID, domain.BuildingInstance{ID: "miner", BuildingType: "miner", X: -1, Y: 0, Rotation: 0, Configuration: []byte(`{"keep":"config"}`)})
	if err != nil {
		t.Fatal(err)
	}
	c, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := repo.AdvanceAll(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	before, err := repo.Get(ctx, "owner", factory.ID)
	if err != nil {
		t.Fatal(err)
	}
	if before.Simulation.Buildings["miner"].Output.Count("iron_ore") != 2 || before.Simulation.Buildings["miner"].Progress != 0 {
		t.Fatal("production state not saved")
	}
	db.Close()
	db, err = database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo = NewFactories(db)
	restored, err := repo.Get(ctx, "owner", factory.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Simulation.Tick != 2 || restored.Simulation.TickRate != 1 || restored.Simulation.Buildings["miner"].Progress != 0 {
		t.Fatal("restart lost production progress")
	}
	moved, err := repo.UpdateBuilding(ctx, "owner", factory.ID, "miner", domain.BuildingPlacement{X: 1, Y: 1, Rotation: 90})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Simulation.Buildings["miner"].Output.Count("iron_ore") != 2 || moved.Revision <= restored.Revision {
		t.Fatal("move lost inventory or revision")
	}
	deleted, err := repo.DeleteBuilding(ctx, "owner", factory.ID, "miner")
	if err != nil {
		t.Fatal(err)
	}
	if deleted.Simulation.Warehouse["iron_ore"] != 2 || deleted.Simulation.Buildings["miner"] != nil {
		t.Fatal("demolition did not reclaim output")
	}
	if err := repo.AdvanceAll(ctx, c); err != nil {
		t.Fatal(err)
	}
	again, err := repo.Get(ctx, "owner", factory.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.Simulation.Warehouse["iron_ore"] != 2 {
		t.Fatal("deleted machine inventory refunded twice")
	}
	if _, err := repo.Get(ctx, "someone-else", factory.ID); err != domain.ErrFactoryNotFound {
		t.Fatal("simulation leaked to another owner")
	}
}
