package domain

import (
	"encoding/json"
	"testing"
)

func TestAutoEjectConfiguration(t *testing.T) {
	c := Catalog{
		Buildings: []BuildingDefinition{
			{Definition: Definition{ID: "machine"}, Category: "machine"},
			{Definition: Definition{ID: "utility"}, Category: "machine"},
			{Definition: Definition{ID: "feeder"}, Category: "logistics"},
		},
		Recipes: []RecipeDefinition{{BuildingType: "machine"}, {BuildingType: "feeder"}},
	}
	for _, raw := range []string{`{}`, `{"auto_eject":false}`, `{"auto_eject":true}`, `{"auto_eject":true,"enabled":false}`} {
		var config map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			t.Fatal(err)
		}
		if !validTransportConfiguration("machine", config, c) {
			t.Fatal("compatible machine config rejected", raw)
		}
	}
	for _, raw := range []string{`null`, `1`, `"true"`, `{}`, `[]`} {
		if validTransportConfiguration("machine", map[string]json.RawMessage{"auto_eject": json.RawMessage(raw)}, c) {
			t.Fatal("invalid auto eject accepted", raw)
		}
	}
	for _, kind := range []string{"utility", "feeder", "bus", "missing"} {
		for _, raw := range []string{`true`, `false`} {
			if validTransportConfiguration(kind, map[string]json.RawMessage{"auto_eject": json.RawMessage(raw)}, c) {
				t.Fatal("auto eject allowed on nonproduction facility", kind, raw)
			}
		}
	}
}

func TestAutoEjectCloudSaveRoundtrip(t *testing.T) {
	c := Catalog{
		Items: []ItemDefinition{{Definition: Definition{ID: "iron"}}},
		Buildings: []BuildingDefinition{
			{Definition: Definition{ID: "bus"}, Category: "logistics"},
			{Definition: Definition{ID: "machine"}, Category: "machine", InputSlots: 4, OutputSlots: 4},
		},
		Recipes: []RecipeDefinition{{BuildingType: "machine"}},
		Stages:  make([]StageDefinition, 6),
	}
	for _, raw := range []string{`{}`, `{"auto_eject":true}`, `{"auto_eject":false}`} {
		save := GameSave{FormatVersion: 1, RulesVersion: 3, Factory: FactoryDetail{
			Factory: Factory{ID: "factory", OwnerID: "owner", Name: "Factory", Width: 21, Height: 21},
			Buildings: []BuildingInstance{
				{ID: "wh", FactoryID: "factory", BuildingType: "bus", Configuration: json.RawMessage(`{}`)},
				{ID: "producer", FactoryID: "factory", BuildingType: "machine", X: 2, Rotation: 180, Configuration: json.RawMessage(raw)},
			},
			Simulation: Simulation{TickRate: TickRate, Warehouse: map[string]int64{}, Transfers: []ItemTransfer{}, Buildings: map[string]*MachineState{
				"wh":       {Input: Inventory{}, Output: Inventory{}},
				"producer": {Input: Inventory{}, Output: Inventory{{Item: "iron", Count: 12}}, Progress: 1.5},
			}, Industry: &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}}},
		}}
		if err := save.Validate("owner", c); err != nil {
			t.Fatal("valid save rejected", raw, err)
		}
		encoded, err := json.Marshal(save)
		if err != nil {
			t.Fatal(err)
		}
		var restored GameSave
		if err := json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		if err := restored.Validate("owner", c); err != nil {
			t.Fatal(err)
		}
		if string(restored.Factory.Buildings[1].Configuration) != raw || restored.Factory.Simulation.Buildings["producer"].Output[0].Count != 12 || restored.Factory.Simulation.Buildings["producer"].Progress != 1.5 {
			t.Fatal("configuration or inventory changed in roundtrip")
		}
		restored.Factory.Buildings[1].Configuration = json.RawMessage(`{"auto_eject":1}`)
		if restored.Validate("owner", c) == nil {
			t.Fatal("malformed cloud config accepted")
		}
	}
}
