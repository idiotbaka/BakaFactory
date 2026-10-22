package domain

import (
	"encoding/json"
	"testing"
)

func TestDeveloperOrderAccessDoesNotUnlockStage(t *testing.T) {
	c, s := orderFixture()
	p := s.Industry
	p.Quests.Completed = []string{}
	p.Quests.Claimed = []string{}
	p.Milestones = []string{"milestone"}
	p.Crafted["milestone"] = 1
	p.Developer = &DeveloperSettings{WarehouseOrdersAlwaysAvailable: true}
	if err := s.Validate(c); err != nil {
		t.Fatal("valid P1 developer order rejected", err)
	}
	encoded, _ := json.Marshal(s)
	var restored Simulation
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if err := restored.Validate(c); err != nil || !restored.Industry.Developer.WarehouseOrdersAlwaysAvailable {
		t.Fatal("developer order lost in save roundtrip", err)
	}
	p.Stage = 2
	if s.Validate(c) == nil {
		t.Fatal("developer override unlocked P2")
	}
	p.Stage = 1
	p.Developer.WarehouseOrdersAlwaysAvailable = false
	if s.Validate(c) == nil {
		t.Fatal("unclaimed order accepted without override")
	}
	p.Workshop = nil
	if err := s.Validate(c); err != nil {
		t.Fatal("disabled override rejected", err)
	}
}

func TestDeveloperSettingsStrictJSON(t *testing.T) {
	for _, raw := range []string{`{"developer":null}`, `{"developer":{}}`, `{"developer":[]}`, `{"developer":{"warehouse_orders_always_available":null}}`, `{"developer":{"warehouse_orders_always_available":1}}`, `{"developer":{"warehouse_orders_always_available":"true"}}`, `{"developer":{"warehouse_orders_always_available":true,"extra":true}}`} {
		var p IndustryState
		if json.Unmarshal([]byte(raw), &p) == nil {
			t.Fatal("invalid developer settings accepted", raw)
		}
	}
	for _, raw := range []string{`{}`, `{"developer":{"warehouse_orders_always_available":false}}`, `{"developer":{"warehouse_orders_always_available":true}}`} {
		var p IndustryState
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal("compatible developer settings rejected", err)
		}
	}
}
