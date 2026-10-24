package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type RobotDefinition struct {
	Item             string `json:"item"`
	Name             string `json:"name"`
	Tier             int    `json:"tier"`
	Energy           string `json:"energy"`
	Capacity         int    `json:"capacity"`
	EnergyCapacityKJ int    `json:"energy_capacity_kj"`
	ActionTicks      int    `json:"action_ticks"`
	CrossDistrict    bool   `json:"cross_district"`
	Role             string `json:"role"`
	Description      string `json:"description"`
}
type RobotState struct {
	ID              string             `json:"id"`
	Item            string             `json:"item"`
	HomeFactoryID   string             `json:"home_factory_id"`
	HomeStation     string             `json:"home_station"`
	FactoryID       string             `json:"factory_id"`
	X               int                `json:"x"`
	Y               int                `json:"y"`
	EnergyKJ        int                `json:"energy_kj"`
	ChargeRemainder int                `json:"charge_remainder,omitempty"`
	Enabled         bool               `json:"enabled"`
	AllowedZones    []string           `json:"allowed_zones"`
	Priority        int                `json:"priority"`
	Cooldown        int                `json:"cooldown"`
	Status          string             `json:"status"`
	WorkProgress    int                `json:"work_progress,omitempty"`
	CompletedTasks  int64              `json:"completed_tasks,omitempty"`
	Returning       string             `json:"returning,omitempty"`
	Cargo           *Stack             `json:"cargo,omitempty"`
	Task            *RobotTask         `json:"task,omitempty"`
	Transit         *RobotTransit      `json:"transit,omitempty"`
	Camera          bool               `json:"camera,omitempty"`
	Service         *RobotService      `json:"service,omitempty"`
	Autonomy        *RobotAutonomy     `json:"autonomy,omitempty"`
	BehaviorLog     []RobotBehavior    `json:"behavior_log,omitempty"`
	Construction    *RobotConstruction `json:"construction,omitempty"`
}

func (r *RobotState) UnmarshalJSON(data []byte) error {
	type plain RobotState
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	for _, key := range []string{"id", "item", "home_factory_id", "home_station", "factory_id", "x", "y", "energy_kj", "enabled", "allowed_zones", "priority", "cooldown", "status"} {
		value, ok := shape[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("missing or null robot field: %s", key)
		}
	}
	for key, value := range shape {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("null robot field: %s", key)
		}
	}
	if value, ok := shape["returning"]; ok && bytes.Equal(bytes.TrimSpace(value), []byte(`""`)) {
		return fmt.Errorf("empty robot return reason")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode((*plain)(r))
}

// These are structure and capacity checks. The server does not prove that the
// single-player client honestly paid the deployment or energy costs.
func validRobotWorld(f FactoryDetail, c Catalog) bool {
	if len(f.Robots) > 500 {
		return false
	}
	factories := map[string]FactoryDetail{f.ID: f}
	for _, child := range f.Districts {
		factories[child.ID] = child
	}
	definitions := map[string]RobotDefinition{}
	buildings := map[string]BuildingDefinition{}
	for _, r := range c.Robots {
		definitions[r.Item] = r
	}
	for _, b := range c.Buildings {
		buildings[b.ID] = b
	}
	ids, cells := map[string]bool{}, map[string]bool{}
	for _, r := range f.Robots {
		d, ok := definitions[r.Item]
		home, found := factories[r.HomeFactoryID]
		current, exists := factories[r.FactoryID]
		if !ok || !found || !exists || r.ID == "" || len(r.ID) > 128 || ids[r.ID] || r.X < -10 || r.X > 10 || r.Y < -10 || r.Y > 10 || r.EnergyKJ < 0 || r.EnergyKJ > d.EnergyCapacityKJ || r.Priority < 1 || r.Priority > 6 || r.Cooldown < 0 || r.Cooldown > 60 || len(r.AllowedZones) < 1 || len(r.AllowedZones) > 100 {
			return false
		}
		if f.Simulation.Industry == nil || d.Tier > f.Simulation.Industry.Stage {
			return false
		}
		if r.Camera && f.Simulation.Industry.Stage < 5 {
			return false
		}
		if !validRobotAutonomy(r, d, f.Simulation.Tick) {
			return false
		}
		if r.ChargeRemainder < 0 || r.ChargeRemainder > 99 || r.ChargeRemainder > 0 && (d.Energy != "electric" || r.EnergyKJ == d.EnergyCapacityKJ) {
			return false
		}
		station := BuildingInstance{}
		for _, b := range home.Buildings {
			if b.ID == r.HomeStation {
				station = b
			}
		}
		sd := buildings[station.BuildingType]
		if station.ID == "" || sd.Role != "station" || sd.Energy != d.Energy || sd.StationCapacityKJ <= 0 {
			return false
		}
		if r.Transit == nil {
			for _, b := range current.Buildings {
				if footprintContains(b.X, b.Y, b.Size, r.X, r.Y) {
					return false
				}
			}
		}
		zones := map[string]bool{}
		for _, id := range r.AllowedZones {
			if _, ok := factories[id]; !ok || zones[id] || !d.CrossDistrict && id != home.ID {
				return false
			}
			zones[id] = true
		}
		if !zones[home.ID] || !zones[current.ID] || !validRobotFreight(r, d, factories, zones, c) || !validRobotConstruction(f, r, d, factories, zones, c) {
			return false
		}
		cell := fmt.Sprintf("%s:%d,%d", r.FactoryID, r.X, r.Y)
		if r.Transit == nil {
			if cells[cell] {
				return false
			}
			cells[cell] = true
		}
		ids[r.ID] = true
	}
	return true
}
