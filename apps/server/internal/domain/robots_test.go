package domain

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestRobotJSONRequiredFieldsAndUnknownProperties(t *testing.T) {
	valid := RobotState{ID: "r", Item: "robot-item", HomeFactoryID: "home", HomeStation: "station", FactoryID: "home", X: 1, Enabled: false, AllowedZones: []string{"home"}, Priority: 1, Status: "paused"}
	encoded, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	var decoded RobotState
	if err = json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal("valid paused robot rejected", err)
	}
	for _, name := range []string{"id", "enabled", "x", "energy_kj", "cooldown", "priority", "allowed_zones", "status"} {
		for _, missing := range []bool{false, true} {
			var shape map[string]json.RawMessage
			if err = json.Unmarshal(encoded, &shape); err != nil {
				t.Fatal(err)
			}
			if missing {
				delete(shape, name)
			} else {
				shape[name] = json.RawMessage(`null`)
			}
			invalid, _ := json.Marshal(shape)
			if err = json.Unmarshal(invalid, &decoded); err == nil {
				t.Fatalf("accepted missing/null %s", name)
			}
		}
	}
	var shape map[string]json.RawMessage
	if err = json.Unmarshal(encoded, &shape); err != nil {
		t.Fatal(err)
	}
	shape["free_energy"] = json.RawMessage(`1000`)
	invalid, _ := json.Marshal(shape)
	if err = json.Unmarshal(invalid, &decoded); err == nil {
		t.Fatal("unknown robot property bypassed strict JSON")
	}
}

func TestRobotFreightJSONAndWorldBounds(t *testing.T) {
	c := Catalog{
		Robots:    []RobotDefinition{{Item: "carrier", Tier: 4, Energy: "electric", EnergyCapacityKJ: 15000, Capacity: 24, ActionTicks: 8, CrossDistrict: true, Role: "carrier"}},
		Items:     []ItemDefinition{{Definition: Definition{ID: "iron"}}, {Definition: Definition{ID: "water"}, Kind: "fluid_or_gas"}},
		Buildings: []BuildingDefinition{{Definition: Definition{ID: "station"}, Role: "station", Energy: "electric", StationCapacityKJ: 30000}},
	}
	f := FactoryDetail{Factory: Factory{ID: "home"}, Buildings: []BuildingInstance{{ID: "wh", BuildingType: "bus"}, {ID: "s", BuildingType: "station", X: 4}}, Simulation: Simulation{Industry: &IndustryState{Stage: 4}}, Districts: []FactoryDetail{{Factory: Factory{ID: "away"}, Buildings: []BuildingInstance{{ID: "wh-away", BuildingType: "bus"}}}}}
	r := RobotState{ID: "r", Item: "carrier", HomeFactoryID: "home", HomeStation: "s", FactoryID: "home", X: 1, EnergyKJ: 100, Enabled: true, AllowedZones: []string{"home", "away"}, Priority: 3, Status: "in_transit", WorkProgress: 3, CompletedTasks: 7, Cargo: &Stack{Item: "iron", Count: 3}, Task: &RobotTask{ID: "job", Source: RobotEndpoint{FactoryID: "home", BuildingID: "wh"}, Target: RobotEndpoint{FactoryID: "away", BuildingID: "wh-away"}, Item: "iron", Count: 4, Channel: "input", Repeat: false, Phase: "deliver", Delivered: 1}, Transit: &RobotTransit{ToFactoryID: "away", X: 1, RemainingTicks: 5}}
	f.Robots = []RobotState{r}
	if !validRobotWorld(f, c) {
		t.Fatal("in-transit cargo rejected")
	}
	encoded, _ := json.Marshal(r)
	t.Run("relocated_warehouse_transit", func(t *testing.T) {
		moved := f
		moved.Buildings = append([]BuildingInstance(nil), f.Buildings...)
		moved.Districts = append([]FactoryDetail(nil), f.Districts...)
		moved.Districts[0].Buildings = append([]BuildingInstance(nil), f.Districts[0].Buildings...)
		moved.Buildings[0].X, moved.Buildings[0].Y = -4, 3
		moved.Districts[0].Buildings[0].X, moved.Districts[0].Buildings[0].Y = 6, -5
		var robot RobotState
		if err := json.Unmarshal(encoded, &robot); err != nil {
			t.Fatal(err)
		}
		robot.X, robot.Y = -3, 3
		robot.Transit.X, robot.Transit.Y = 7, -5
		moved.Robots = []RobotState{robot}
		if !validRobotWorld(moved, c) {
			t.Fatal("transit beside relocated warehouses rejected")
		}
		robot.Transit.X, robot.Transit.Y = 1, 0
		if validRobotWorld(moved, c) {
			t.Fatal("old origin landing accepted after warehouse relocation")
		}
	})
	var decoded RobotState
	if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(decoded, r) {
		t.Fatal("freight round trip", err)
	}
	for _, mutate := range []func(*RobotState){
		func(r *RobotState) { r.Cargo.Count = 25 },
		func(r *RobotState) { r.Cargo.Item = "water" },
		func(r *RobotState) { r.Task.Delivered = 2 },
		func(r *RobotState) { r.Task.Channel = "free" },
		func(r *RobotState) { r.Task.Target.FactoryID = "unknown" },
		func(r *RobotState) { r.Transit.RemainingTicks = 9 },
		func(r *RobotState) { r.Transit.X = 2 },
		func(r *RobotState) { r.WorkProgress = 9 },
		func(r *RobotState) { r.CompletedTasks = 9007199254740992 },
		func(r *RobotState) { r.AllowedZones = []string{"home"} },
	} {
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatal(err)
		}
		mutate(&decoded)
		f.Robots = []RobotState{decoded}
		if validRobotWorld(f, c) {
			t.Fatal("invalid freight accepted", decoded)
		}
	}
	for _, path := range [][]string{{"task", "repeat"}, {"task", "delivered"}, {"task", "source", "building_id"}, {"transit", "remaining_ticks"}, {"transit", "y"}, {"work_progress"}, {"cargo"}} {
		for _, missing := range []bool{false, true} {
			var shape map[string]any
			if err := json.Unmarshal(encoded, &shape); err != nil {
				t.Fatal(err)
			}
			at := shape
			for _, key := range path[:len(path)-1] {
				at = at[key].(map[string]any)
			}
			key := path[len(path)-1]
			if missing {
				delete(at, key)
			} else {
				at[key] = nil
			}
			bad, _ := json.Marshal(shape)
			err := json.Unmarshal(bad, &decoded)
			// Top-level freight fields are optional for older saves.
			if missing && len(path) == 1 {
				continue
			}
			if err == nil {
				t.Fatal("missing/null nested freight field accepted", path)
			}
		}
	}
}
