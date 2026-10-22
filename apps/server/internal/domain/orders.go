package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type WorkshopOrderStep struct {
	RecipeID string `json:"recipe_id"`
	Batches  int    `json:"batches"`
}
type WorkshopOrder struct {
	Item      string              `json:"item"`
	Requested int                 `json:"requested"`
	Steps     []WorkshopOrderStep `json:"steps"`
	StepIndex int                 `json:"step_index"`
	Inventory map[string]int64    `json:"inventory"`
}

func (v *WorkshopOrderStep) UnmarshalJSON(data []byte) error {
	type plain WorkshopOrderStep
	return decodeRobotObject(data, (*plain)(v), "recipe_id", "batches")
}
func (v *WorkshopOrder) UnmarshalJSON(data []byte) error {
	type plain WorkshopOrder
	if err := decodeRobotObject(data, (*plain)(v), "item", "requested", "steps", "step_index", "inventory"); err != nil {
		return err
	}
	var raw struct {
		Inventory map[string]json.RawMessage `json:"inventory"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, n := range raw.Inventory {
		if bytes.Equal(bytes.TrimSpace(n), []byte("null")) {
			return fmt.Errorf("null order inventory count")
		}
	}
	return nil
}
func validWorkshopOrder(p *IndustryState, c Catalog) bool {
	j := p.Workshop
	o := j.Order
	if !warehouseOrdersUnlocked(p) || o.Item == "" || o.Requested < 1 || o.Requested > 1000 || len(o.Steps) < 1 || len(o.Steps) > 256 || o.StepIndex < 0 || o.StepIndex >= len(o.Steps) || o.Inventory == nil || len(o.Inventory) > len(c.Items) || j.Remaining == nil || j.Total == nil {
		return false
	}
	items := map[string]bool{}
	for _, i := range c.Items {
		items[i.ID] = true
	}
	if !items[o.Item] {
		return false
	}
	stock := map[string]int64{}
	for id, n := range o.Inventory {
		if !items[id] || n < 0 || n > MaxSafeInteger {
			return false
		}
		stock[id] = n
	}
	current := o.Steps[o.StepIndex]
	if j.RecipeID != current.RecipeID || *j.Total != current.Batches || *j.Remaining < 1 || *j.Remaining > *j.Total {
		return false
	}
	recipes := map[string]RecipeDefinition{}
	for _, r := range c.Recipes {
		recipes[r.ID] = r
	}
	total := 0
	for index, step := range o.Steps {
		r, ok := recipes[step.RecipeID]
		if !ok || r.Legacy || !workshopMachineAvailable(c, p, r.BuildingType) || r.Tier > p.Stage || len(r.Conditions) != 0 || step.Batches < 1 || step.Batches > 100 {
			return false
		}
		if r.Gate != "" {
			found := false
			for _, id := range p.Milestones {
				found = found || id == r.Gate
			}
			if !found {
				return false
			}
		}
		total += step.Batches
		if total > 10000 {
			return false
		}
		if index < o.StepIndex {
			continue
		}
		batches := step.Batches
		if index == o.StepIndex {
			batches = *j.Remaining
		}
		for id, n := range r.Inputs {
			if n < 0 || n > MaxSafeInteger/int64(batches) || stock[id] < n*int64(batches) {
				return false
			}
			stock[id] -= n * int64(batches)
		}
		for id, n := range r.Outputs {
			if n < 0 || n > (MaxSafeInteger-stock[id])/int64(batches) {
				return false
			}
			stock[id] += n * int64(batches)
		}
	}
	return stock[o.Item] >= int64(o.Requested)
}
