package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxSafeInteger int64 = 9007199254740991

var ErrSaveConflict = errors.New("cloud save version conflict")

type GameSave struct {
	FormatVersion int           `json:"format_version"`
	RulesVersion  int           `json:"rules_version"`
	Factory       FactoryDetail `json:"factory"`
}

type CloudSave struct {
	Version int64    `json:"version"`
	SavedAt string   `json:"saved_at"`
	Save    GameSave `json:"save"`
}

// Validate checks bounded, compatible structure, not proof of honest production.
func (s GameSave) Validate(owner string, c Catalog) error {
	bad := func() error { return fmt.Errorf("%w: 存档格式或游戏版本不兼容", ErrValidation) }
	f := s.Factory
	if s.FormatVersion != 1 || (s.RulesVersion != 1 && s.RulesVersion != 2) || (s.RulesVersion == 2 && f.Simulation.Industry == nil) || f.OwnerID != owner || f.ID == "" || len(f.ID) > 128 || f.Width != InitialFactorySize || f.Height != InitialFactorySize || len(f.Buildings) < 1 || len(f.Buildings) > InitialFactorySize*InitialFactorySize || f.Revision < 0 || f.Revision > MaxSafeInteger {
		return bad()
	}
	if !utf8.ValidString(f.Name) || strings.TrimSpace(f.Name) == "" || utf8.RuneCountInString(f.Name) > 32 {
		return bad()
	}
	for _, ch := range f.Name {
		if unicode.IsControl(ch) {
			return bad()
		}
	}
	definitions := map[string]bool{}
	limits := map[string]BuildingDefinition{}
	for _, d := range c.Buildings {
		definitions[d.ID] = true
		limits[d.ID] = d
	}
	ids := map[string]bool{}
	cells := map[[2]int]bool{}
	buses := 0
	for _, b := range f.Buildings {
		cell := [2]int{b.X, b.Y}
		if b.ID == "" || len(b.ID) > 128 || ids[b.ID] || cells[cell] || b.FactoryID != f.ID || !definitions[b.BuildingType] || !f.Contains(BuildingPlacement{X: b.X, Y: b.Y}) || (b.Rotation != 0 && b.Rotation != 90 && b.Rotation != 180 && b.Rotation != 270) {
			return bad()
		}
		if b.BuildingType == "bus" {
			buses++
			if b.X != 0 || b.Y != 0 || b.Rotation != 0 {
				return bad()
			}
		}
		configuration := bytes.TrimSpace(b.Configuration)
		if len(configuration) < 2 || configuration[0] != '{' || configuration[len(configuration)-1] != '}' {
			return bad()
		}
		if m := f.Simulation.Buildings[b.ID]; m != nil && m.Belt != nil {
			d := limits[b.BuildingType]
			duration, capacity := d.BeltTicks, d.BatchSize
			if duration == 0 {
				duration = 1
			}
			if capacity == 0 {
				capacity = 1
			}
			if (b.BuildingType != "conveyor" && d.Role != "belt") || m.Belt.Progress > duration || m.Belt.Count != nil && *m.Belt.Count > capacity {
				return bad()
			}
			for _, item := range c.Items {
				if item.ID == m.Belt.Item && item.Kind == "fluid_or_gas" {
					return bad()
				}
			}
		}
		if limits[b.BuildingType].Role == "source" && b.Y != InitialFactorySize/2 {
			return bad()
		}
		if m := f.Simulation.Buildings[b.ID]; m != nil && (len(m.Input) > limits[b.BuildingType].InputSlots || len(m.Output) > limits[b.BuildingType].OutputSlots) {
			return bad()
		}
		if m := f.Simulation.Buildings[b.ID]; m != nil {
			if m.StationEnergyKJ < 0 || m.StationEnergyKJ > limits[b.BuildingType].StationCapacityKJ {
				return bad()
			}
			if m.FluidCursor > 0 && limits[b.BuildingType].Role != "valve" {
				return bad()
			}
			if m.Fluid != nil {
				d := limits[b.BuildingType]
				if d.FluidCapacity == 0 || m.Fluid.Count > d.FluidCapacity {
					return bad()
				}
				if len(d.InputWhitelist) > 0 {
					allowed := false
					for _, id := range d.InputWhitelist {
						allowed = allowed || id == m.Fluid.Item
					}
					if !allowed {
						return bad()
					}
				}
			}
			if m.ChargeKJ > limits[b.BuildingType].CapacityKJ || (m.ChargeRemainder > 0 && limits[b.BuildingType].Role != "battery") || m.Medium > 0 && b.BuildingType != "m21" {
				return bad()
			}
			allowed := map[string]bool{}
			for _, item := range c.Items {
				if limits[b.BuildingType].Energy == "heat" || b.BuildingType == "m09" {
					if item.Name == "干燥生物质" || item.Name == "生物炭" || item.Name == "固体燃料块" {
						allowed[item.ID] = true
					}
				}
				if (b.BuildingType == "m21" || b.BuildingType == "m28") && item.Name == "液体燃料" {
					allowed[item.ID] = true
				}
				if b.BuildingType == "m20" && item.Name == "高压蒸汽" {
					allowed[item.ID] = true
				}
			}
			if m.EnergyKJ > 0 && len(allowed) == 0 {
				return bad()
			}
			for _, stack := range m.Fuel {
				if !allowed[stack.Item] {
					return bad()
				}
			}
		}
		var config map[string]json.RawMessage
		if json.Unmarshal(configuration, &config) != nil {
			return bad()
		}
		if raw, ok := config["recipe_id"]; ok {
			var id string
			if json.Unmarshal(raw, &id) != nil {
				return bad()
			}
			valid := false
			for _, r := range c.Recipes {
				valid = valid || r.ID == id && r.BuildingType == b.BuildingType
			}
			if !valid {
				return bad()
			}
		}
		if !validTransportConfiguration(b.BuildingType, config, c) {
			return bad()
		}
		ids[b.ID] = true
		cells[cell] = true
	}
	sim := f.Simulation
	if buses != 1 || sim.TickRate != 1 || sim.Tick > MaxSafeInteger || len(sim.Buildings) != len(ids) || sim.Warehouse == nil || sim.Transfers == nil || len(sim.Transfers) > 3*len(ids) {
		return bad()
	}
	for id := range ids {
		if sim.Buildings[id] == nil {
			return bad()
		}
	}
	for _, count := range sim.Warehouse {
		if count > MaxSafeInteger {
			return bad()
		}
	}
	if err := sim.Validate(c); err != nil {
		return bad()
	}
	stage, sources := 1, 0
	if sim.Industry != nil {
		stage = sim.Industry.Stage
	}
	for _, b := range f.Buildings {
		if limits[b.BuildingType].Role == "source" {
			sources++
		}
	}
	if sources > []int{1, 2, 4, 8, 12, 16}[stage-1] {
		return bad()
	}
	if f.Districts != nil || f.ActiveDistrictID != "" {
		if sim.Industry == nil || len(f.Districts)+1 > []int{6, 12, 24, 40, 70, 100}[stage-1] {
			return bad()
		}
		factoryIDs := map[string]bool{f.ID: true}
		for _, child := range f.Districts {
			if child.Districts != nil || child.ActiveDistrictID != "" || child.Robots != nil || child.Simulation.Industry != nil || child.Simulation.Tick != sim.Tick || factoryIDs[child.ID] {
				return bad()
			}
			for _, b := range child.Buildings {
				if limits[b.BuildingType].Role == "source" {
					return bad()
				}
			}
			factoryIDs[child.ID] = true
			child.Simulation.Industry = sim.Industry
			if err := (GameSave{FormatVersion: 1, RulesVersion: 2, Factory: child}).Validate(owner, c); err != nil {
				return bad()
			}
		}
		if !factoryIDs[f.ActiveDistrictID] {
			return bad()
		}
	}
	if !validRobotWorld(f, c) {
		return bad()
	}
	return nil
}
