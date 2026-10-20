package domain

import (
	"fmt"
)

const TickRate = 1
const TickDurationMS = 1000
const InventorySlots = 4
const StackLimit = 100

type Stack struct {
	Item  string `json:"item"`
	Count int64  `json:"count"`
}
type Inventory []Stack
type BeltItem struct {
	ID       string `json:"id"`
	Item     string `json:"item"`
	Progress int    `json:"progress"`
}
type MachineState struct {
	Input    Inventory `json:"input"`
	Output   Inventory `json:"output"`
	Progress int       `json:"progress"`
	Duration int       `json:"duration"`
	Cooldown int       `json:"cooldown"`
	Status   string    `json:"status"`
	Belt     *BeltItem `json:"belt,omitempty"`
}
type TransferEndpoint struct {
	ID           string `json:"id"`
	BuildingType string `json:"building_type"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	Rotation     int    `json:"rotation"`
}
type ItemTransfer struct {
	ID        string            `json:"id"`
	PayloadID string            `json:"payload_id"`
	Item      string            `json:"item"`
	Tick      int64             `json:"tick"`
	Source    TransferEndpoint  `json:"source"`
	Target    TransferEndpoint  `json:"target"`
	Via       *TransferEndpoint `json:"via,omitempty"`
}

type Simulation struct {
	Tick      int64                    `json:"tick"`
	TickRate  int                      `json:"tick_rate"`
	Buildings map[string]*MachineState `json:"buildings"`
	Warehouse map[string]int64         `json:"warehouse"`
	Transfers []ItemTransfer           `json:"transfers"`
}

func (s Simulation) Validate(c Catalog) error {
	items := map[string]bool{}
	for _, item := range c.Items {
		items[item.ID] = true
	}
	if s.Tick < 0 {
		return fmt.Errorf("negative simulation tick")
	}
	payloadIDs := map[string]bool{}
	for _, m := range s.Buildings {
		if m == nil || m.Input == nil || m.Output == nil || m.Progress < 0 || m.Progress > 100000 || m.Duration < 0 || m.Duration > 100000 || m.Cooldown < 0 || m.Cooldown > TickRate {
			return fmt.Errorf("invalid machine state")
		}
		for _, inv := range []Inventory{m.Input, m.Output} {
			if len(inv) > InventorySlots {
				return fmt.Errorf("too many inventory slots")
			}
			seen := map[string]bool{}
			for _, stack := range inv {
				if !items[stack.Item] || seen[stack.Item] || stack.Count <= 0 || stack.Count > StackLimit {
					return fmt.Errorf("invalid inventory stack")
				}
				seen[stack.Item] = true
			}
		}
		if m.Belt != nil && (!items[m.Belt.Item] || m.Belt.Progress < 0 || m.Belt.Progress > TickRate) {
			return fmt.Errorf("invalid conveyor payload")
		}
		if m.Belt != nil {
			if m.Belt.ID == "" || len(m.Belt.ID) > 128 || payloadIDs[m.Belt.ID] {
				return fmt.Errorf("invalid or duplicate payload identity")
			}
			payloadIDs[m.Belt.ID] = true
		}
	}
	for item, count := range s.Warehouse {
		if !items[item] || count < 0 {
			return fmt.Errorf("invalid warehouse stack")
		}
	}
	return nil
}
