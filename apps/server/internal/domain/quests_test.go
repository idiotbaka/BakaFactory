package domain

import (
	"encoding/json"
	"testing"
)

func TestP2QuestGoalDefinitionsAndLedger(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "raw"}}, {Definition: Definition{ID: "plate"}}}}
	goals := []QuestGoal{
		{Type: "factory_delivery", Target: "bus", Items: []string{"raw", "plate"}, Count: 100},
		{Type: "factory_event", Target: "shaft_craft", Count: 1},
		{Type: "factory_event", Target: "steam_tank_fill", Count: 1},
		{Type: "factory_event", Target: "clockwork_transport", Count: 1},
		{Type: "district_count", Target: "world", Count: 10},
	}
	for _, goal := range goals {
		c.Quests = []QuestDefinition{{ID: "p2", Tier: 2, Title: "任务", Description: "说明", Goal: goal, Rewards: map[string]int64{"raw": 12}}}
		if err := validateQuestDefinitions(c); err != nil {
			t.Fatal("P2 definition rejected", goal, err)
		}
	}
	for _, goal := range []QuestGoal{
		{Type: "factory_delivery", Target: "bus", Count: 100},
		{Type: "factory_delivery", Target: "bus", Items: []string{"unknown"}, Count: 100},
		{Type: "factory_delivery", Target: "bus", Items: []string{"raw", "raw"}, Count: 100},
		{Type: "factory_delivery", Target: "box", Items: []string{"raw"}, Count: 100},
		{Type: "factory_event", Target: "unknown", Count: 1},
		{Type: "district_count", Target: "world", Count: 101},
		{Type: "district_count", Target: "world", Items: []string{"raw"}, Count: 10},
	} {
		c.Quests[0].Goal = goal
		if validateQuestDefinitions(c) == nil {
			t.Fatal("bad P2 definition accepted", goal)
		}
	}
	p := &QuestProgress{Completed: []string{}, Claimed: []string{}, WorkshopBatches: map[string]int64{},
		FactoryProduced: map[string]int64{"raw": 100}, WarehouseReceived: map[string]int64{"raw": 99},
		FactoryEvents: map[string]int64{"shaft_craft": 1, "steam_tank_fill": 1, "clockwork_transport": 1, "district_count": 10}}
	if !validQuestProgress(p, c) {
		t.Fatal("P2 ledger rejected")
	}
	encoded, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var restored QuestProgress
	if err := json.Unmarshal(encoded, &restored); err != nil || !validQuestProgress(&restored, c) || restored.WarehouseReceived["raw"] != 99 || restored.FactoryEvents["district_count"] != 10 {
		t.Fatal("P2 counters lost", err)
	}
	for _, raw := range []string{
		`"factory_produced":null`, `"warehouse_received":[]`, `"factory_produced":{"raw":null}`,
		`"factory_produced":{"unknown":1}`, `"warehouse_received":{"raw":-1}`,
		`"factory_events":{"district_count":101}`, `"factory_events":{"unknown":1}`,
		`"factory_events":{"shaft_craft":1.5}`, `"warehouse_received":{"raw":9007199254740992}`,
	} {
		var invalid QuestProgress
		data := `{"completed":[],"claimed":[],"workshop_batches":{},` + raw + `}`
		if err := json.Unmarshal([]byte(data), &invalid); err == nil && validQuestProgress(&invalid, c) {
			t.Fatal("malformed P2 counter accepted", raw)
		}
	}
	var legacy QuestProgress
	if err := json.Unmarshal([]byte(`{"completed":[],"claimed":[],"workshop_batches":{}}`), &legacy); err != nil || !validQuestProgress(&legacy, c) {
		t.Fatal("old missing counters rejected", err)
	}
}

func TestFinalQuestStageValidationAndLegacyEnvelope(t *testing.T) {
	c, s := orderFixture()
	s.Industry.Workshop = nil
	c.Stages[1].MilestoneItem = "raw"
	c.Quests = append(c.Quests, QuestDefinition{ID: "p2_final", Tier: 2, StageFinal: true, Title: "阶段终局", Description: "制造原料并领奖", Goal: QuestGoal{Type: "craft_item", Target: "raw", Count: 1}, Rewards: map[string]int64{}})
	if err := validateQuestDefinitions(c); err != nil {
		t.Fatal("final stage reward should not require a fake item", err)
	}
	p := s.Industry
	p.Milestones = []string{"milestone", "raw"}
	p.Crafted = map[string]int64{"milestone": 1, "raw": 1}
	p.Stage = 3
	// Old, already unlocked stages can still be uploaded/restored unchanged.
	before, _ := json.Marshal(s)
	if err := s.Validate(c); err != nil {
		t.Fatal("old unlocked stage rejected", err)
	}
	after, _ := json.Marshal(s)
	if string(before) != string(after) {
		t.Fatal("legacy validation must not grant claims or mutate the save")
	}
	version := 1
	p.Quests.StageQuestsVersion = &version
	if s.Validate(c) == nil {
		t.Fatal("manufacturing a P2 milestone must not unlock P3")
	}
	p.Stage = 2
	if err := s.Validate(c); err != nil {
		t.Fatal("unclaimed P2 milestone should remain in P2", err)
	}
	p.Quests.Completed = append(p.Quests.Completed, "p2_final")
	if err := s.Validate(c); err != nil {
		t.Fatal("completed but unclaimed final should remain in P2", err)
	}
	p.Quests.Claimed = append(p.Quests.Claimed, "p2_final")
	p.Stage = 3
	if err := s.Validate(c); err != nil {
		t.Fatal("claimed final should unlock P3", err)
	}
	p.Quests.Claimed = []string{"p2_final"}
	if s.Validate(c) == nil {
		t.Fatal("later claims must not bypass an earlier final")
	}
}

func TestFinalQuestDefinitionUniquenessAndVersionBounds(t *testing.T) {
	c, _ := orderFixture()
	q := c.Quests[0]
	duplicate := q
	duplicate.ID = "another_final"
	c.Quests = append(c.Quests, duplicate)
	if validateQuestDefinitions(c) == nil {
		t.Fatal("duplicate tier final accepted")
	}
	for _, mutate := range []func(*QuestDefinition){
		func(q *QuestDefinition) { q.Tier = 6 },
		func(q *QuestDefinition) { q.StageFinal = false },
		func(q *QuestDefinition) { q.Tier = 2 },
	} {
		bad := q
		mutate(&bad)
		c.Quests = []QuestDefinition{bad}
		if validateQuestDefinitions(c) == nil {
			t.Fatal("invalid stage final definition accepted")
		}
	}
	c.Quests = []QuestDefinition{q}
	for _, raw := range []string{`null`, `0`, `2`, `1.5`, `"1"`} {
		var p QuestProgress
		data := `{"completed":[],"claimed":[],"workshop_batches":{},"stage_quests_version":` + raw + `}`
		if err := json.Unmarshal([]byte(data), &p); err == nil && validQuestProgress(&p, c) {
			t.Fatal("invalid stage quest version accepted", raw)
		}
	}
	var restored QuestProgress
	if err := json.Unmarshal([]byte(`{"completed":[],"claimed":[],"workshop_batches":{},"stage_quests_version":1}`), &restored); err != nil || !validQuestProgress(&restored, c) || restored.StageQuestsVersion == nil || *restored.StageQuestsVersion != 1 {
		t.Fatal("versioned quest progress lost", err)
	}
}

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
