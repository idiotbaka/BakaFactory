package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

type WorkIncident struct {
	Kind       string `json:"kind"`
	SinceTick  int64  `json:"since_tick"`
	Inspected  bool   `json:"inspected"`
	Maintained bool   `json:"maintained"`
}
type RobotService struct {
	Kind      string        `json:"kind"`
	Target    RobotEndpoint `json:"target"`
	SinceTick int64         `json:"since_tick"`
	Parts     int           `json:"parts"`
}
type WorkReceipt struct {
	Kind      string `json:"kind"`
	RobotID   string `json:"robot_id"`
	RobotItem string `json:"robot_item"`
	Count     int    `json:"count"`
	LastTick  int64  `json:"last_tick"`
}
type RobotAutonomy struct {
	Enabled  bool  `json:"enabled"`
	Refill   bool  `json:"refill"`
	Inspect  bool  `json:"inspect"`
	Maintain bool  `json:"maintain"`
	NextTick int64 `json:"next_tick"`
}
type RobotBehavior struct {
	Tick   int64  `json:"tick"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

func (v *RobotAutonomy) UnmarshalJSON(data []byte) error {
	type plain RobotAutonomy
	return decodeRobotObject(data, (*plain)(v), "enabled", "refill", "inspect", "maintain", "next_tick")
}
func (v *RobotBehavior) UnmarshalJSON(data []byte) error {
	type plain RobotBehavior
	return decodeRobotObject(data, (*plain)(v), "tick", "kind", "detail")
}
func validRobotAutonomy(r RobotState, d RobotDefinition, tick int64) bool {
	if a := r.Autonomy; a != nil {
		if d.Role != "smart" || a.NextTick < 0 || a.NextTick > min(MaxSafeInteger, tick+5) {
			return false
		}
	}
	if len(r.BehaviorLog) > 20 {
		return false
	}
	for _, e := range r.BehaviorLog {
		if e.Tick < 0 || e.Tick > tick || !utf8.ValidString(e.Detail) || utf8.RuneCountInString(e.Detail) < 1 || utf8.RuneCountInString(e.Detail) > 128 || e.Kind != "configured" && e.Kind != "refill" && e.Kind != "inspect" && e.Kind != "maintain" && e.Kind != "waiting" && e.Kind != "construct" && e.Kind != "built" {
			return false
		}
	}
	return true
}

func (v *WorkIncident) UnmarshalJSON(data []byte) error {
	type plain WorkIncident
	return decodeRobotObject(data, (*plain)(v), "kind", "since_tick", "inspected", "maintained")
}
func (v *RobotService) UnmarshalJSON(data []byte) error {
	type plain RobotService
	return decodeRobotObject(data, (*plain)(v), "kind", "target", "since_tick", "parts")
}
func (v *WorkReceipt) UnmarshalJSON(data []byte) error {
	type plain WorkReceipt
	return decodeRobotObject(data, (*plain)(v), "kind", "robot_id", "robot_item", "count", "last_tick")
}
func rejectNullWork(data []byte, keys ...string) error {
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	for _, k := range keys {
		if raw, ok := shape[k]; ok && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("null work field: %s", k)
		}
	}
	return nil
}
func (v *MachineState) UnmarshalJSON(data []byte) error {
	type plain MachineState
	if err := rejectNullWork(data, "batches_completed", "incident"); err != nil {
		return err
	}
	return decodeRobotObject(data, (*plain)(v))
}
func (v *IndustryState) UnmarshalJSON(data []byte) error {
	type plain IndustryState
	if err := rejectNullWork(data, "work_receipts", "discovered_items", "quests"); err != nil {
		return err
	}
	return decodeRobotObject(data, (*plain)(v))
}
func (v *WorkshopJob) UnmarshalJSON(data []byte) error {
	type plain WorkshopJob
	if err := rejectNullWork(data, "remaining", "total"); err != nil {
		return err
	}
	return decodeRobotObject(data, (*plain)(v), "recipe_id", "progress")
}
func validWorkshopCounts(v *WorkshopJob) bool {
	if v.Remaining == nil && v.Total == nil {
		return true
	}
	return v.Remaining != nil && v.Total != nil && *v.Remaining >= 1 && *v.Remaining <= *v.Total && *v.Total <= 100
}
func validWorkIncident(i *WorkIncident, tick int64) bool {
	return i == nil || (i.Kind == "no_input" || i.Kind == "no_energy" || i.Kind == "output_full" || i.Kind == "fluid_full") && i.SinceTick >= 0 && i.SinceTick <= tick
}
func validWorkReceipts(rows []WorkReceipt, tick int64, c Catalog) bool {
	if len(rows) > 1500 {
		return false
	}
	seen := map[string]bool{}
	for _, r := range rows {
		key := r.RobotID + ":" + r.Kind
		if r.Kind != "freight" && r.Kind != "inspection" && r.Kind != "visual" || len(r.RobotID) < 1 || len(r.RobotID) > 128 || r.Count < 1 || r.Count > 10000 || r.LastTick < 0 || r.LastTick > tick || seen[key] {
			return false
		}
		found := false
		for _, d := range c.Robots {
			found = found || d.Item == r.RobotItem
		}
		if !found {
			return false
		}
		seen[key] = true
	}
	return true
}
