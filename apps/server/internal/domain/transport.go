package domain

import (
	"bytes"
	"encoding/json"
	"strings"
)

// Keep the persisted configuration contract in sync with transportConfig.ts.
// The server validates bounded shape; the browser owns routing and simulation.
func validTransportConfiguration(kind string, config map[string]json.RawMessage, c Catalog) bool {
	items := map[string]bool{"": true}
	fluids := map[string]bool{"": true}
	var definition BuildingDefinition
	for _, d := range c.Buildings {
		if d.ID == kind {
			definition = d
			break
		}
	}
	for _, i := range c.Items {
		items[i.ID] = true
		if i.Kind == "fluid_or_gas" {
			fluids[i.ID] = true
		}
	}
	validItem := func(raw json.RawMessage) bool {
		var id string
		return !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) && json.Unmarshal(raw, &id) == nil && items[id]
	}
	for key, raw := range config {
		switch key {
		case "underground_role":
			var value string
			if kind != undergroundType || json.Unmarshal(raw, &value) != nil || (value != "entry" && value != "exit") {
				return false
			}
		case "underground_peer":
			var value string
			if kind != undergroundType || json.Unmarshal(raw, &value) != nil || value == "" || len(value) > 128 {
				return false
			}
		case "output_items":
			var values []string
			if kind != "warehouse_pickup" || json.Unmarshal(raw, &values) != nil || len(values) < 1 || len(values) > 2 {
				return false
			}
			seen := map[string]bool{}
			for _, id := range values {
				if id == "" || !items[id] || fluids[id] || seen[id] {
					return false
				}
				seen[id] = true
			}
		case "fluid_rate":
			var value int
			if definition.FluidCapacity == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil || value < 0 || value > definition.FluidRate {
				return false
			}
		case "fluid_target":
			var value string
			if definition.FluidCapacity == 0 || json.Unmarshal(raw, &value) != nil || value != "auto" && value != "input" && value != "fuel" && value != "medium" {
				return false
			}
		case "fluid_limit":
			var value int
			if definition.FluidCapacity == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil || value < 0 || value > 500 {
				return false
			}
		case "split_weights":
			var values []json.RawMessage
			if definition.Role != "valve" || json.Unmarshal(raw, &values) != nil || len(values) != 3 {
				return false
			}
			for _, v := range values {
				var n int
				if bytes.Equal(bytes.TrimSpace(v), []byte("null")) || json.Unmarshal(v, &n) != nil || n < 0 || n > 10 {
					return false
				}
			}
		case "priority":
			var value int
			if json.Unmarshal(raw, &value) != nil || value < 1 || value > 6 {
				return false
			}
		case "power_side":
			var value int
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil || value != -1 && value != 0 && value != 90 && value != 180 && value != 270 {
				return false
			}
		case "battery_mode":
			var value string
			found := false
			for _, d := range c.Buildings {
				if d.ID == kind && d.Role == "battery" {
					found = true
				}
			}
			if !found || json.Unmarshal(raw, &value) != nil || value != "auto" && value != "charge" && value != "discharge" && value != "hold" {
				return false
			}
		case "reserve_kj":
			var value int
			capacity := 0
			for _, d := range c.Buildings {
				if d.ID == kind && d.Role == "battery" {
					capacity = d.CapacityKJ
				}
			}
			if json.Unmarshal(raw, &value) != nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || value < 0 || capacity == 0 || value > capacity {
				return false
			}
		case "enabled":
			var value bool
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil {
				return false
			}
		case "interval":
			var value int
			if json.Unmarshal(raw, &value) != nil || value < 1 || value > 60 {
				return false
			}
		case "channel":
			var value string
			if json.Unmarshal(raw, &value) != nil || (value != "input" && value != "fuel") {
				return false
			}
		case "filter":
			if !validItem(raw) {
				return false
			}
			if definition.FluidCapacity > 0 {
				var id string
				if json.Unmarshal(raw, &id) != nil || !fluids[id] {
					return false
				}
				if id != "" && len(definition.InputWhitelist) > 0 {
					allowed := false
					for _, input := range definition.InputWhitelist {
						allowed = allowed || id == input
					}
					if !allowed {
						return false
					}
				}
			}
		default:
			if strings.HasPrefix(key, "branch_") {
				if key != "branch_0" && key != "branch_90" && key != "branch_180" && key != "branch_270" || !validItem(raw) {
					return false
				}
				if definition.FluidCapacity > 0 {
					var id string
					if json.Unmarshal(raw, &id) != nil || !fluids[id] {
						return false
					}
				}
			}
			if strings.HasPrefix(key, "face_") {
				if kind != "bus" || key != "face_0" && key != "face_90" && key != "face_180" && key != "face_270" {
					return false
				}
				var value struct {
					Mode   string `json:"mode"`
					Filter string `json:"filter"`
				}
				if json.Unmarshal(raw, &value) != nil || (value.Mode != "input" && value.Mode != "output" && value.Mode != "closed") || !items[value.Filter] || value.Mode == "output" && value.Filter == "" {
					return false
				}
				var shape map[string]json.RawMessage
				if json.Unmarshal(raw, &shape) != nil || shape["filter"] == nil || bytes.Equal(bytes.TrimSpace(shape["filter"]), []byte("null")) {
					return false
				}
			}
		}
	}
	if kind == "warehouse_pickup" && config["output_items"] == nil {
		return false
	}
	return true
}
