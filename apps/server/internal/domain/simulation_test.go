package domain_test

import (
	"bakafactory/server/internal/catalog"
	"bakafactory/server/internal/domain"
	"testing"
)

func definitions(t *testing.T) domain.Catalog {
	t.Helper()
	c, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func building(id, kind string, x, y, rotation int) domain.BuildingInstance {
	return domain.BuildingInstance{ID: id, BuildingType: kind, X: x, Y: y, Rotation: rotation}
}
func world(buildings ...domain.BuildingInstance) domain.FactoryDetail {
	f := domain.FactoryDetail{Buildings: buildings}
	f.Simulation.Normalize(buildings)
	return f
}
func advance(f *domain.FactoryDetail, c domain.Catalog, ticks int) {
	for range ticks {
		f.Simulation = domain.Step(*f, c)
	}
}
func TestInventorySingleStackAndCapacity(t *testing.T) {
	var inv domain.Inventory
	if !inv.Add("iron_ore", 99) || !inv.Add("iron_ore", 1) || len(inv) != 1 || inv.Add("iron_ore", 1) {
		t.Fatal("same item must occupy one capped stack")
	}
	for _, id := range []string{"a", "b", "c"} {
		if !inv.Add(id, 1) {
			t.Fatal("missing default slots")
		}
	}
	if inv.Add("d", 1) || inv.Remove("iron_ore", 101) {
		t.Fatal("capacity or underflow accepted")
	}
	if !inv.Remove("iron_ore", 100) || !inv.Add("d", 1) {
		t.Fatal("empty stack did not free its slot")
	}
}
func TestProductionDurationsAndBackpressure(t *testing.T) {
	c := definitions(t)
	f := world(building("miner", "miner", -2, 0, 0), building("furnace", "furnace", 1, 0, 0), building("assembler", "assembler", 2, 0, 0))
	f.Simulation.Buildings["furnace"].Input.Add("iron_ore", 1)
	f.Simulation.Buildings["assembler"].Input.Add("iron_plate", 1)
	if f.Simulation.Buildings["miner"].Output.Count("iron_ore") != 0 {
		t.Fatal("mined before the first tick")
	}
	advance(&f, c, 1)
	if f.Simulation.Buildings["miner"].Output.Count("iron_ore") != 1 {
		t.Fatal("miner must produce every second")
	}
	advance(&f, c, 2)
	if f.Simulation.Buildings["furnace"].Output.Count("iron_plate") != 0 {
		t.Fatal("furnace completed early")
	}
	advance(&f, c, 1)
	if f.Simulation.Buildings["furnace"].Output.Count("iron_plate") != 1 || f.Simulation.Buildings["furnace"].Input.Count("iron_ore") != 0 {
		t.Fatal("furnace recipe mismatch")
	}
	advance(&f, c, 3)
	if f.Simulation.Buildings["assembler"].Output.Count("gear") != 0 {
		t.Fatal("assembler completed early")
	}
	advance(&f, c, 1)
	if f.Simulation.Buildings["assembler"].Output.Count("gear") != 1 {
		t.Fatal("assembler must take eight seconds")
	}
	advance(&f, c, 100)
	m := f.Simulation.Buildings["miner"]
	if m.Output.Count("iron_ore") != 100 || len(m.Output) != 1 || m.Status != "output_full" {
		t.Fatal("full output did not stop mining")
	}
	m.Output.Remove("iron_ore", 1)
	advance(&f, c, 1)
	if m.Output.Count("iron_ore") != 100 {
		t.Fatal("mining did not resume")
	}
}
func TestWhitelistAndPortDirections(t *testing.T) {
	c := definitions(t)
	for _, rotation := range []int{0, 90, 180, 270} {
		dx, dy := domain.Direction(rotation)
		f := world(building("source", "furnace", -dx, -dy, 0), building("port", "item_input", 0, 0, rotation), building("target", "assembler", dx, dy, 0))
		f.Simulation.Buildings["source"].Output.Add("iron_ore", 1)
		advance(&f, c, 1)
		if f.Simulation.Buildings["target"].Input.Count("iron_ore") != 0 || f.Simulation.Buildings["source"].Output.Count("iron_ore") != 1 || f.Simulation.Buildings["port"].Status != "rejected" {
			t.Fatalf("rotation %d bypassed whitelist", rotation)
		}
		f.Simulation.Buildings["source"].Output.Remove("iron_ore", 1)
		f.Simulation.Buildings["source"].Output.Add("iron_plate", 1)
		advance(&f, c, 1)
		if f.Simulation.Buildings["target"].Input.Count("iron_plate") != 1 {
			t.Fatalf("rotation %d did not transfer to front", rotation)
		}
	}
}
func TestConveyorSpeedAndSimultaneousVacating(t *testing.T) {
	c := definitions(t)
	f := world(building("z-first", "conveyor", 0, 0, 0), building("a-next", "conveyor", 1, 0, 0), building("bus", "bus", 2, 0, 0))
	f.Simulation.Buildings["z-first"].Belt = &domain.BeltItem{ID: "ore", Item: "iron_ore"}
	if f.Simulation.Buildings["a-next"].Belt != nil {
		t.Fatal("conveyor moved before one second")
	}
	advance(&f, c, 1)
	if f.Simulation.Buildings["a-next"].Belt == nil || f.Simulation.Buildings["a-next"].Belt.Progress != 0 || f.Simulation.Warehouse["iron_ore"] != 0 {
		t.Fatal("item crossed more than one tile")
	}
	if f.Simulation.Buildings["a-next"].Belt.ID != "ore" {
		t.Fatal("payload identity changed during movement")
	}
	f.Simulation.Buildings["z-first"].Belt = &domain.BeltItem{ID: "plate", Item: "iron_plate"}
	advance(&f, c, 1)
	if f.Simulation.Warehouse["iron_ore"] != 1 || f.Simulation.Buildings["a-next"].Belt.Item != "iron_plate" || f.Simulation.Buildings["z-first"].Belt != nil {
		t.Fatal("simultaneous chain advancement lost throughput or items")
	}
}
func TestBlockedConveyorAndCompetingPortsConserveItems(t *testing.T) {
	c := definitions(t)
	blocked := world(building("one", "conveyor", 0, 0, 0), building("two", "conveyor", 1, 0, 0))
	for _, id := range []string{"one", "two"} {
		blocked.Simulation.Buildings[id].Belt = &domain.BeltItem{Item: "iron_ore"}
	}
	advance(&blocked, c, 3)
	for _, id := range []string{"one", "two"} {
		m := blocked.Simulation.Buildings[id]
		if m.Belt == nil || m.Belt.Progress != 1 || m.Status != "blocked" {
			t.Fatal("blocked belt lost its payload")
		}
	}
	f := world(building("source", "furnace", 0, 0, 0), building("left", "item_output", -1, 0, 180), building("right", "item_output", 1, 0, 0), building("bus-left", "bus", -2, 0, 0), building("bus-right", "bus", 2, 0, 0))
	f.Simulation.Buildings["source"].Output.Add("iron_ore", 1)
	advance(&f, c, 1)
	if f.Simulation.Warehouse["iron_ore"] != 1 || f.Simulation.Buildings["source"].Output.Count("iron_ore") != 0 {
		t.Fatal("competing ports duplicated an item")
	}
}
func TestFullProductionChain(t *testing.T) {
	c := definitions(t)
	f := world(building("miner", "miner", -10, 0, 0), building("out1", "item_output", -9, 0, 0), building("belt1", "conveyor", -8, 0, 0), building("in1", "item_input", -7, 0, 0), building("furnace", "furnace", -6, 0, 0), building("out2", "item_output", -5, 0, 0), building("belt2", "conveyor", -4, 0, 0), building("in2", "item_input", -3, 0, 0), building("assembler", "assembler", -2, 0, 0), building("out3", "item_output", -1, 0, 0), building("bus", "bus", 0, 0, 0))
	advance(&f, c, 20)
	if f.Simulation.Warehouse["gear"] < 1 {
		t.Fatal("complete chain did not deliver gears to warehouse")
	}
	total := int64(0)
	for _, count := range f.Simulation.Warehouse {
		total += count
	}
	for _, m := range f.Simulation.Buildings {
		for _, inv := range []domain.Inventory{m.Input, m.Output} {
			for _, stack := range inv {
				total += stack.Count
			}
		}
		if m.Belt != nil {
			total++
		}
	}
	if total != 20 {
		t.Fatalf("expected twenty conserved items, got %d", total)
	}
	if err := f.Simulation.Validate(c); err != nil {
		t.Fatal(err)
	}
}

func TestTransferEventsFollowCommittedItems(t *testing.T) {
	c := definitions(t)
	f := world(building("source", "furnace", -2, 0, 0), building("out", "item_output", -1, 0, 0), building("belt", "conveyor", 0, 0, 0), building("in", "item_input", 1, 0, 0), building("target", "furnace", 2, 0, 0))
	f.Simulation.Buildings["source"].Output.Add("iron_ore", 1)
	advance(&f, c, 1)
	if len(f.Simulation.Transfers) != 1 {
		t.Fatal("successful output must emit one visual receipt")
	}
	first := f.Simulation.Transfers[0]
	if first.Tick != 1 || first.ID == "" || first.PayloadID != f.Simulation.Buildings["belt"].Belt.ID || first.Item != "iron_ore" || first.Source.ID != "source" || first.Target.ID != "belt" || first.Via == nil || first.Via.ID != "out" {
		t.Fatalf("output event does not match committed payload: %+v", first)
	}
	advance(&f, c, 1)
	if len(f.Simulation.Transfers) != 2 {
		t.Fatal("input must retain the first event and append one receipt")
	}
	second := f.Simulation.Transfers[1]
	if second.PayloadID != first.PayloadID || second.ID == first.ID || second.Tick != 2 || second.Source.ID != "belt" || second.Target.ID != "target" || second.Via == nil || second.Via.ID != "in" || f.Simulation.Buildings["target"].Input.Count("iron_ore") != 1 || f.Simulation.Buildings["belt"].Belt != nil {
		t.Fatalf("input receipt did not preserve identity / inventory: %+v", second)
	}
	advance(&f, c, 2)
	if len(f.Simulation.Transfers) != 1 || f.Simulation.Transfers[0].ID != second.ID {
		t.Fatal("history must retain only the latest three ticks")
	}
	advance(&f, c, 1)
	if len(f.Simulation.Transfers) != 0 {
		t.Fatal("expired cosmetic events must not accumulate")
	}
}

func TestBlockedAndRejectedTransfersHaveNoVisualReceipt(t *testing.T) {
	c := definitions(t)
	for _, target := range []string{"conveyor", "assembler"} {
		f := world(building("source", "furnace", -2, 0, 0), building("port", "item_output", -1, 0, 0), building("target", target, 0, 0, 0))
		f.Simulation.Buildings["source"].Output.Add("iron_ore", 1)
		if target == "conveyor" {
			f.Simulation.Buildings["target"].Belt = &domain.BeltItem{ID: "blocked", Item: "iron_ore", Progress: 1}
		}
		advance(&f, c, 1)
		if len(f.Simulation.Transfers) != 0 || f.Simulation.Buildings["source"].Output.Count("iron_ore") != 1 {
			t.Fatalf("%s rejection / blockage produced a fake transfer", target)
		}
	}
}

func TestBusReceiptAndEditedRouteInvalidation(t *testing.T) {
	c := definitions(t)
	f := world(building("belt", "conveyor", -1, 0, 0), building("bus", "bus", 0, 0, 0))
	f.Simulation.Buildings["belt"].Belt = &domain.BeltItem{ID: "ore", Item: "iron_ore"}
	advance(&f, c, 1)
	if len(f.Simulation.Transfers) != 1 || f.Simulation.Transfers[0].PayloadID != "ore" || f.Simulation.Transfers[0].Via != nil || f.Simulation.Transfers[0].Target.BuildingType != "bus" || f.Simulation.Warehouse["iron_ore"] != 1 {
		t.Fatal("direct belt to Bus must emit a receipt after storage commits")
	}
	f.Buildings[0].Y = 1
	f.Simulation.Normalize(f.Buildings)
	if len(f.Simulation.Transfers) != 0 || f.Simulation.Warehouse["iron_ore"] != 1 {
		t.Fatal("moving the source must discard only its cosmetic history")
	}
	for _, edited := range []string{"source", "port", "target"} {
		f = world(building("source", "furnace", -2, 0, 0), building("port", "item_output", -1, 0, 0), building("target", "bus", 0, 0, 0))
		f.Simulation.Buildings["source"].Output.Add("iron_ore", 1)
		advance(&f, c, 1)
		for i := range f.Buildings {
			if f.Buildings[i].ID == edited {
				f.Buildings[i].Rotation = 90
			}
		}
		f.Simulation.Normalize(f.Buildings)
		if len(f.Simulation.Transfers) != 0 || f.Simulation.Warehouse["iron_ore"] != 1 {
			t.Fatalf("editing %s retained an invalid visual route", edited)
		}
	}
}
