package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type RobotEndpoint struct {
	FactoryID  string `json:"factory_id"`
	BuildingID string `json:"building_id"`
}
type RobotTask struct {
	ID        string        `json:"id"`
	Source    RobotEndpoint `json:"source"`
	Target    RobotEndpoint `json:"target"`
	Item      string        `json:"item"`
	Count     int           `json:"count"`
	Channel   string        `json:"channel"`
	Repeat    bool          `json:"repeat"`
	Phase     string        `json:"phase"`
	Delivered int           `json:"delivered"`
}
type RobotTransit struct {
	ToFactoryID    string `json:"to_factory_id"`
	X              int    `json:"x"`
	Y              int    `json:"y"`
	RemainingTicks int    `json:"remaining_ticks"`
}

func decodeRobotObject(data []byte, dest any, required ...string) error {
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	for _, key := range required {
		value, ok := shape[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("missing or null robot field: %s", key)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}
func (e *RobotEndpoint) UnmarshalJSON(data []byte) error {
	type plain RobotEndpoint
	return decodeRobotObject(data, (*plain)(e), "factory_id", "building_id")
}
func (t *RobotTask) UnmarshalJSON(data []byte) error {
	type plain RobotTask
	return decodeRobotObject(data, (*plain)(t), "id", "source", "target", "item", "count", "channel", "repeat", "phase", "delivered")
}
func (t *RobotTransit) UnmarshalJSON(data []byte) error {
	type plain RobotTransit
	return decodeRobotObject(data, (*plain)(t), "to_factory_id", "x", "y", "remaining_ticks")
}

func validRobotFreight(r RobotState, d RobotDefinition, factories map[string]FactoryDetail, zones map[string]bool, c Catalog) bool {
	identifier := func(s string) bool { return len(s) > 0 && len(s) <= 128 }
	carry := func(item string) bool {
		if d.Capacity <= 0 || d.Role != "carrier" && d.Role != "smart" && d.Role != "repair" {
			return false
		}
		for _, i := range c.Items {
			if i.ID == item {
				return i.Kind != "fluid_or_gas" || d.Role == "smart" || d.Energy == "hydraulic"
			}
		}
		return false
	}
	validEnd := func(e RobotEndpoint) bool {
		_, exists := factories[e.FactoryID]
		// A deleted endpoint is legal persisted state; the next tick returns the
		// real cargo. The service validates shape, not routing or job success.
		return exists && zones[e.FactoryID] && identifier(e.FactoryID) && identifier(e.BuildingID)
	}
	status := false
	for _, s := range []string{"idle", "charging", "paused", "charged", "no_energy", "moving", "in_transit", "no_path", "congested", "loading", "unloading", "source_empty", "blocked", "rejected", "waiting_charge", "range_exceeded", "returning", "inspecting", "maintaining", "constructing"} {
		status = status || r.Status == s
	}
	workLimit := d.ActionTicks
	if r.Construction != nil {
		workLimit = 10
	}
	if !status || r.WorkProgress < 0 || r.WorkProgress > workLimit || r.CompletedTasks < 0 || r.CompletedTasks > 9007199254740991 {
		return false
	}
	if r.Returning != "" && r.Returning != "cancelled" && r.Returning != "energy" && r.Returning != "complete" && r.Returning != "invalid_target" {
		return false
	}
	if r.Cargo != nil && (!carry(r.Cargo.Item) || r.Cargo.Count < 1 || r.Cargo.Count > int64(d.Capacity)) {
		return false
	}
	if s := r.Service; s != nil {
		if r.Task != nil || !validEnd(s.Target) || s.SinceTick < 0 || s.SinceTick > factories[r.FactoryID].Simulation.Tick || s.Parts < 0 || s.Parts > 1 || s.Parts > d.Capacity {
			return false
		}
		if s.Kind == "inspect" {
			if d.Role != "inspector" && d.Role != "smart" || s.Parts != 0 || r.Cargo != nil {
				return false
			}
		} else if s.Kind == "maintain" {
			if d.Role != "repair" && d.Role != "smart" || s.Parts == 0 && r.Returning == "" {
				return false
			}
			if r.Cargo != nil {
				if r.Returning == "" || s.Parts != 0 {
					return false
				}
				for _, item := range c.Items {
					if item.ID == r.Cargo.Item && item.Kind == "fluid_or_gas" {
						return false
					}
				}
			}
		} else {
			return false
		}
	}
	if t := r.Task; t != nil {
		if d.Role != "carrier" && d.Role != "smart" {
			return false
		}
		if !identifier(t.ID) || !validEnd(t.Source) || !validEnd(t.Target) || t.Source == t.Target || !carry(t.Item) || t.Count < 1 || t.Count > d.Capacity || t.Channel != "auto" && t.Channel != "input" && t.Channel != "fuel" || t.Phase != "pickup" && t.Phase != "deliver" || t.Delivered < 0 || t.Delivered > t.Count || t.Phase == "pickup" && t.Delivered != 0 || t.Phase == "deliver" && r.Cargo == nil {
			return false
		}
		if r.Cargo != nil && (r.Cargo.Item != t.Item || r.Cargo.Count+int64(t.Delivered) > int64(t.Count)) {
			return false
		}
	} else if r.Cargo != nil && r.Returning == "" && r.Construction == nil {
		return false
	}
	if t := r.Transit; t != nil {
		if !d.CrossDistrict || !zones[t.ToFactoryID] || t.ToFactoryID == r.FactoryID || t.RemainingTicks < 0 || t.RemainingTicks > 8 || t.X < -1 || t.X > 1 || t.Y < -1 || t.Y > 1 || t.X*t.X+t.Y*t.Y != 1 || r.X*r.X+r.Y*r.Y != 1 {
			return false
		}
		dest, exists := factories[t.ToFactoryID]
		if !exists {
			return false
		}
		for _, b := range dest.Buildings {
			if b.X == t.X && b.Y == t.Y {
				return false
			}
		}
	}
	return true
}
