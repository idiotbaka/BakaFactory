package domain

import "encoding/json"

const undergroundType = "underground_belt"

// Pair identity is explicit; overlapping underground spans never auto-pair.
func validUndergroundPairs(f FactoryDetail) bool {
	byID := map[string]BuildingInstance{}
	for _, b := range f.Buildings {
		byID[b.ID] = b
	}
	for _, b := range f.Buildings {
		var config map[string]json.RawMessage
		if json.Unmarshal(b.Configuration, &config) != nil {
			return false
		}
		if b.BuildingType != undergroundType {
			if config["underground_role"] != nil || config["underground_peer"] != nil {
				return false
			}
			continue
		}
		var role, peerID string
		if json.Unmarshal(config["underground_role"], &role) != nil ||
			json.Unmarshal(config["underground_peer"], &peerID) != nil || peerID == "" || len(peerID) > 128 ||
			(role != "entry" && role != "exit") {
			return false
		}
		peer, ok := byID[peerID]
		if !ok || peer.BuildingType != undergroundType || peer.FactoryID != b.FactoryID || peer.Rotation != b.Rotation {
			return false
		}
		var other map[string]json.RawMessage
		var back, otherRole string
		if json.Unmarshal(peer.Configuration, &other) != nil || json.Unmarshal(other["underground_peer"], &back) != nil ||
			json.Unmarshal(other["underground_role"], &otherRole) != nil || back != b.ID || otherRole == role ||
			(otherRole != "entry" && otherRole != "exit") {
			return false
		}
		entry, exit := b, peer
		if role == "exit" {
			entry, exit = peer, b
		}
		dx, dy := 1, 0
		switch entry.Rotation {
		case 90:
			dx, dy = 0, -1
		case 180:
			dx = -1
		case 270:
			dx, dy = 0, 1
		}
		x, y := exit.X-entry.X, exit.Y-entry.Y
		distance := x*dx + y*dy
		if x*dy != y*dx || distance < 1 || distance > 8 {
			return false
		}
		m := f.Simulation.Buildings[b.ID]
		if m == nil || len(m.Input) != 0 || len(m.Output) != 0 || len(m.Fuel) != 0 || m.Fluid != nil ||
			(role == "entry" && m.Belt != nil) || f.Simulation.Industry == nil || f.Simulation.Industry.Stage < 2 {
			return false
		}
	}
	return true
}
