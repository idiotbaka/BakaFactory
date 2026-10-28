package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// One paid device is held in Cargo until installation or physical return.
type RobotConstruction struct {
	Size         *int    `json:"size,omitempty"`
	ID           string  `json:"id"`
	FactoryID    string  `json:"factory_id"`
	BuildingType string  `json:"building_type"`
	X            int     `json:"x"`
	Y            int     `json:"y"`
	Rotation     int     `json:"rotation"`
	RecipeID     *string `json:"recipe_id,omitempty"`
}

func (v *RobotConstruction) UnmarshalJSON(data []byte) error {
	if err := rejectNullSize(data); err != nil {
		return err
	}
	type plain RobotConstruction
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	if raw, ok := shape["recipe_id"]; ok && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("null construction recipe")
	}
	return decodeRobotObject(data, (*plain)(v), "id", "factory_id", "building_type", "x", "y", "rotation")
}
func validRobotConstruction(root FactoryDetail, r RobotState, d RobotDefinition, factories map[string]FactoryDetail, zones map[string]bool, c Catalog) bool {
	v := r.Construction
	if v == nil {
		return true
	}
	f, exists := factories[v.FactoryID]
	if !exists || !zones[v.FactoryID] || d.Role != "smart" || r.Task != nil || r.Service != nil || v.ID == "" || len(v.ID) > 128 || v.X < -10 || v.X > 10 || v.Y < -10 || v.Y > 10 || v.Rotation != 0 && v.Rotation != 90 && v.Rotation != 180 && v.Rotation != 270 {
		return false
	}
	definitions := map[string]BuildingDefinition{}
	for _, b := range c.Buildings {
		definitions[b.ID] = b
	}
	b, ok := definitions[v.BuildingType]
	if !ok || b.ID == undergroundType || !validFootprintSize(b, v.Size) || !footprintInBounds(v.X, v.Y, v.Size) || b.Item == "" || b.Fixed || b.Tier > root.Simulation.Industry.Stage {
		return false
	}
	if v.RecipeID != nil {
		found := false
		for _, recipe := range c.Recipes {
			if recipe.ID == *v.RecipeID && recipe.BuildingType == v.BuildingType && recipe.Tier <= root.Simulation.Industry.Stage {
				found = recipe.Gate == ""
				for _, milestone := range root.Simulation.Industry.Milestones {
					if milestone == recipe.Gate {
						found = true
					}
				}
			}
		}
		if !found {
			return false
		}
	}
	if r.Cargo != nil && (r.Cargo.Item != b.Item || r.Cargo.Count != 1) {
		return false
	}
	if r.Returning != "" {
		return true
	} // Released footprint; refund may already be in WH.
	if r.Cargo == nil {
		return false
	}
	for _, world := range factories {
		for _, actual := range world.Buildings {
			if actual.ID == v.ID || world.ID == f.ID && footprintOverlaps(actual.X, actual.Y, actual.Size, v.X, v.Y, v.Size) {
				return false
			}
		}
	}
	for _, other := range root.Robots {
		if other.Transit == nil && other.FactoryID == f.ID && footprintContains(v.X, v.Y, v.Size, other.X, other.Y) {
			return false
		}
		if t := other.Transit; t != nil && t.ToFactoryID == f.ID && footprintContains(v.X, v.Y, v.Size, t.X, t.Y) {
			return false
		}
		p := other.Construction
		if p == nil || other.Returning != "" {
			continue
		}
		if other.ID != r.ID && (p.ID == v.ID || p.FactoryID == f.ID && footprintOverlaps(p.X, p.Y, p.Size, v.X, v.Y, v.Size)) {
			return false
		}
	}
	if b.Role == "source" && v.Y != 10 {
		return false
	}
	return true
}
