package domain

import (
	"encoding/json"
	"testing"
)

func TestHalfSecondStateAndLargeBeltBatch(t *testing.T) {
	count := 100
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "solid"}}}}
	s := Simulation{Tick: 1, TickRate: TickRate, Warehouse: map[string]int64{}, Transfers: []ItemTransfer{}, Buildings: map[string]*MachineState{
		"belt": {Input: Inventory{}, Output: Inventory{}, Progress: 0.5, Duration: 1.5, Cooldown: 0.5, EnergyKJ: 0.5, WorkEnergyKJ: 0.5, StationEnergyKJ: 0.5, ChargeKJ: 0.5, Belt: &BeltItem{ID: "load", Item: "solid", Progress: 1, Count: &count}},
	}}
	if err := s.Validate(c); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var restored Simulation
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if err := restored.Validate(c); err != nil {
		t.Fatal(err)
	}
	if restored.Buildings["belt"].EnergyKJ != 0.5 || *restored.Buildings["belt"].Belt.Count != 100 {
		t.Fatal("half-second state lost during JSON roundtrip")
	}
	for _, mutate := range []func(*MachineState){
		func(m *MachineState) { m.Progress = 0.25 },
		func(m *MachineState) { m.Cooldown = 0.25 },
		func(m *MachineState) { m.EnergyKJ = 0.25 },
		func(m *MachineState) { m.WorkEnergyKJ = 0.25 },
		func(m *MachineState) { m.ChargeKJ = 0.25 },
	} {
		copy := restored.Buildings["belt"]
		machine := *copy
		mutate(&machine)
		restored.Buildings["belt"] = &machine
		if restored.Validate(c) == nil {
			t.Fatal("accepted value outside half-unit lattice")
		}
		restored.Buildings["belt"] = copy
	}
	count = 101
	if s.Validate(c) == nil {
		t.Fatal("accepted oversized batch")
	}
}

func TestHalfSecondTransportIntervals(t *testing.T) {
	for _, interval := range []string{"0.5", "1", "1.5", "60"} {
		if !validTransportConfiguration("feeder", map[string]json.RawMessage{"interval": json.RawMessage(interval)}, Catalog{}) {
			t.Fatalf("rejected interval %s", interval)
		}
	}
	for _, interval := range []string{"0.25", "0", "60.5", "null", "\"0.5\""} {
		if validTransportConfiguration("feeder", map[string]json.RawMessage{"interval": json.RawMessage(interval)}, Catalog{}) {
			t.Fatalf("accepted interval %s", interval)
		}
	}
}
