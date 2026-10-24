package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func footprintSize(size *int) int {
	if size != nil && *size == 2 {
		return 2
	}
	return 1
}
func validFootprintSize(d BuildingDefinition, size *int) bool {
	if size == nil || *size == 1 {
		return true
	}
	if *size != 2 {
		return false
	}
	for _, n := range d.SupportedSizes {
		if n == 2 {
			return true
		}
	}
	return false
}
func footprintContains(x, y int, size *int, px, py int) bool {
	n := footprintSize(size)
	return px >= x && px < x+n && py <= y && py > y-n
}
func footprintOverlaps(ax, ay int, as *int, bx, by int, bs *int) bool {
	return ax < bx+footprintSize(bs) && bx < ax+footprintSize(as) && ay > by-footprintSize(bs) && by > ay-footprintSize(as)
}
func footprintInBounds(x, y int, size *int) bool {
	n := footprintSize(size)
	return x >= -10 && x+n-1 <= 10 && y <= 10 && y-n+1 >= -10
}
func rejectNullSize(data []byte) error {
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	if raw, ok := shape["size"]; ok && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("null footprint size")
	}
	return nil
}
func (b *BuildingInstance) UnmarshalJSON(data []byte) error {
	type plain BuildingInstance
	if err := rejectNullSize(data); err != nil {
		return err
	}
	return decodeBuildingObject(data, (*plain)(b))
}
func decodeBuildingObject(data []byte, dest any) error {
	// Preserve the API's strict unknown-field boundary when decoding the nested object.
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}
func (p *BuildingPlacement) UnmarshalJSON(data []byte) error {
	type plain BuildingPlacement
	if err := rejectNullSize(data); err != nil {
		return err
	}
	return decodeBuildingObject(data, (*plain)(p))
}
