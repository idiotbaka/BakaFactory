package domain

import (
	"encoding/json"
	"testing"
)

func TestWarehouseTerminalConfiguration(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{
		{Definition: Definition{ID: "iron"}},
		{Definition: Definition{ID: "copper"}},
		{Definition: Definition{ID: "water"}, Kind: "fluid_or_gas"},
	}}
	for _, raw := range []string{`{"output_items":["iron"]}`, `{"output_items":["iron","copper"]}`} {
		var config map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			t.Fatal(err)
		}
		if !validTransportConfiguration("warehouse_pickup", config, c) {
			t.Fatal("valid terminal rejected", raw)
		}
	}
	for _, raw := range []string{`{}`, `{"output_items":null}`, `{"output_items":[]}`, `{"output_items":["iron","iron"]}`, `{"output_items":["water"]}`, `{"output_items":["missing"]}`, `{"output_items":["iron","copper","water"]}`, `{"output_items":[null]}`} {
		var config map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			t.Fatal(err)
		}
		if validTransportConfiguration("warehouse_pickup", config, c) {
			t.Fatal("invalid terminal accepted", raw)
		}
	}
	var state MachineState
	if json.Unmarshal([]byte(`{"terminal_cursor":null}`), &state) == nil {
		t.Fatal("null cursor accepted")
	}
}

func TestSubmissionQuestDefinition(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "iron"}}, {Definition: Definition{ID: "copper"}}}, Quests: []QuestDefinition{{ID: "p2_crowded_hatch", Tier: 2, Title: "舱门过于拥挤", Description: "提交材料", Critical: true, Goal: QuestGoal{Type: "submit_items", Target: "bus", Items: []string{"iron", "copper"}, Count: 50}, Rewards: map[string]int64{}, Unlocks: []string{"warehouse_io"}}}}
	if err := validateQuestDefinitions(c); err != nil {
		t.Fatal(err)
	}
	c.Quests[0].Goal.Items = []string{"iron", "iron"}
	if validateQuestDefinitions(c) == nil {
		t.Fatal("duplicate submission item accepted")
	}
}

func TestWarehouseOutputCountConfiguration(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "iron"}}}}
	for _, test := range []struct {
		kind, raw string
		valid     bool
	}{
		{"bus", `{"face_0":{"mode":"output","filter":"iron"}}`, true},
		{"bus", `{"face_0":{"mode":"output","filter":"iron","output_count":20},"face_90":{"mode":"closed","filter":"","output_count":4}}`, true},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":1}`, true},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":20}`, true},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":21}`, false},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":0}`, false},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":null}`, false},
		{"warehouse_pickup", `{"output_items":["iron"],"output_count":"20"}`, false},
		{"bus", `{"face_0":{"mode":"output","filter":"iron","output_count":1.5}}`, false},
		{"bus", `{"face_0":{"mode":"output","filter":"iron","output_count":null}}`, false},
		{"bus", `{"face_0":{"mode":"output","filter":"iron","output_count":-1}}`, false},
		{"bus", `{"face_0":{"mode":"output","filter":"iron","output_count":21}}`, false},
		{"bus", `{"output_count":20}`, false},
		{"chest", `{"output_count":20}`, false},
		{"warehouse_intake", `{"output_count":20}`, false},
	} {
		var config map[string]json.RawMessage
		if err := json.Unmarshal([]byte(test.raw), &config); err != nil {
			t.Fatal(err)
		}
		if validTransportConfiguration(test.kind, config, c) != test.valid {
			t.Fatalf("unexpected output count validation: %s %s", test.kind, test.raw)
		}
	}
}
