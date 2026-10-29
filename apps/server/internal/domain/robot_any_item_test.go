package domain

import "testing"

func TestAnyItemRobotTaskRetainsActualCargoValidation(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{
		{Definition: Definition{ID: "solid"}, Kind: "solid_or_module"},
		{Definition: Definition{ID: "fluid"}, Kind: "fluid_or_gas"},
	}}
	d := RobotDefinition{Item: "cart", Role: "carrier", Capacity: 10, ActionTicks: 2, Energy: "shaft"}
	factories := map[string]FactoryDetail{"home": {Factory: Factory{ID: "home"}}}
	zones := map[string]bool{"home": true}
	r := RobotState{FactoryID: "home", Status: "unloading", Cargo: &Stack{Item: "solid", Count: 5}, Task: &RobotTask{
		ID: "any", Source: RobotEndpoint{FactoryID: "home", BuildingID: "a"}, Target: RobotEndpoint{FactoryID: "home", BuildingID: "b"}, Item: "", Count: 10, Channel: "auto", Phase: "deliver", Repeat: true,
	}}
	if !validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("valid unfiltered task with concrete cargo rejected")
	}
	r.Cargo.Item = "unknown"
	if validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("unknown cargo accepted")
	}
	r.Cargo.Item = "fluid"
	if validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("solid-only carrier accepted fluid cargo")
	}
	d.Energy = "hydraulic"
	if !validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("hydraulic unfiltered fluid cargo rejected")
	}
	r.Cargo.Count = 11
	if validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("unfiltered task bypassed capacity")
	}
	r.Cargo.Count = 5
	r.Task.Delivered = 6
	if validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("unfiltered delivered plus cargo exceeded batch")
	}
	r.Task.Delivered = 0
	r.Task.Item = "solid"
	if validRobotFreight(r, d, factories, zones, c) {
		t.Fatal("filtered task accepted mismatched cargo")
	}
}
