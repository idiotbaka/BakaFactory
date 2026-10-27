package domain

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func constructionFixture() (FactoryDetail, Catalog) {
	c := Catalog{Robots: []RobotDefinition{{Item: "smart", Tier: 6, Energy: "electric", EnergyCapacityKJ: 30000, Capacity: 32, ActionTicks: 2, CrossDistrict: true, Role: "smart"}}, Items: []ItemDefinition{{Definition: Definition{ID: "device"}}}, Buildings: []BuildingDefinition{{Definition: Definition{ID: "station"}, Role: "station", Energy: "electric", StationCapacityKJ: 30000}, {Definition: Definition{ID: "machine"}, Item: "device", Tier: 1}, {Definition: Definition{ID: "source"}, Item: "device", Role: "source"}, {Definition: Definition{ID: "legacy"}, Item: "device", Legacy: true}}, Recipes: []RecipeDefinition{{ID: "recipe", BuildingType: "machine", Tier: 1}}}
	f := FactoryDetail{Factory: Factory{ID: "home"}, Buildings: []BuildingInstance{{ID: "wh", BuildingType: "bus"}, {ID: "s", BuildingType: "station", X: 4}}, Simulation: Simulation{Industry: &IndustryState{Stage: 6}}, Districts: []FactoryDetail{{Factory: Factory{ID: "away"}, Buildings: []BuildingInstance{{ID: "wh-away", BuildingType: "bus"}}}}}
	f.Robots = []RobotState{{ID: "r", Item: "smart", HomeFactoryID: "home", HomeStation: "s", FactoryID: "home", X: 5, EnergyKJ: 100, Enabled: true, AllowedZones: []string{"home", "away"}, Priority: 3, Status: "constructing", WorkProgress: 9, Cargo: &Stack{Item: "device", Count: 1}, Construction: &RobotConstruction{ID: "site", FactoryID: "away", BuildingType: "machine", X: 6, Y: 2, Rotation: 90}}}
	return f, c
}
func TestSourcesAllowChildFactoryAndMoreThanOldQuota(t *testing.T) {
	f, c := constructionFixture()
	f.Robots[0].Construction.BuildingType = "source"
	f.Robots[0].Construction.Y = 10
	for x := -10; x <= 10; x++ {
		if x == 6 {
			continue
		}
		f.Districts[0].Buildings = append(f.Districts[0].Buildings, BuildingInstance{ID: fmt.Sprintf("source:%d", x), BuildingType: "source", X: x, Y: 10})
	}
	if !validRobotWorld(f, c) {
		t.Fatal("valid child source blueprint rejected by old quota")
	}
	f.Robots[0].Construction.Y = 9
	if validRobotWorld(f, c) {
		t.Fatal("source outside top row accepted")
	}
}
func TestConstructionWorldBoundsAndReturnStates(t *testing.T) {
	f, c := constructionFixture()
	if !validRobotWorld(f, c) {
		t.Fatal("valid held construction rejected")
	}
	encoded, _ := json.Marshal(f)
	for name, mutate := range map[string]func(*FactoryDetail){
		"cargo count":   func(f *FactoryDetail) { f.Robots[0].Cargo.Count = 2 },
		"missing cargo": func(f *FactoryDetail) { f.Robots[0].Cargo = nil },
		"work limit":    func(f *FactoryDetail) { f.Robots[0].WorkProgress = 11 },
		"wrong item":    func(f *FactoryDetail) { f.Robots[0].Cargo.Item = "smart" },
		"role":          func(f *FactoryDetail) { f.Robots[0].Task = &RobotTask{} },
		"legacy":        func(f *FactoryDetail) { f.Robots[0].Construction.BuildingType = "legacy" },
		"rotation":      func(f *FactoryDetail) { f.Robots[0].Construction.Rotation = 45 },
		"bounds":        func(f *FactoryDetail) { f.Robots[0].Construction.X = 11 },
		"existing ID":   func(f *FactoryDetail) { f.Robots[0].Construction.ID = "wh" },
		"existing cell": func(f *FactoryDetail) { f.Robots[0].Construction.X = 0; f.Robots[0].Construction.Y = 0 },
		"permissions":   func(f *FactoryDetail) { f.Robots[0].AllowedZones = []string{"home"} },
		"recipe":        func(f *FactoryDetail) { v := "unknown"; f.Robots[0].Construction.RecipeID = &v },
		"source off edge": func(f *FactoryDetail) {
			f.Robots[0].Construction.BuildingType = "source"
			f.Robots[0].Construction.Y = 9
		},
		"duplicate site": func(f *FactoryDetail) { r := f.Robots[0]; r.ID = "peer"; r.X = 3; f.Robots = append(f.Robots, r) },
		"landing": func(f *FactoryDetail) {
			f.Robots[0].Construction.X = 1
			f.Robots[0].Construction.Y = 0
			f.Robots[0].X = 1
			f.Robots[0].Transit = &RobotTransit{ToFactoryID: "away", X: 1, RemainingTicks: 4}
		},
	} {
		t.Run(name, func(t *testing.T) {
			var candidate FactoryDetail
			if err := json.Unmarshal(encoded, &candidate); err != nil {
				t.Fatal(err)
			}
			mutate(&candidate)
			if validRobotWorld(candidate, c) {
				t.Fatal("invalid construction accepted")
			}
		})
	}
	// Cancelling releases the site and keeps metadata until the actual station.
	f.Robots[0].Returning = "cancelled"
	f.Robots[0].Cargo = nil
	f.Districts[0].Buildings = append(f.Districts[0].Buildings, BuildingInstance{ID: "new", BuildingType: "machine", X: 6, Y: 2})
	if !validRobotWorld(f, c) {
		t.Fatal("already refunded return state rejected")
	}
	f, c = constructionFixture()
	recipe := "recipe"
	f.Robots[0].Construction.RecipeID = &recipe
	raw, _ := json.Marshal(f.Robots[0])
	var decoded RobotState
	if err := json.Unmarshal(raw, &decoded); err != nil || !reflect.DeepEqual(decoded, f.Robots[0]) {
		t.Fatal("construction did not round trip", err)
	}
	c.Recipes[0].Gate = "unreached"
	if validRobotWorld(f, c) {
		t.Fatal("unreached recipe gate accepted")
	}
}
func TestConstructionJSONStrictness(t *testing.T) {
	f, _ := constructionFixture()
	raw, _ := json.Marshal(f.Robots[0].Construction)
	for _, key := range []string{"id", "factory_id", "building_type", "x", "y", "rotation"} {
		for _, missing := range []bool{false, true} {
			var shape map[string]json.RawMessage
			_ = json.Unmarshal(raw, &shape)
			if missing {
				delete(shape, key)
			} else {
				shape[key] = json.RawMessage(`null`)
			}
			bad, _ := json.Marshal(shape)
			var v RobotConstruction
			if err := json.Unmarshal(bad, &v); err == nil {
				t.Fatal("missing/null construction field accepted", key)
			}
		}
	}
	for _, extra := range []string{`"recipe_id":null`, `"free_materials":1`} {
		bad := append(append([]byte{}, raw[:len(raw)-1]...), []byte(","+extra+"}")...)
		var v RobotConstruction
		if err := json.Unmarshal(bad, &v); err == nil {
			t.Fatal("null/unknown construction field accepted")
		}
	}
}

func TestPausedTransitAndReclaimedConstructionPermissions(t *testing.T) {
	f, c := constructionFixture()
	r := &f.Robots[0]
	r.Enabled = false
	r.Status = "paused"
	r.Returning = "cancelled"
	r.WorkProgress = 0
	r.X = 1
	r.Transit = &RobotTransit{ToFactoryID: "away", X: 1, RemainingTicks: 4}
	if !validRobotWorld(f, c) {
		t.Fatal("paused cancellation checkpoint rejected")
	}
	raw, _ := json.Marshal(f)
	var restored FactoryDetail
	if err := json.Unmarshal(raw, &restored); err != nil || !reflect.DeepEqual(restored.Robots, f.Robots) {
		t.Fatal("paused checkpoint lost cargo or transit", err)
	}
	r.AllowedZones = []string{"home"}
	if validRobotWorld(f, c) {
		t.Fatal("in-flight authorization removed")
	}
	r.AllowedZones = []string{"home", "away"}
	r.Transit = nil
	r.X = 3
	r.Cargo = nil
	if !validRobotWorld(f, c) {
		t.Fatal("refunded construction waiting at station rejected")
	}
	r.AllowedZones = []string{"home"}
	if validRobotWorld(f, c) {
		t.Fatal("unfinished construction metadata authorization removed")
	}
	r.Construction = nil
	r.Returning = ""
	if !validRobotWorld(f, c) {
		t.Fatal("idle robot cannot revoke unused district")
	}
}
