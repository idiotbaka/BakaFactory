package domain

import "testing"

func TestRobotWalkableLogisticsAndLegacyWork(t *testing.T) {
	c := Catalog{
		Robots: []RobotDefinition{{Item: "i0108", Tier: 2, Energy: "shaft", EnergyCapacityKJ: 1000, Capacity: 10, ActionTicks: 2, Role: "carrier"}},
		Buildings: []BuildingDefinition{
			{Definition: Definition{ID: "station"}, Role: "station", Energy: "shaft", StationCapacityKJ: 1000},
			{Definition: Definition{ID: "crossing"}, Role: "belt"},
		},
	}
	f := FactoryDetail{Factory: Factory{ID: "home"}, Buildings: []BuildingInstance{{ID: "s", BuildingType: "station", X: 4}, {ID: "lane", BuildingType: "crossing", X: 5}}, Simulation: Simulation{Industry: &IndustryState{Stage: 2}}, Robots: []RobotState{{ID: "r", Item: "i0108", HomeFactoryID: "home", HomeStation: "s", FactoryID: "home", X: 5, EnergyKJ: 10, Enabled: true, AllowedZones: []string{"home"}, Priority: 3, Status: "loading", WorkProgress: 8}}}
	for _, role := range []string{"belt", "pipe", "shaft", "hydraulic_line", "cable"} {
		c.Buildings[1].Role = role
		if !validRobotWorld(f, c) {
			t.Fatalf("rejected robot over walkable %s with bounded released progress", role)
		}
	}
	for _, role := range []string{"production", "tank", "port", "valve", "pump", "station"} {
		c.Buildings[1].Role = role
		if validRobotWorld(f, c) {
			t.Fatalf("accepted robot inside blocking %s", role)
		}
	}
	c.Buildings[1].Role = "belt"
	f.Robots[0].WorkProgress = 9
	if validRobotWorld(f, c) {
		t.Fatal("accepted excessive legacy work")
	}
	f.Robots[0].WorkProgress = 2
	f.Robots[0].X = 4
	if validRobotWorld(f, c) {
		t.Fatal("accepted robot inside its station")
	}
}

func TestRobotTransitLandingOnLowLogistics(t *testing.T) {
	c := Catalog{Robots: []RobotDefinition{{Item: "smart", Tier: 6, Energy: "electric", EnergyCapacityKJ: 30000, Capacity: 100, ActionTicks: 1, CrossDistrict: true, Role: "smart"}}, Buildings: []BuildingDefinition{{Definition: Definition{ID: "station"}, Role: "station", Energy: "electric", StationCapacityKJ: 30000}, {Definition: Definition{ID: "cable"}, Role: "cable"}, {Definition: Definition{ID: "tank"}, Role: "tank"}}}
	f := FactoryDetail{Factory: Factory{ID: "home"}, Buildings: []BuildingInstance{{ID: "wh", BuildingType: "bus"}, {ID: "s", BuildingType: "station", X: 4}}, Simulation: Simulation{Industry: &IndustryState{Stage: 6}}, Districts: []FactoryDetail{{Factory: Factory{ID: "away"}, Buildings: []BuildingInstance{{ID: "away-wh", BuildingType: "bus"}, {ID: "lane", BuildingType: "cable", X: 1}}}}, Robots: []RobotState{{ID: "r", Item: "smart", HomeFactoryID: "home", HomeStation: "s", FactoryID: "home", X: 1, EnergyKJ: 100, Enabled: true, AllowedZones: []string{"home", "away"}, Priority: 3, Status: "in_transit", Returning: "cancelled", Transit: &RobotTransit{ToFactoryID: "away", X: 1, RemainingTicks: 4}}}}
	if !validRobotWorld(f, c) {
		t.Fatal("rejected cable transit landing")
	}
	f.Districts[0].Buildings[1].BuildingType = "tank"
	if validRobotWorld(f, c) {
		t.Fatal("accepted blocked transit landing")
	}
}
