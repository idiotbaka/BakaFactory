package catalog

import (
	"testing"
)

func TestCatalogValidation(t *testing.T) {
	valid, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(valid.Items) != 3 || len(valid.Buildings) != 7 || len(valid.Recipes) != 3 {
		t.Fatal("missing production definitions")
	}
	for _, name := range []string{"duplicate_item", "unknown_ingredient", "negative_quantity", "unknown_machine", "invalid_duration", "subsecond_duration", "fractional_second", "missing_bus", "invalid_color"} {
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
				c.Recipes[0].Outputs = map[string]int64{"iron_plate": -1}
			case "unknown_machine":
				c.Recipes[0].BuildingType = "missing"
			case "invalid_duration":
				c.Recipes[0].DurationMS = 0
			case "subsecond_duration":
				c.Recipes[0].DurationMS = 900
			case "fractional_second":
				c.Recipes[0].DurationMS = 1500
			case "missing_bus":
				c.Buildings = c.Buildings[1:]
			case "invalid_color":
				c.Items[0].Color = "url(invalid)"
			}
			if c.Validate() == nil {
				t.Fatal("invalid catalog accepted")
			}
		})
	}
}
