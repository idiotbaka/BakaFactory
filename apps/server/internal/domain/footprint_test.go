package domain

import (
	"encoding/json"
	"testing"
)

func TestFootprintGeometryAndOptionalSize(t *testing.T) {
	two := 2
	if footprintContains(4, 4, &two, 6, 3) || !footprintContains(4, 4, &two, 5, 3) || !footprintContains(4, 4, nil, 4, 4) {
		t.Fatal("wrong occupied cells")
	}
	if !footprintOverlaps(4, 4, &two, 5, 3, nil) || footprintOverlaps(4, 4, &two, 6, 3, nil) {
		t.Fatal("wrong overlap")
	}
	if footprintInBounds(10, 4, &two) || footprintInBounds(4, -10, &two) || !footprintInBounds(9, -9, &two) {
		t.Fatal("wrong bounds")
	}
	for _, payload := range []string{`{"x":1,"y":1,"rotation":0,"size":null}`, `{"x":1,"y":1,"rotation":0,"size":1.5}`} {
		var p BuildingPlacement
		if json.Unmarshal([]byte(payload), &p) == nil {
			t.Fatal("invalid size decoded")
		}
	}
}
func TestLargeConstructionReservesNonAnchorCells(t *testing.T) {
	f, c := constructionFixture()
	r, d := f.Robots[0], c.Robots[0]
	two := 2
	c.Buildings[1].SupportedSizes = []int{1, 2}
	r.Construction.Size = &two
	f.Robots = []RobotState{r}
	factories := map[string]FactoryDetail{f.ID: f, f.Districts[0].ID: f.Districts[0]}
	zones := map[string]bool{"home": true, "away": true}
	if !validRobotConstruction(f, r, d, factories, zones, c) {
		t.Fatal("large blueprint rejected")
	}
	child := f.Districts[0]
	child.Buildings = append(child.Buildings, BuildingInstance{ID: "block", BuildingType: "machine", X: r.Construction.X + 1, Y: r.Construction.Y - 1})
	factories[child.ID] = child
	if validRobotConstruction(f, r, d, factories, zones, c) {
		t.Fatal("covered cell not reserved")
	}
}

func TestRobotCannotOccupyNonAnchorMachineCell(t *testing.T) {
	f, c := constructionFixture()
	two := 2
	f.Buildings = append(f.Buildings, BuildingInstance{ID: "large", BuildingType: "machine", X: 5, Y: 1, Size: &two})
	if validRobotWorld(f, c) {
		t.Fatal("robot allowed inside lower footprint cell")
	}
}
