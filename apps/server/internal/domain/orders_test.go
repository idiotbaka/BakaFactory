package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func orderFixture() (Catalog, Simulation) {
	c := Catalog{StartingMachines: []string{"m01"}, Stages: make([]StageDefinition, 6)}
	for _, id := range []string{"raw", "mid", "slag", "product", "milestone"} {
		c.Items = append(c.Items, ItemDefinition{Definition: Definition{ID: id}})
	}
	c.Stages[0].MilestoneItem = "milestone"
	c.Quests = []QuestDefinition{{ID: "p1_free_hands", Tier: 1, StageFinal: true, Title: "解放双手", Description: "制作机械手", Goal: QuestGoal{Type: "craft_item", Target: "milestone", Count: 1}, Rewards: map[string]int64{}, Unlocks: []string{"warehouse_orders", "stage_2"}}}
	c.Recipes = []RecipeDefinition{
		{ID: "a", BuildingType: "m01", Tier: 1, DurationMS: 6000, Inputs: map[string]int64{"raw": 2}, Outputs: map[string]int64{"mid": 3, "slag": 1}},
		{ID: "b", BuildingType: "m01", Tier: 1, DurationMS: 6000, Inputs: map[string]int64{"mid": 2}, Outputs: map[string]int64{"product": 1}},
	}
	remaining, total, received := 2, 2, int64(0)
	p := &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}, Quests: &QuestProgress{Completed: []string{"p1_free_hands"}, Claimed: []string{"p1_free_hands"}, WorkshopBatches: map[string]int64{}, AutomatedReceived: &received}}
	p.Workshop = &WorkshopJob{RecipeID: "a", Progress: 0, Remaining: &remaining, Total: &total, Order: &WorkshopOrder{Item: "product", Requested: 2, Steps: []WorkshopOrderStep{{RecipeID: "a", Batches: 2}, {RecipeID: "b", Batches: 2}}, StepIndex: 0, Inventory: map[string]int64{"raw": 4}}}
	return c, Simulation{Industry: p, Warehouse: map[string]int64{}}
}

func TestWorkshopOrderRemainingChainRoundTrip(t *testing.T) {
	c, s := orderFixture()
	for _, cursor := range []int{0, 1} {
		j := s.Industry.Workshop
		if cursor == 1 {
			j.RecipeID = "b"
			j.Order.StepIndex = 1
			j.Order.Inventory = map[string]int64{"mid": 6, "slag": 2}
		} else {
			*j.Remaining = 1
			j.Order.Inventory = map[string]int64{"raw": 2, "mid": 3, "slag": 1}
		}
		if cursor == 1 {
			*j.Remaining = 2
		}
		before, err := json.Marshal(s)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Validate(c); err != nil {
			t.Fatal("valid paid order rejected", cursor, err)
		}
		after, _ := json.Marshal(s)
		if string(before) != string(after) {
			t.Fatal("validation mutated the private inventory")
		}
		var restored Simulation
		if err := json.Unmarshal(before, &restored); err != nil {
			t.Fatal(err)
		}
		if err := restored.Validate(c); err != nil || restored.Industry.Workshop.Order.Requested != 2 {
			t.Fatal("order roundtrip failed", err)
		}
	}
}

func TestWorkshopOrderInvalidPaidState(t *testing.T) {
	for name, mutate := range map[string]func(*IndustryState){
		"locked":                    func(p *IndustryState) { p.Quests.Claimed = []string{} },
		"short input":               func(p *IndustryState) { p.Workshop.Order.Inventory["raw"] = 3 },
		"unknown item":              func(p *IndustryState) { p.Workshop.Order.Inventory["unknown"] = 1 },
		"unknown target":            func(p *IndustryState) { p.Workshop.Order.Item = "unknown" },
		"output overflow":           func(p *IndustryState) { p.Workshop.Order.Inventory["slag"] = MaxSafeInteger },
		"cursor":                    func(p *IndustryState) { p.Workshop.Order.StepIndex = 2 },
		"job mismatch":              func(p *IndustryState) { p.Workshop.RecipeID = "b" },
		"batch mismatch":            func(p *IndustryState) { *p.Workshop.Total = 1 },
		"too many batches":          func(p *IndustryState) { p.Workshop.Order.Steps[0].Batches = 101 },
		"unknown recipe":            func(p *IndustryState) { p.Workshop.Order.Steps[1].RecipeID = "unknown" },
		"insufficient final target": func(p *IndustryState) { p.Workshop.Order.Requested = 3 },
		"quantity bound":            func(p *IndustryState) { p.Workshop.Order.Requested = 1001 },
	} {
		t.Run(name, func(t *testing.T) {
			c, s := orderFixture()
			mutate(s.Industry)
			if s.Validate(c) == nil {
				t.Fatal("invalid order accepted")
			}
		})
	}
	for _, field := range []string{"tier", "gate", "machine", "condition"} {
		c, s := orderFixture()
		switch field {
		case "tier":
			c.Recipes[1].Tier = 2
		case "gate":
			c.Recipes[1].Gate = "milestone"
		case "machine":
			c.Recipes[1].BuildingType = "m03"
		case "condition":
			c.Recipes[1].Conditions = []RecipeCondition{{Type: "verified_task_events"}}
		}
		if s.Validate(c) == nil {
			t.Fatal("unavailable future recipe accepted", field)
		}
	}
}

func TestWorkshopOrderStrictJSON(t *testing.T) {
	_, s := orderFixture()
	encoded, _ := json.Marshal(s.Industry.Workshop)
	base := string(encoded)
	for _, raw := range []string{
		strings.Replace(base, `"raw":4`, `"raw":null`, 1),
		strings.Replace(base, `"inventory":{"raw":4}`, `"inventory":null`, 1),
		strings.Replace(base, `"requested":2`, `"requested":1.5`, 1),
		strings.Replace(base, `"step_index":0`, `"step_index":null`, 1),
		strings.Replace(base, `"batches":2`, `"batches":null`, 1),
		strings.Replace(base, `"requested":2`, `"extra":true,"requested":2`, 1),
		`{"recipe_id":"a","progress":0,"order":null}`,
	} {
		var restored WorkshopJob
		if json.Unmarshal([]byte(raw), &restored) == nil {
			t.Fatal("invalid order JSON accepted", raw)
		}
	}
}

func TestP2RequiresMechanismClaimButAcceptsLegacyProgress(t *testing.T) {
	c, s := orderFixture()
	p := s.Industry
	p.Workshop = nil
	p.Milestones = []string{"milestone"}
	p.Crafted["milestone"] = 1
	p.Quests.Completed = []string{"p1_free_hands"}
	p.Quests.Claimed = []string{}
	if err := s.Validate(c); err != nil {
		t.Fatal("manufactured but unclaimed P1 rejected", err)
	}
	p.Stage = 2
	if s.Validate(c) == nil {
		t.Fatal("P2 accepted before claiming")
	}
	p.Quests.AutomatedReceived = nil
	if err := s.Validate(c); err != nil {
		t.Fatal("legacy P2 rejected", err)
	}
	zero := int64(0)
	p.Quests.AutomatedReceived = &zero
	p.Quests.Claimed = []string{"p1_free_hands"}
	if err := s.Validate(c); err != nil {
		t.Fatal("claimed P2 rejected", err)
	}
}
