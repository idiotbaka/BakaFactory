package domain

import (
	"fmt"
	"math"
	"sort"
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

func endpoint(b BuildingInstance) TransferEndpoint {
	return TransferEndpoint{ID: b.ID, BuildingType: b.BuildingType, X: b.X, Y: b.Y, Rotation: b.Rotation}
}

type Simulation struct {
	Tick      int64                    `json:"tick"`
	TickRate  int                      `json:"tick_rate"`
	Buildings map[string]*MachineState `json:"buildings"`
	Warehouse map[string]int64         `json:"warehouse"`
	Transfers []ItemTransfer           `json:"transfers"`
}

func (inventory Inventory) Count(item string) int64 {
	for _, s := range inventory {
		if s.Item == item {
			return s.Count
		}
	}
	return 0
}
func (inventory Inventory) CanAdd(item string, count int64) bool {
	if count <= 0 {
		return false
	}
	for _, s := range inventory {
		if s.Item == item {
			return count <= StackLimit-s.Count
		}
	}
	return len(inventory) < InventorySlots && count <= StackLimit
}
func (inventory *Inventory) Add(item string, count int64) bool {
	if !inventory.CanAdd(item, count) {
		return false
	}
	for i := range *inventory {
		if (*inventory)[i].Item == item {
			(*inventory)[i].Count += count
			return true
		}
	}
	*inventory = append(*inventory, Stack{Item: item, Count: count})
	return true
}
func (inventory *Inventory) Remove(item string, count int64) bool {
	if count <= 0 {
		return false
	}
	for i, s := range *inventory {
		if s.Item == item && s.Count >= count {
			(*inventory)[i].Count -= count
			if (*inventory)[i].Count == 0 {
				*inventory = append((*inventory)[:i], (*inventory)[i+1:]...)
			}
			return true
		}
	}
	return false
}
func (s *Simulation) Normalize(buildings []BuildingInstance) {
	s.TickRate = TickRate
	if s.Warehouse == nil {
		s.Warehouse = map[string]int64{}
	}
	if s.Buildings == nil {
		s.Buildings = map[string]*MachineState{}
	}
	present := map[string]bool{}
	for _, b := range buildings {
		present[b.ID] = true
		m := s.Buildings[b.ID]
		if m == nil {
			m = &MachineState{Status: "idle"}
			s.Buildings[b.ID] = m
		}
		if m.Input == nil {
			m.Input = Inventory{}
		}
		if m.Output == nil {
			m.Output = Inventory{}
		}
		if m.Belt != nil && m.Belt.ID == "" {
			m.Belt.ID = "legacy:" + b.ID
		}
	}
	for id := range s.Buildings {
		if !present[id] {
			delete(s.Buildings, id)
		}
	}
	// Events are cosmetic history, never a source of inventory or gameplay.
	// Edits invalidate routes instead of drawing a transfer through moved tiles.
	current := map[string]TransferEndpoint{}
	for _, b := range buildings {
		current[b.ID] = endpoint(b)
	}
	events := make([]ItemTransfer, 0, len(s.Transfers))
	for _, event := range s.Transfers {
		if event.Tick < s.Tick-2 || event.Tick > s.Tick || current[event.Source.ID] != event.Source || current[event.Target.ID] != event.Target {
			continue
		}
		if event.Via != nil && current[event.Via.ID] != *event.Via {
			continue
		}
		events = append(events, event)
	}
	s.Transfers = events
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
		if m == nil || m.Progress < 0 || m.Progress > 100000 || m.Cooldown < 0 || m.Cooldown > TickRate {
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
			if m.Belt.ID == "" || payloadIDs[m.Belt.ID] {
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
func Direction(rotation int) (int, int) {
	switch rotation {
	case 90:
		return 0, -1
	case 180:
		return -1, 0
	case 270:
		return 0, 1
	default:
		return 1, 0
	}
}
func IsPort(kind string) bool { return kind == "item_output" || kind == "item_input" }

// Step advances exactly one second. No event can execute on a subsecond clock.
func Step(f FactoryDetail, c Catalog) Simulation {
	s := f.Simulation
	s.Normalize(f.Buildings)
	s.Tick++
	retained := make([]ItemTransfer, 0, len(s.Transfers))
	for _, event := range s.Transfers {
		if event.Tick >= s.Tick-2 {
			retained = append(retained, event)
		}
	}
	s.Transfers = retained
	definitions := map[string]BuildingDefinition{}
	recipes := map[string]RecipeDefinition{}
	for _, d := range c.Buildings {
		definitions[d.ID] = d
	}
	for _, r := range c.Recipes {
		recipes[r.BuildingType] = r
	}
	byPosition := map[[2]int]BuildingInstance{}
	byID := map[string]BuildingInstance{}
	ordered := append([]BuildingInstance(nil), f.Buildings...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	for _, b := range ordered {
		byPosition[[2]int{b.X, b.Y}] = b
		byID[b.ID] = b
		m := s.Buildings[b.ID]
		if m.Cooldown > 0 {
			m.Cooldown--
		}
		if b.BuildingType == "bus" {
			m.Status = "warehouse"
			continue
		}
		if b.BuildingType == "conveyor" {
			if m.Belt != nil {
				if m.Belt.Progress < TickRate {
					m.Belt.Progress++
				}
				if m.Belt.Progress >= TickRate {
					m.Status = "blocked"
				} else {
					m.Status = "transporting"
				}
			} else {
				m.Status = "idle"
			}
			continue
		}
		if IsPort(b.BuildingType) {
			if m.Cooldown > 0 {
				m.Status = "transferring"
			} else {
				m.Status = "no_source"
			}
			continue
		}
		r, exists := recipes[b.BuildingType]
		if !exists {
			m.Status = "idle"
			continue
		}
		m.Duration = int(r.DurationMS / TickDurationMS)
		enough := true
		for item, count := range r.Inputs {
			if m.Input.Count(item) < count {
				enough = false
			}
		}
		if !enough {
			m.Status = "no_input"
			continue
		}
		// Reserve output capacity before work; inputs remain in place until completion.
		output := append(Inventory(nil), m.Output...)
		fits := true
		for _, item := range sortedKeys(r.Outputs) {
			if !output.Add(item, r.Outputs[item]) {
				fits = false
				break
			}
		}
		if !fits {
			m.Status = "output_full"
			continue
		}
		m.Progress++
		m.Status = "working"
		if m.Progress >= m.Duration {
			for item, count := range r.Inputs {
				m.Input.Remove(item, count)
			}
			m.Output = output
			m.Progress = 0
		}
	}

	type transfer struct{ source, target, item, port, itemID string }
	candidates := []transfer{}
	sourceItem := func(b BuildingInstance) string {
		m := s.Buildings[b.ID]
		if m == nil {
			return ""
		}
		if b.BuildingType == "conveyor" {
			if m.Belt != nil && m.Belt.Progress >= TickRate {
				return m.Belt.Item
			}
			return ""
		}
		if _, produces := recipes[b.BuildingType]; produces && len(m.Output) > 0 {
			return m.Output[0].Item
		}
		return ""
	}
	for _, b := range ordered {
		dx, dy := Direction(b.Rotation)
		if b.BuildingType == "conveyor" {
			item := sourceItem(b)
			target := byPosition[[2]int{b.X + dx, b.Y + dy}]
			if item != "" && (target.BuildingType == "conveyor" || target.BuildingType == "bus") {
				// A conveyor accepts from behind or either side, never head-on.
				tx, ty := Direction(target.Rotation)
				if target.BuildingType != "conveyor" || target.X+tx != b.X || target.Y+ty != b.Y {
					candidates = append(candidates, transfer{source: b.ID, target: target.ID, item: item})
				}
			}
		} else if IsPort(b.BuildingType) && s.Buildings[b.ID].Cooldown == 0 {
			source := byPosition[[2]int{b.X - dx, b.Y - dy}]
			target := byPosition[[2]int{b.X + dx, b.Y + dy}]
			item := sourceItem(source)
			if item == "" {
				continue
			}
			m := s.Buildings[b.ID]
			m.Status = "blocked"
			if target.ID != "" && !IsPort(target.BuildingType) {
				candidates = append(candidates, transfer{source: source.ID, target: target.ID, item: item, port: b.ID})
			}
		}
	}
	// Stable rotating priority provides fairness when multiple ports target one slot.
	if len(candidates) > 0 {
		offset := int(s.Tick % int64(len(candidates)))
		candidates = append(candidates[offset:], candidates[:offset]...)
	}
	chosen := []transfer{}
	beltSource := map[string]int{}
	beltTarget := map[string]bool{}
	reservedSource := map[string]Inventory{}
	reservedInput := map[string]Inventory{}
	warehouseReservations := map[string]int64{}
	for _, t := range candidates {
		source, target := byID[t.source], byID[t.target]
		if source.BuildingType == "conveyor" {
			t.itemID = s.Buildings[source.ID].Belt.ID
		} else {
			t.itemID = fmt.Sprintf("%s:%d:%s", source.ID, s.Tick, target.ID)
		}
		targetState := s.Buildings[target.ID]
		if source.BuildingType == "conveyor" {
			if _, claimed := beltSource[source.ID]; claimed {
				continue
			}
		} else {
			inv, ok := reservedSource[source.ID]
			if !ok {
				inv = append(Inventory(nil), s.Buildings[source.ID].Output...)
			}
			if inv.Count(t.item) < 1 {
				continue
			}
		}
		if target.BuildingType == "conveyor" {
			if beltTarget[target.ID] {
				continue
			}
		} else if target.BuildingType == "bus" {
			if s.Warehouse[t.item] >= math.MaxInt64-warehouseReservations[t.item] {
				continue
			}
		} else {
			allowed := false
			for _, item := range definitions[target.BuildingType].InputWhitelist {
				allowed = allowed || item == t.item
			}
			if !allowed {
				if t.port != "" {
					s.Buildings[t.port].Status = "rejected"
				}
				continue
			}
			inv, ok := reservedInput[target.ID]
			if !ok {
				inv = append(Inventory(nil), targetState.Input...)
			}
			if !inv.Add(t.item, 1) {
				continue
			}
			reservedInput[target.ID] = inv
		}
		if source.BuildingType == "conveyor" {
			beltSource[source.ID] = len(chosen)
		} else {
			inv, ok := reservedSource[source.ID]
			if !ok {
				inv = append(Inventory(nil), s.Buildings[source.ID].Output...)
			}
			inv.Remove(t.item, 1)
			reservedSource[source.ID] = inv
		}
		if target.BuildingType == "conveyor" {
			beltTarget[target.ID] = true
		}
		if target.BuildingType == "bus" {
			warehouseReservations[t.item]++
		}
		chosen = append(chosen, t)
	}
	// An occupied belt may receive only if its old payload leaves in this tick.
	// Resolve dependencies first, then remove all sources before filling targets.
	result := make([]int, len(chosen))
	var resolve func(int) bool
	resolve = func(i int) bool {
		if result[i] == 1 || result[i] == 2 {
			return true
		}
		if result[i] == 3 {
			return false
		}
		result[i] = 1
		t := chosen[i]
		target := byID[t.target]
		if target.BuildingType == "conveyor" && s.Buildings[target.ID].Belt != nil {
			dependency, exists := beltSource[target.ID]
			if !exists || !resolve(dependency) {
				result[i] = 3
				return false
			}
		}
		result[i] = 2
		return true
	}
	for i := range chosen {
		resolve(i)
	}
	for i, t := range chosen {
		if result[i] != 2 {
			continue
		}
		source := byID[t.source]
		m := s.Buildings[t.source]
		if source.BuildingType == "conveyor" {
			m.Belt = nil
			m.Status = "idle"
		} else {
			m.Output.Remove(t.item, 1)
		}
	}
	for i, t := range chosen {
		if result[i] != 2 {
			continue
		}
		target := byID[t.target]
		m := s.Buildings[t.target]
		if t.port != "" || target.BuildingType == "bus" {
			event := ItemTransfer{ID: fmt.Sprintf("transfer:%d:%s:%s:%s", s.Tick, t.source, t.target, t.port), PayloadID: t.itemID, Item: t.item, Tick: s.Tick, Source: endpoint(byID[t.source]), Target: endpoint(target)}
			if t.port != "" {
				port := endpoint(byID[t.port])
				event.Via = &port
			}
			s.Transfers = append(s.Transfers, event)
		}
		switch target.BuildingType {
		case "conveyor":
			m.Belt = &BeltItem{ID: t.itemID, Item: t.item}
			m.Status = "transporting"
		case "bus":
			s.Warehouse[t.item]++
		default:
			m.Input.Add(t.item, 1)
		}
		if t.port != "" {
			port := s.Buildings[t.port]
			port.Cooldown = TickRate
			port.Status = "transferring"
		}
	}
	// Status describes the coming interval, so client-only progress prediction
	// stops immediately after the last input is used or output capacity fills.
	for _, b := range ordered {
		r, exists := recipes[b.BuildingType]
		if !exists {
			continue
		}
		m := s.Buildings[b.ID]
		m.Status = "working"
		for item, count := range r.Inputs {
			if m.Input.Count(item) < count {
				m.Status = "no_input"
				break
			}
		}
		if m.Status != "working" {
			continue
		}
		output := append(Inventory(nil), m.Output...)
		for _, item := range sortedKeys(r.Outputs) {
			if !output.Add(item, r.Outputs[item]) {
				m.Status = "output_full"
				break
			}
		}
	}
	return s
}
func sortedKeys(values map[string]int64) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
