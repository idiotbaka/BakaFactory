package domain

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorkJSONStrictnessAndBounds(t *testing.T) {
	values := []any{WorkIncident{Kind: "no_input", SinceTick: 5, Inspected: true}, RobotService{Kind: "inspect", Target: RobotEndpoint{FactoryID: "home", BuildingID: "machine"}, SinceTick: 5}, WorkReceipt{Kind: "inspection", RobotID: "r", RobotItem: "inspector", Count: 20, LastTick: 10}}
	values = append(values, RobotAutonomy{Enabled: true, Refill: true, NextTick: 15}, RobotBehavior{Tick: 10, Kind: "refill", Detail: "actual dispatch"})
	for _, value := range values {
		raw, _ := json.Marshal(value)
		var shape map[string]json.RawMessage
		if err := json.Unmarshal(raw, &shape); err != nil {
			t.Fatal(err)
		}
		for key := range shape {
			for _, missing := range []bool{false, true} {
				var bad map[string]json.RawMessage
				_ = json.Unmarshal(raw, &bad)
				if missing {
					delete(bad, key)
				} else {
					bad[key] = json.RawMessage(`null`)
				}
				encoded, _ := json.Marshal(bad)
				dest := reflect.New(reflect.TypeOf(value)).Interface()
				if err := json.Unmarshal(encoded, dest); err == nil {
					t.Fatalf("missing/null %s in %T accepted", key, value)
				}
			}
		}
		shape["free_credit"] = json.RawMessage(`999`)
		bad, _ := json.Marshal(shape)
		if err := json.Unmarshal(bad, reflect.New(reflect.TypeOf(value)).Interface()); err == nil {
			t.Fatal("unknown work field accepted")
		}
	}
	c := Catalog{Robots: []RobotDefinition{{Item: "inspector"}}}
	rows := []WorkReceipt{{Kind: "inspection", RobotID: "r", RobotItem: "inspector", Count: 20, LastTick: 10}}
	if !validWorkReceipts(rows, 10, c) {
		t.Fatal("valid credits rejected")
	}
	for _, mutate := range []func(*WorkReceipt){func(r *WorkReceipt) { r.Count = 10001 }, func(r *WorkReceipt) { r.Count = 0 }, func(r *WorkReceipt) { r.LastTick = 11 }, func(r *WorkReceipt) { r.Kind = "idle" }, func(r *WorkReceipt) { r.RobotItem = "unknown" }} {
		row := rows[0]
		mutate(&row)
		if validWorkReceipts([]WorkReceipt{row}, 10, c) {
			t.Fatal("invalid credits accepted", row)
		}
	}
	if validWorkReceipts(append(rows, rows[0]), 10, c) {
		t.Fatal("duplicate ledger rows accepted")
	}
	for _, raw := range []string{`{"batches_completed":null}`, `{"incident":null}`} {
		var m MachineState
		if json.Unmarshal([]byte(raw), &m) == nil {
			t.Fatal("null machine work field accepted")
		}
	}
	var p IndustryState
	if json.Unmarshal([]byte(`{"work_receipts":null}`), &p) == nil {
		t.Fatal("null credits accepted")
	}
}

func TestAutonomyStateBounds(t *testing.T) {
	r := RobotState{Autonomy: &RobotAutonomy{Enabled: true, Refill: true, NextTick: 15}, BehaviorLog: []RobotBehavior{{Tick: 10, Kind: "refill", Detail: "actual dispatch"}}}
	d := RobotDefinition{Role: "smart"}
	if !validRobotAutonomy(r, d, 10) {
		t.Fatal("valid autonomy rejected")
	}
	if validRobotAutonomy(r, RobotDefinition{Role: "carrier"}, 10) {
		t.Fatal("non-smart autonomy accepted")
	}
	r.Autonomy.NextTick = 21
	if validRobotAutonomy(r, d, 10) {
		t.Fatal("unbounded future dispatch accepted")
	}
	r.Autonomy.NextTick = 15
	r.BehaviorLog[0].Tick = 11
	if validRobotAutonomy(r, d, 10) {
		t.Fatal("future log accepted")
	}
	r.BehaviorLog[0].Tick = 10
	r.BehaviorLog[0].Kind = "free_reward"
	if validRobotAutonomy(r, d, 10) {
		t.Fatal("unknown behavior accepted")
	}
	r.BehaviorLog = make([]RobotBehavior, 21)
	if validRobotAutonomy(r, d, 10) {
		t.Fatal("unbounded log accepted")
	}
}

func TestRobotServiceWorldAndCancellationCargo(t *testing.T) {
	c := Catalog{Robots: []RobotDefinition{{Item: "inspector", Tier: 3, Energy: "hydraulic", EnergyCapacityKJ: 3000, Capacity: 0, ActionTicks: 30, Role: "inspector"}, {Item: "repair", Tier: 5, Energy: "electric", EnergyCapacityKJ: 15000, Capacity: 6, ActionTicks: 40, Role: "repair"}}, Items: []ItemDefinition{{Definition: Definition{ID: "iron"}}}, Buildings: []BuildingDefinition{{Definition: Definition{ID: "hs"}, Role: "station", Energy: "hydraulic", StationCapacityKJ: 3000}, {Definition: Definition{ID: "es"}, Role: "station", Energy: "electric", StationCapacityKJ: 30000}}}
	f := FactoryDetail{Factory: Factory{ID: "home"}, Simulation: Simulation{Tick: 10, Industry: &IndustryState{Stage: 5}}, Buildings: []BuildingInstance{{ID: "station", BuildingType: "hs", X: 4}, {ID: "electric", BuildingType: "es", X: 4, Y: 3}}}
	r := RobotState{ID: "r", Item: "inspector", HomeFactoryID: "home", HomeStation: "station", FactoryID: "home", X: 6, EnergyKJ: 100, Enabled: true, AllowedZones: []string{"home"}, Priority: 3, Status: "inspecting", Camera: true, Service: &RobotService{Kind: "inspect", Target: RobotEndpoint{FactoryID: "home", BuildingID: "scene"}, SinceTick: 5}}
	f.Robots = []RobotState{r}
	if !validRobotWorld(f, c) {
		t.Fatal("valid inspection rejected")
	}
	r.Service.Parts = 1
	f.Robots[0] = r
	if validRobotWorld(f, c) {
		t.Fatal("zero-capacity inspector has a spare kit")
	}
	r.Item = "repair"
	r.HomeStation = "electric"
	r.Service.Kind = "maintain"
	f.Robots[0] = r
	if !validRobotWorld(f, c) {
		t.Fatal("valid loaded repair rejected")
	}
	r.Cargo = &Stack{Item: "iron", Count: 6}
	f.Robots[0] = r
	if validRobotWorld(f, c) {
		t.Fatal("cargo before actual repair accepted")
	}
	r.Service.Parts = 0
	r.Returning = "cancelled"
	f.Robots[0] = r
	if !validRobotWorld(f, c) {
		t.Fatal("cancelled physical return cargo rejected")
	}
	r.Service.SinceTick = 11
	f.Robots[0] = r
	if validRobotWorld(f, c) {
		t.Fatal("future service accepted")
	}
}
