package domain

func robotCanTraverse(c Catalog, buildingType string) bool {
	for _, b := range c.Buildings {
		if b.ID == buildingType {
			switch b.Role {
			case "belt", "pipe", "shaft", "hydraulic_line", "cable":
				return true
			}
			return false
		}
	}
	return false
}

// Bound released saves by their former whole-second work limits. New work
// uses ActionTicks; reading an old in-flight snapshot must not lose real cargo.
func robotWorkLimit(d RobotDefinition) int {
	legacy := map[string]int{"i0108": 8, "i0168": 10, "i0169": 30, "i0226": 8, "i0227": 5, "i0279": 2, "i0280": 40, "i0295": 35, "i0341": 2}
	if legacy[d.Item] > d.ActionTicks {
		return legacy[d.Item]
	}
	return d.ActionTicks
}
