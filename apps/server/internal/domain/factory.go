package domain

import (
	"encoding/json"
	"fmt"
	"regexp"
)

type BuildingPlacement struct {
	X        int `json:"x"`
	Y        int `json:"y"`
	Rotation int `json:"rotation"`
}

func (p BuildingPlacement) Validate() error {
	if p.Rotation != 0 && p.Rotation != 90 && p.Rotation != 180 && p.Rotation != 270 {
		return fmt.Errorf("%w: 旋转角度必须为 0、90、180 或 270", ErrValidation)
	}
	return nil
}
func (f Factory) Contains(p BuildingPlacement) bool {
	return p.X >= -f.Width/2 && p.X <= f.Width/2 && p.Y >= -f.Height/2 && p.Y <= f.Height/2
}

const InitialFactorySize = 21

type Factory struct {
	ID        string `json:"id"`
	OwnerID   string `json:"owner_id"`
	Name      string `json:"name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	CreatedAt string `json:"created_at"`
	Revision  int64  `json:"revision"`
}
type BuildingInstance struct {
	ID            string          `json:"id"`
	FactoryID     string          `json:"factory_id"`
	BuildingType  string          `json:"building_type"`
	X             int             `json:"x"`
	Y             int             `json:"y"`
	Rotation      int             `json:"rotation"`
	Configuration json.RawMessage `json:"configuration"`
}
type FactoryDetail struct {
	Factory
	Buildings  []BuildingInstance `json:"buildings"`
	Simulation Simulation         `json:"simulation"`
}
type Definition struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Code        string `json:"code"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	Description string `json:"description"`
}
type ItemDefinition struct{ Definition }
type BuildingDefinition struct {
	Definition
	Category       string   `json:"category"`
	Fixed          bool     `json:"fixed"`
	InputSlots     int      `json:"input_slots"`
	OutputSlots    int      `json:"output_slots"`
	StackLimit     int      `json:"stack_limit"`
	InputWhitelist []string `json:"input_whitelist"`
}
type RecipeDefinition struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	BuildingType string           `json:"building_type"`
	Inputs       map[string]int64 `json:"inputs"`
	Outputs      map[string]int64 `json:"outputs"`
	DurationMS   int64            `json:"duration_ms"`
}
type Catalog struct {
	Version   int                  `json:"version"`
	Items     []ItemDefinition     `json:"items"`
	Buildings []BuildingDefinition `json:"buildings"`
	Recipes   []RecipeDefinition   `json:"recipes"`
}

func (c Catalog) Validate() error {
	if c.Version != 1 || len(c.Items) == 0 || len(c.Buildings) == 0 {
		return fmt.Errorf("invalid catalog version or empty definitions")
	}
	ids := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	colors := regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	validate := func(d Definition) bool {
		return ids.MatchString(d.ID) && d.Name != "" && d.Code != "" && d.Icon != "" && d.Description != "" && colors.MatchString(d.Color)
	}
	items, buildings, recipes := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, d := range c.Items {
		if !validate(d.Definition) || items[d.ID] {
			return fmt.Errorf("invalid or duplicate item: %s", d.ID)
		}
		items[d.ID] = true
	}
	for _, d := range c.Buildings {
		if !validate(d.Definition) || buildings[d.ID] || (d.Category != "machine" && d.Category != "logistics") || d.Fixed != (d.ID == "bus") {
			return fmt.Errorf("invalid or duplicate building: %s", d.ID)
		}
		buildings[d.ID] = true
		if d.InputSlots != 4 || d.OutputSlots != 4 || d.StackLimit != 100 {
			return fmt.Errorf("invalid inventory limits: %s", d.ID)
		}
		seen := map[string]bool{}
		for _, item := range d.InputWhitelist {
			if !items[item] || seen[item] {
				return fmt.Errorf("invalid input whitelist: %s", d.ID)
			}
			seen[item] = true
		}
	}
	if !buildings["bus"] {
		return fmt.Errorf("bus definition required")
	}
	for _, r := range c.Recipes {
		if !ids.MatchString(r.ID) || recipes[r.ID] || r.Name == "" || !buildings[r.BuildingType] || r.DurationMS < TickDurationMS || r.DurationMS%TickDurationMS != 0 || (len(r.Inputs) == 0 && r.BuildingType != "miner") || len(r.Outputs) == 0 {
			return fmt.Errorf("invalid recipe: %s", r.ID)
		}
		for _, ingredients := range []map[string]int64{r.Inputs, r.Outputs} {
			for id, quantity := range ingredients {
				if !items[id] || quantity <= 0 {
					return fmt.Errorf("invalid ingredient %s in %s", id, r.ID)
				}
				if quantity > 100 {
					return fmt.Errorf("recipe stack exceeds capacity: %s", r.ID)
				}
			}
		}
		for item := range r.Inputs {
			allowed := false
			for _, d := range c.Buildings {
				if d.ID == r.BuildingType {
					for _, input := range d.InputWhitelist {
						allowed = allowed || input == item
					}
				}
			}
			if !allowed {
				return fmt.Errorf("recipe input not whitelisted: %s", r.ID)
			}
		}
		recipes[r.ID] = true
	}
	return nil
}
