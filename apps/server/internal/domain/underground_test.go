package domain

import (
	"encoding/json"
	"testing"
)

func tunnelFixture() FactoryDetail {
	return FactoryDetail{Factory: Factory{ID: "f"}, Buildings: []BuildingInstance{
		{ID: "a", FactoryID: "f", BuildingType: undergroundType, X: -4, Y: 2, Configuration: json.RawMessage(`{"underground_role":"entry","underground_peer":"b"}`)},
		{ID: "b", FactoryID: "f", BuildingType: undergroundType, X: 4, Y: 2, Configuration: json.RawMessage(`{"underground_role":"exit","underground_peer":"a"}`)},
	}, Simulation: Simulation{Industry: &IndustryState{Stage: 2}, Buildings: map[string]*MachineState{"a": {}, "b": {}}}}
}

func TestUndergroundPairValidation(t *testing.T) {
	if !validUndergroundPairs(tunnelFixture()) {
		t.Fatal("valid pair rejected")
	}
	for _, name := range []string{"orphan", "distance", "sideways", "reverse", "rotation", "cross_factory", "same_role", "entry_load", "stage"} {
		t.Run(name, func(t *testing.T) {
			f := tunnelFixture()
			switch name {
			case "orphan":
				f.Buildings = f.Buildings[:1]
			case "distance":
				f.Buildings[1].X = 5
			case "sideways":
				f.Buildings[1].Y = 3
			case "reverse":
				f.Buildings[1].X = -5
			case "rotation":
				f.Buildings[1].Rotation = 90
			case "cross_factory":
				f.Buildings[1].FactoryID = "other"
			case "same_role":
				f.Buildings[1].Configuration = json.RawMessage(`{"underground_role":"entry","underground_peer":"a"}`)
			case "entry_load":
				f.Simulation.Buildings["a"].Belt = &BeltItem{ID: "load", Item: "iron"}
			case "stage":
				f.Simulation.Industry.Stage = 1
			}
			if validUndergroundPairs(f) {
				t.Fatal("invalid pair accepted")
			}
		})
	}
}
