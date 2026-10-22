package domain

import (
	"encoding/json"
	"testing"
)

func TestWorkshopBatchSaveCompatibility(t *testing.T) {
	for _, raw := range []string{`{"recipe_id":"batch","progress":4}`, `{"recipe_id":"batch","progress":4,"remaining":2,"total":3}`} {
		var job WorkshopJob
		if err := json.Unmarshal([]byte(raw), &job); err != nil || !validWorkshopCounts(&job) {
			t.Fatal("valid queue rejected", err)
		}
		encoded, err := json.Marshal(job)
		if err != nil {
			t.Fatal(err)
		}
		var restored WorkshopJob
		if err := json.Unmarshal(encoded, &restored); err != nil || !validWorkshopCounts(&restored) {
			t.Fatal("queue roundtrip failed", err)
		}
	}
	for _, raw := range []string{`{"recipe_id":"batch","progress":0,"remaining":0,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":2,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":1,"total":101}`, `{"recipe_id":"batch","progress":0,"remaining":1}`} {
		var job WorkshopJob
		if err := json.Unmarshal([]byte(raw), &job); err == nil && validWorkshopCounts(&job) {
			t.Fatal("invalid queue accepted")
		}
	}
	for _, raw := range []string{`{"recipe_id":"batch","progress":0,"remaining":null,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":1,"total":null}`, `{"recipe_id":"batch","progress":0,"remaining":1.5,"total":2}`, `{"recipe_id":"batch","progress":0,"unknown":1}`} {
		var job WorkshopJob
		if json.Unmarshal([]byte(raw), &job) == nil {
			t.Fatal("invalid queue JSON accepted")
		}
	}
}

func TestWorkshopPreBonusProgressCompatibility(t *testing.T) {
	c := Catalog{StartingMachines: []string{"m02"}, Stages: make([]StageDefinition, 6), Recipes: []RecipeDefinition{{ID: "sort", BuildingType: "m02", Tier: 1, DurationMS: 10000}}}
	p := &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}, Workshop: &WorkshopJob{RecipeID: "sort", Progress: 9}}
	s := Simulation{Industry: p, Warehouse: map[string]int64{}}
	if err := s.Validate(c); err != nil {
		t.Fatal("pre-bonus progress must remain cloud-backup compatible", err)
	}
	for _, progress := range []int{-1, 10} {
		p.Workshop.Progress = progress
		if s.Validate(c) == nil {
			t.Fatal("invalid original progress envelope accepted", progress)
		}
	}
}

func TestWorkshopFirstManufactureUnlock(t *testing.T) {
	c := Catalog{StartingMachines: []string{"m01", "m02", "m07"}, Items: []ItemDefinition{{Definition: Definition{ID: "device"}}}, Buildings: []BuildingDefinition{{Definition: Definition{ID: "m03"}, Item: "device"}}, Stages: make([]StageDefinition, 6), Recipes: []RecipeDefinition{{ID: "process", BuildingType: "m03", Tier: 1, DurationMS: 10000}}}
	p := &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}, Workshop: &WorkshopJob{RecipeID: "process", Progress: 0}}
	s := Simulation{Industry: p, Warehouse: map[string]int64{"device": 1}}
	if s.Validate(c) == nil {
		t.Fatal("holding a device unlocked manual processing")
	}
	if !workshopMachineAvailable(c, p, "m02") {
		t.Fatal("starting workbench locked")
	}
	p.Crafted["device"] = 1
	s.Warehouse["device"] = 0
	if err := s.Validate(c); err != nil {
		t.Fatal("manufactured device did not unlock queue", err)
	}
	encoded, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var restored IndustryState
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !workshopMachineAvailable(c, &restored, "m03") || workshopMachineAvailable(c, &restored, "m05") {
		t.Fatal("invalid restored workshop access")
	}
	for _, machine := range []string{"m04", "m08"} {
		c.Buildings[0].ID = machine
		c.Recipes[0].BuildingType = machine
		p.Crafted["device"] = 0
		if s.Validate(c) == nil {
			t.Fatal("unmanufactured optional workbench queue accepted")
		}
		p.Crafted["device"] = 1
		if err := s.Validate(c); err != nil {
			t.Fatal("optional workbench manufacture unlock rejected", err)
		}
	}
}
