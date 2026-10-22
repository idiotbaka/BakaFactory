package domain

import (
	"encoding/json"
	"testing"
)

func TestQuestProgressRoundTripAndBounds(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "item"}}}, Recipes: []RecipeDefinition{{ID: "r1001"}}, Stages: make([]StageDefinition, 6), Quests: []QuestDefinition{{ID: "quest", Tier: 1, Title: "任务", Description: "说明", Goal: QuestGoal{Type: "obtain_item", Target: "item", Count: 1}, Rewards: map[string]int64{"item": 120}}}}
	if err := validateQuestDefinitions(c); err != nil {
		t.Fatal(err)
	}
	p := &QuestProgress{Completed: []string{"quest"}, Claimed: []string{"quest"}, WorkshopBatches: map[string]int64{"r1001": 1}}
	s := Simulation{Industry: &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}, Quests: p}}
	if err := s.Validate(c); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(s.Industry)
	if err != nil {
		t.Fatal(err)
	}
	var restored IndustryState
	if err := json.Unmarshal(data, &restored); err != nil || restored.Quests == nil || len(restored.Quests.Claimed) != 1 || restored.Quests.WorkshopBatches["r1001"] != 1 {
		t.Fatal("quest state lost", err)
	}
	for _, bad := range []*QuestProgress{
		{Completed: []string{"unknown"}, Claimed: []string{}, WorkshopBatches: map[string]int64{}},
		{Completed: []string{"quest", "quest"}, Claimed: []string{}, WorkshopBatches: map[string]int64{}},
		{Completed: []string{}, Claimed: []string{"quest"}, WorkshopBatches: map[string]int64{}},
		{Completed: []string{"quest"}, Claimed: []string{"quest", "quest"}, WorkshopBatches: map[string]int64{}},
		{Completed: []string{}, Claimed: []string{}, WorkshopBatches: map[string]int64{"unknown": 1}},
		{Completed: []string{}, Claimed: []string{}, WorkshopBatches: map[string]int64{"r1001": -1}},
		{Completed: []string{}, Claimed: []string{}, WorkshopBatches: map[string]int64{"r1001": MaxSafeInteger + 1}},
	} {
		s.Industry.Quests = bad
		if s.Validate(c) == nil {
			t.Fatal("invalid quest progress accepted")
		}
	}
	for _, bad := range []string{`{"quests":null}`, `{"quests":{}}`, `{"quests":{"completed":null,"claimed":[],"workshop_batches":{}}}`, `{"quests":{"completed":[],"claimed":[],"workshop_batches":null}}`, `{"quests":{"completed":[],"claimed":[],"workshop_batches":{"r1001":null}}}`, `{"quests":{"completed":[],"claimed":[],"workshop_batches":{},"extra":true}}`} {
		if json.Unmarshal([]byte(bad), &restored) == nil {
			t.Fatal("invalid quest JSON accepted", bad)
		}
	}
	restored = IndustryState{}
	if err := json.Unmarshal([]byte(`{"stage":1,"milestones":[],"crafted":{}}`), &restored); err != nil || restored.Quests != nil {
		t.Fatal("legacy save rejected", err)
	}
}

func TestQuestDefinitionReferences(t *testing.T) {
	base := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "item"}}}, Recipes: []RecipeDefinition{{ID: "r1001"}}}
	for _, q := range []QuestDefinition{
		{ID: "q", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "unknown", Target: "item", Count: 1}, Rewards: map[string]int64{"item": 1}},
		{ID: "q", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "obtain_item", Target: "item", Count: 2}, Rewards: map[string]int64{"item": 1}},
		{ID: "q", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "workshop_recipe", Target: "unknown", Count: 1}, Rewards: map[string]int64{"item": 1}},
		{ID: "q", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "obtain_item", Target: "item", Count: 1}, Rewards: map[string]int64{"unknown": 1}},
	} {
		base.Quests = []QuestDefinition{q}
		if validateQuestDefinitions(base) == nil {
			t.Fatal("invalid definition accepted")
		}
	}
}

func TestAutomatedDeliveryCounterAndMechanismDefinitions(t *testing.T) {
	c, _ := orderFixture()
	c.Quests = append(c.Quests, QuestDefinition{ID: "delivery", Tier: 1, Title: "入库", Description: "实际送入 WH", Goal: QuestGoal{Type: "automated_delivery", Target: "bus", Count: 1}, Rewards: map[string]int64{"raw": 20}})
	if err := validateQuestDefinitions(c); err != nil {
		t.Fatal("new task definitions rejected", err)
	}
	for _, n := range []int64{0, 1, MaxSafeInteger} {
		p := &QuestProgress{Completed: []string{}, Claimed: []string{}, WorkshopBatches: map[string]int64{}, AutomatedReceived: &n}
		if !validQuestProgress(p, c) {
			t.Fatal("valid counter rejected", n)
		}
		encoded, _ := json.Marshal(p)
		var restored QuestProgress
		if err := json.Unmarshal(encoded, &restored); err != nil || restored.AutomatedReceived == nil || *restored.AutomatedReceived != n {
			t.Fatal("counter lost in roundtrip", err)
		}
	}
	for _, raw := range []string{`null`, `-1`, `9007199254740992`, `1.5`, `"1"`} {
		var p QuestProgress
		data := `{"completed":[],"claimed":[],"workshop_batches":{},"automated_received":` + raw + `}`
		if err := json.Unmarshal([]byte(data), &p); err == nil && validQuestProgress(&p, c) {
			t.Fatal("invalid delivery counter accepted", raw)
		}
	}
	for _, invalid := range []QuestDefinition{
		{ID: "bad", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "automated_delivery", Target: "raw", Count: 1}, Rewards: map[string]int64{"raw": 1}},
		{ID: "bad", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "craft_item", Target: "unknown", Count: 1}, Unlocks: []string{"warehouse_orders"}},
		{ID: "bad", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "craft_item", Target: "raw", Count: 1}, Unlocks: []string{"unknown"}},
		{ID: "bad", Tier: 1, Title: "t", Description: "d", Goal: QuestGoal{Type: "craft_item", Target: "raw", Count: 1}, Unlocks: []string{"stage_2", "stage_2"}},
	} {
		c.Quests = []QuestDefinition{invalid}
		if validateQuestDefinitions(c) == nil {
			t.Fatal("invalid unlock definition accepted")
		}
	}
}
