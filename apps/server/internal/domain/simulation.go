package domain

import (
	"fmt"
)

const TickRate = 1
const TickDurationMS = 1000
const InventorySlots = 12
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
	Count    *int   `json:"count,omitempty"`
}
type MachineState struct {
	BatchesCompleted int64         `json:"batches_completed,omitempty"`
	Incident         *WorkIncident `json:"incident,omitempty"`
	StationEnergyKJ  int           `json:"station_energy_kj,omitempty"`
	Fluid            *FluidVolume  `json:"fluid,omitempty"`
	FlowIn           int           `json:"flow_in,omitempty"`
	FlowOut          int           `json:"flow_out,omitempty"`
	FluidCursor      int           `json:"fluid_cursor,omitempty"`
	WorkEnergyKJ     int           `json:"work_energy_kj,omitempty"`
	Powered          bool          `json:"powered,omitempty"`
	GeneratedKW      int           `json:"generated_kw,omitempty"`
	PowerDemandKW    int           `json:"power_demand_kw,omitempty"`
	NetworkID        string        `json:"network_id,omitempty"`
	ChargeKJ         int           `json:"charge_kj,omitempty"`
	ChargeRemainder  int           `json:"charge_remainder,omitempty"`
	Medium           int           `json:"medium,omitempty"`
	SuppliedKW       int           `json:"supplied_kw,omitempty"`
	Fuel             Inventory     `json:"fuel,omitempty"`
	EnergyKJ         int           `json:"energy_kj,omitempty"`
	Input            Inventory     `json:"input"`
	Output           Inventory     `json:"output"`
	Progress         int           `json:"progress"`
	Duration         int           `json:"duration"`
	Cooldown         int           `json:"cooldown"`
	Status           string        `json:"status"`
	Belt             *BeltItem     `json:"belt,omitempty"`
}
type FluidVolume struct {
	Item  string `json:"item"`
	Count int    `json:"count"`
}
type TransferEndpoint struct {
	ID           string `json:"id"`
	BuildingType string `json:"building_type"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	Rotation     int    `json:"rotation"`
}
type ItemTransfer struct {
	Count     *int              `json:"count,omitempty"`
	ID        string            `json:"id"`
	PayloadID string            `json:"payload_id"`
	Item      string            `json:"item"`
	Tick      int64             `json:"tick"`
	Source    TransferEndpoint  `json:"source"`
	Target    TransferEndpoint  `json:"target"`
	Via       *TransferEndpoint `json:"via,omitempty"`
}

type Simulation struct {
	Networks  []PowerNetwork           `json:"networks,omitempty"`
	Tick      int64                    `json:"tick"`
	TickRate  int                      `json:"tick_rate"`
	Buildings map[string]*MachineState `json:"buildings"`
	Warehouse map[string]int64         `json:"warehouse"`
	Transfers []ItemTransfer           `json:"transfers"`
	Industry  *IndustryState           `json:"industry,omitempty"`
}
type PowerNetwork struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Producers   int    `json:"producers"`
	Consumers   int    `json:"consumers"`
	CapacityKW  int    `json:"capacity_kw"`
	DemandKW    int    `json:"demand_kw"`
	SuppliedKW  int    `json:"supplied_kw"`
	LossKW      int    `json:"loss_kw"`
	ChargeKW    int    `json:"charge_kw"`
	DischargeKW int    `json:"discharge_kw"`
	StoredKJ    int    `json:"stored_kj"`
}
type WorkshopJob struct {
	RecipeID  string         `json:"recipe_id"`
	Progress  int            `json:"progress"`
	Remaining *int           `json:"remaining,omitempty"`
	Total     *int           `json:"total,omitempty"`
	Order     *WorkshopOrder `json:"order,omitempty"`
}
type IndustryState struct {
	Developer       *DeveloperSettings `json:"developer,omitempty"`
	Quests          *QuestProgress     `json:"quests,omitempty"`
	DiscoveredItems []string           `json:"discovered_items,omitempty"`
	WorkReceipts    []WorkReceipt      `json:"work_receipts,omitempty"`
	Stage           int                `json:"stage"`
	Milestones      []string           `json:"milestones"`
	Crafted         map[string]int64   `json:"crafted"`
	Workshop        *WorkshopJob       `json:"workshop,omitempty"`
}

func (s Simulation) Validate(c Catalog) error {
	items := map[string]bool{}
	fluids := map[string]bool{}
	for _, item := range c.Items {
		items[item.ID] = true
		if item.Kind == "fluid_or_gas" {
			fluids[item.ID] = true
		}
	}
	if s.Tick < 0 {
		return fmt.Errorf("negative simulation tick")
	}
	payloadIDs := map[string]bool{}
	for _, m := range s.Buildings {
		if m == nil || m.Input == nil || m.Output == nil || m.Progress < 0 || m.Progress > 100000 || m.Duration < 0 || m.Duration > 100000 || m.Cooldown < 0 || m.Cooldown > 60 || m.SuppliedKW < 0 || m.SuppliedKW > 1000 {
			return fmt.Errorf("invalid machine state")
		}
		if m.BatchesCompleted < 0 || m.BatchesCompleted > MaxSafeInteger || !validWorkIncident(m.Incident, s.Tick) {
			return fmt.Errorf("invalid work incident")
		}
		if m.EnergyKJ < 0 || m.EnergyKJ > 16000 || m.StationEnergyKJ < 0 || m.StationEnergyKJ > 30000 || len(m.Fuel) > 3 {
			return fmt.Errorf("invalid fuel buffer")
		}
		if m.FlowIn < 0 || m.FlowIn > 80 || m.FlowOut < 0 || m.FlowOut > 80 || m.FluidCursor < 0 || m.FluidCursor > 29 || m.Fluid != nil && (!fluids[m.Fluid.Item] || m.Fluid.Count < 1 || m.Fluid.Count > 500) {
			return fmt.Errorf("invalid fluid state")
		}
		if m.WorkEnergyKJ < 0 || m.WorkEnergyKJ > 1000 || m.GeneratedKW < 0 || m.GeneratedKW > 1000 || m.PowerDemandKW < 0 || m.PowerDemandKW > 1000 || len(m.NetworkID) > 160 || m.ChargeKJ < 0 || m.ChargeKJ > 30000 || m.ChargeRemainder < 0 || m.ChargeRemainder > 99 || m.Medium < 0 || m.Medium > 10 {
			return fmt.Errorf("invalid power state")
		}
		for _, inv := range []Inventory{m.Input, m.Output, m.Fuel} {
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
		if m.Belt != nil && (!items[m.Belt.Item] || m.Belt.Progress < 0 || m.Belt.Progress > 3 || m.Belt.Count != nil && (*m.Belt.Count < 1 || *m.Belt.Count > 6)) {
			return fmt.Errorf("invalid conveyor payload")
		}
		if m.Belt != nil {
			if m.Belt.ID == "" || len(m.Belt.ID) > 128 || payloadIDs[m.Belt.ID] {
				return fmt.Errorf("invalid or duplicate payload identity")
			}
			payloadIDs[m.Belt.ID] = true
		}
	}
	if len(s.Networks) > 3*len(s.Buildings) {
		return fmt.Errorf("too many networks")
	}
	for _, n := range s.Networks {
		if n.ID == "" || len(n.ID) > 160 || (n.Kind != "shaft" && n.Kind != "hydraulic" && n.Kind != "electric") || n.Producers < 0 || n.Producers > len(s.Buildings) || n.Consumers < 0 || n.Consumers > len(s.Buildings) {
			return fmt.Errorf("invalid power network")
		}
		for _, value := range []int{n.CapacityKW, n.DemandKW, n.SuppliedKW, n.LossKW, n.ChargeKW, n.DischargeKW, n.StoredKJ} {
			if value < 0 || value > 1000000000 {
				return fmt.Errorf("invalid network ledger")
			}
		}
	}
	for item, count := range s.Warehouse {
		if !items[item] || count < 0 {
			return fmt.Errorf("invalid warehouse stack")
		}
	}
	for _, event := range s.Transfers {
		if event.Count != nil && (*event.Count < 1 || *event.Count > 6) {
			return fmt.Errorf("invalid transfer batch")
		}
	}
	if p := s.Industry; p != nil {
		if !validQuestProgress(p.Quests, c) {
			return fmt.Errorf("invalid quest progress")
		}
		discovered := map[string]bool{}
		for _, id := range p.DiscoveredItems {
			if !items[id] || discovered[id] {
				return fmt.Errorf("invalid discovered item")
			}
			discovered[id] = true
		}
		if !validWorkReceipts(p.WorkReceipts, s.Tick, c) {
			return fmt.Errorf("invalid work receipts")
		}
		if len(c.Stages) != 6 || p.Stage < 1 || p.Stage > 6 || p.Milestones == nil || len(p.Milestones) > 6 || p.Crafted == nil {
			return fmt.Errorf("invalid progression")
		}
		seen := map[string]bool{}
		for _, id := range p.Milestones {
			valid := false
			for _, stage := range c.Stages {
				valid = valid || stage.MilestoneItem == id
			}
			if !valid || seen[id] {
				return fmt.Errorf("invalid milestone")
			}
			seen[id] = true
		}
		if p.Stage != expectedQuestStage(p, c) {
			return fmt.Errorf("inconsistent stage")
		}
		for id, n := range p.Crafted {
			if !items[id] || n < 0 || n > MaxSafeInteger {
				return fmt.Errorf("invalid crafted count")
			}
		}
		if p.Workshop != nil {
			if !validWorkshopCounts(p.Workshop) {
				return fmt.Errorf("invalid workshop batches")
			}
			if p.Workshop.Order != nil && !validWorkshopOrder(p, c) {
				return fmt.Errorf("invalid workshop order")
			}
			valid := false
			for _, r := range c.Recipes {
				// Preserve old pre-bonus queues up to the original recipe duration.
				// The client settles at most one retained batch on its next tick.
				if r.ID == p.Workshop.RecipeID && workshopMachineAvailable(c, p, r.BuildingType) && r.Tier <= p.Stage && p.Workshop.Progress >= 0 && int64(p.Workshop.Progress) < r.DurationMS/1000 {
					valid = true
				}
			}
			if !valid {
				return fmt.Errorf("invalid workshop job")
			}
		}
	}
	return nil
}
