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
	Robots           []RobotState       `json:"robots,omitempty"`
	Buildings        []BuildingInstance `json:"buildings"`
	Simulation       Simulation         `json:"simulation"`
	Districts        []FactoryDetail    `json:"districts,omitempty"`
	ActiveDistrictID string             `json:"active_district_id,omitempty"`
}
type Definition struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Code        string `json:"code"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	Description string `json:"description"`
}
type ItemDefinition struct {
	Definition
	Kind          string   `json:"kind,omitempty"`
	Tier          int      `json:"tier,omitempty"`
	Legacy        bool     `json:"legacy,omitempty"`
	SourceRecipes []string `json:"source_recipes,omitempty"`
	UsedBy        []string `json:"used_by,omitempty"`
}
type BuildingDefinition struct {
	StationCapacityKJ int `json:"station_capacity_kj,omitempty"`
	StationTransferKW int `json:"station_transfer_kw,omitempty"`
	Definition
	Category       string   `json:"category"`
	Fixed          bool     `json:"fixed"`
	InputSlots     int      `json:"input_slots"`
	OutputSlots    int      `json:"output_slots"`
	StackLimit     int      `json:"stack_limit"`
	InputWhitelist []string `json:"input_whitelist"`
	Tier           int      `json:"tier,omitempty"`
	Item           string   `json:"item,omitempty"`
	WorkMode       string   `json:"work_mode,omitempty"`
	Energy         string   `json:"energy,omitempty"`
	PowerKW        int      `json:"power_kw,omitempty"`
	CapacityKJ     int      `json:"capacity_kj,omitempty"`
	TransferKW     int      `json:"transfer_kw,omitempty"`
	FluidCapacity  int      `json:"fluid_capacity,omitempty"`
	FluidRate      int      `json:"fluid_rate,omitempty"`
	Role           string   `json:"role,omitempty"`
	BeltTicks      int      `json:"belt_ticks,omitempty"`
	BatchSize      int      `json:"batch_size,omitempty"`
	Legacy         bool     `json:"legacy,omitempty"`
}
type RecipeDefinition struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	BuildingType string            `json:"building_type"`
	Inputs       map[string]int64  `json:"inputs"`
	Outputs      map[string]int64  `json:"outputs"`
	DurationMS   int64             `json:"duration_ms"`
	Tier         int               `json:"tier,omitempty"`
	Description  string            `json:"description,omitempty"`
	PowerKW      int               `json:"power_kw,omitempty"`
	Gate         string            `json:"gate,omitempty"`
	Legacy       bool              `json:"legacy,omitempty"`
	Conditions   []RecipeCondition `json:"conditions,omitempty"`
}
type RecipeCondition struct {
	Type                  string   `json:"type"`
	Roles                 []string `json:"roles,omitempty"`
	TasksSinceLastClaim   int      `json:"tasks_since_last_claim,omitempty"`
	MinVerifiedTaskEvents int      `json:"min_verified_task_events,omitempty"`
}
type StageDefinition struct {
	Tier          int    `json:"tier"`
	Name          string `json:"name"`
	Goal          string `json:"goal"`
	MilestoneItem string `json:"milestone_item"`
}
type Catalog struct {
	Quests           []QuestDefinition    `json:"quests,omitempty"`
	Robots           []RobotDefinition    `json:"robots,omitempty"`
	Version          int                  `json:"version"`
	Items            []ItemDefinition     `json:"items"`
	Buildings        []BuildingDefinition `json:"buildings"`
	Recipes          []RecipeDefinition   `json:"recipes"`
	Stages           []StageDefinition    `json:"stages,omitempty"`
	StartingMachines []string             `json:"starting_machines,omitempty"`
	RootItem         string               `json:"root_item,omitempty"`
}

func (c Catalog) Validate() error {
	if (c.Version != 1 && c.Version != 2) || len(c.Items) == 0 || len(c.Buildings) == 0 {
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
		if d.InputSlots < 1 || d.InputSlots > 12 || d.OutputSlots < 1 || d.OutputSlots > 12 || d.StackLimit != 100 || (d.Item != "" && !items[d.Item]) || d.Tier < 0 || d.Tier > 6 || d.PowerKW < 0 || d.BatchSize < 0 || d.BatchSize > 6 {
			return fmt.Errorf("invalid inventory limits: %s", d.ID)
		}
		if d.PowerKW > 1000 || d.CapacityKJ < 0 || d.CapacityKJ > 30000 || d.TransferKW < 0 || d.TransferKW > 1000 || (d.Role == "battery" && (d.CapacityKJ == 0 || d.TransferKW == 0)) {
			return fmt.Errorf("invalid energy definition: %s", d.ID)
		}
		if d.FluidCapacity < 0 || d.FluidCapacity > 500 || d.FluidRate < 0 || d.FluidRate > 20 || (d.FluidCapacity > 0) != (d.FluidRate > 0) {
			return fmt.Errorf("invalid fluid definition: %s", d.ID)
		}
		if d.StationCapacityKJ < 0 || d.StationCapacityKJ > 30000 || d.StationTransferKW < 0 || d.StationTransferKW > 100 || (d.StationCapacityKJ > 0) != (d.StationTransferKW > 0) || d.StationCapacityKJ > 0 && (d.Role != "station" || d.PowerKW < 1 || d.Energy != "shaft" && d.Energy != "hydraulic" && d.Energy != "electric") {
			return fmt.Errorf("invalid robot station: %s", d.ID)
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
	robotItems := map[string]bool{}
	for _, r := range c.Robots {
		if !items[r.Item] || robotItems[r.Item] || r.Name == "" || r.Tier < 1 || r.Tier > 6 || r.Capacity < 0 || r.Capacity > 32 || r.EnergyCapacityKJ < 1 || r.EnergyCapacityKJ > 30000 || r.ActionTicks < 1 || r.ActionTicks > 60 || r.Energy != "shaft" && r.Energy != "hydraulic" && r.Energy != "electric" || r.Role != "carrier" && r.Role != "inspector" && r.Role != "repair" && r.Role != "smart" {
			return fmt.Errorf("invalid robot definition: %s", r.Item)
		}
		robotItems[r.Item] = true
	}
	for _, r := range c.Recipes {
		if len(r.Inputs) > 12 || len(r.Outputs) > 12 || r.PowerKW < 0 || r.PowerKW > 1000 || r.Tier < 0 || r.Tier > 6 || (r.Gate != "" && !items[r.Gate]) {
			return fmt.Errorf("invalid recipe capacity or gate: %s", r.ID)
		}
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
	if c.Version == 2 {
		if len(c.Stages) != 6 || !items[c.RootItem] || len(c.StartingMachines) != 3 {
			return fmt.Errorf("invalid industrial progression")
		}
		for i, s := range c.Stages {
			if s.Tier != i+1 || s.Name == "" || s.Goal == "" || !items[s.MilestoneItem] {
				return fmt.Errorf("invalid stage")
			}
		}
		for _, id := range c.StartingMachines {
			if !buildings[id] {
				return fmt.Errorf("unknown starting machine")
			}
		}
	}
	return validateQuestDefinitions(c)
}
