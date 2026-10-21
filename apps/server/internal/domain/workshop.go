package domain

func workshopMachineAvailable(c Catalog, p *IndustryState, machine string) bool {
	for _, id := range c.StartingMachines {
		if machine == id {
			return true
		}
	}
	if p == nil || (machine != "m03" && machine != "m04" && machine != "m08") {
		return false
	}
	for _, b := range c.Buildings {
		if b.ID == machine && b.Item != "" && p.Crafted[b.Item] >= 1 {
			return true
		}
	}
	return false
}
