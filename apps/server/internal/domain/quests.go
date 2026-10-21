package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type QuestGoal struct {
	Type   string `json:"type"`
	Target string `json:"target"`
	Count  int64  `json:"count"`
}
type QuestDefinition struct {
	ID          string           `json:"id"`
	Tier        int              `json:"tier"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Goal        QuestGoal        `json:"goal"`
	Rewards     map[string]int64 `json:"rewards"`
}
type QuestProgress struct {
	Completed       []string         `json:"completed"`
	Claimed         []string         `json:"claimed"`
	WorkshopBatches map[string]int64 `json:"workshop_batches"`
}

func (v *QuestProgress) UnmarshalJSON(data []byte) error {
	type plain QuestProgress
	if err := decodeRobotObject(data, (*plain)(v), "completed", "claimed", "workshop_batches"); err != nil {
		return err
	}
	var fields struct {
		Counts map[string]json.RawMessage `json:"workshop_batches"`
	}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, raw := range fields.Counts {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("null workshop count")
		}
	}
	return nil
}
func validateQuestDefinitions(c Catalog) error {
	if len(c.Quests) > 1000 {
		return fmt.Errorf("too many quests")
	}
	items, recipes, seen := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, i := range c.Items {
		items[i.ID] = true
	}
	for _, r := range c.Recipes {
		recipes[r.ID] = true
	}
	for _, q := range c.Quests {
		if q.ID == "" || len(q.ID) > 128 || seen[q.ID] || q.Tier < 1 || q.Tier > 6 || q.Title == "" || q.Description == "" || q.Goal.Count < 1 || q.Goal.Count > MaxSafeInteger || len(q.Rewards) < 1 || len(q.Rewards) > len(c.Items) {
			return fmt.Errorf("invalid quest definition: %s", q.ID)
		}
		if q.Goal.Type == "obtain_item" {
			if !items[q.Goal.Target] || q.Goal.Count != 1 {
				return fmt.Errorf("invalid obtain quest")
			}
		} else if q.Goal.Type != "workshop_recipe" || !recipes[q.Goal.Target] {
			return fmt.Errorf("invalid recipe quest")
		}
		for id, n := range q.Rewards {
			if !items[id] || n < 1 || n > MaxSafeInteger {
				return fmt.Errorf("invalid quest reward")
			}
		}
		seen[q.ID] = true
	}
	return nil
}
func validQuestProgress(p *QuestProgress, c Catalog) bool {
	if p == nil {
		return true
	}
	if p.Completed == nil || p.Claimed == nil || p.WorkshopBatches == nil || len(p.Completed) > len(c.Quests) || len(p.Claimed) > len(c.Quests) || len(p.WorkshopBatches) > len(c.Recipes) {
		return false
	}
	known, completed, claimed, recipes := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, q := range c.Quests {
		known[q.ID] = true
	}
	for _, r := range c.Recipes {
		recipes[r.ID] = true
	}
	for _, id := range p.Completed {
		if !known[id] || completed[id] {
			return false
		}
		completed[id] = true
	}
	for _, id := range p.Claimed {
		if !completed[id] || claimed[id] {
			return false
		}
		claimed[id] = true
	}
	for id, n := range p.WorkshopBatches {
		if !recipes[id] || n < 0 || n > MaxSafeInteger {
			return false
		}
	}
	return true
}
