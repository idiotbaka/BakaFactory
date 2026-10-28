package catalog

import (
	"testing"
)

func TestHalfSecondRecipeDurations(t *testing.T) {
	for _, duration := range []int64{500, 1000, 1500} {
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		c.Recipes[0].DurationMS = duration
		if err := c.Validate(); err != nil {
			t.Fatalf("duration %d: %v", duration, err)
		}
	}
}

func TestCatalogValidation(t *testing.T) {
	valid, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(valid.Items) != 353 || len(valid.Buildings) != 87 || len(valid.Recipes) != 332 || len(valid.Stages) != 6 || len(valid.Robots) != 9 || len(valid.Quests) != 32 {
		t.Fatal("missing production definitions")
	}
	for _, name := range []string{"duplicate_item", "unknown_ingredient", "negative_quantity", "unknown_machine", "invalid_duration", "subsecond_duration", "off_grid_duration", "missing_bus", "invalid_color", "robot_capacity", "robot_energy", "robot_duplicate", "robot_item", "station_capacity"} {
		t.Run(name, func(t *testing.T) {
			c, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			switch name {
			case "duplicate_item":
				c.Items = append(c.Items, c.Items[0])
			case "unknown_ingredient":
				c.Recipes[0].Inputs = map[string]int64{"missing": 1}
			case "negative_quantity":
				c.Recipes[0].Outputs = map[string]int64{"i0009": -1}
			case "unknown_machine":
				c.Recipes[0].BuildingType = "missing"
			case "invalid_duration":
				c.Recipes[0].DurationMS = 0
			case "subsecond_duration":
				c.Recipes[0].DurationMS = 900
			case "off_grid_duration":
				c.Recipes[0].DurationMS = 1250
			case "missing_bus":
				c.Buildings = c.Buildings[1:]
			case "invalid_color":
				c.Items[0].Color = "url(invalid)"
			case "robot_capacity":
				c.Robots[0].Capacity = 33
			case "robot_energy":
				c.Robots[0].Energy = "free"
			case "robot_duplicate":
				c.Robots = append(c.Robots, c.Robots[0])
			case "robot_item":
				c.Robots[0].Item = "missing"
			case "station_capacity":
				for i := range c.Buildings {
					if c.Buildings[i].Role == "station" {
						c.Buildings[i].StationCapacityKJ = 30001
						break
					}
				}
			}
			if c.Validate() == nil {
				t.Fatal("invalid catalog accepted")
			}
		})
	}
}
