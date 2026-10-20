package domain

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxSafeInteger int64 = 9007199254740991

var ErrSaveConflict = errors.New("cloud save version conflict")

type GameSave struct {
	FormatVersion int           `json:"format_version"`
	RulesVersion  int           `json:"rules_version"`
	Factory       FactoryDetail `json:"factory"`
}

type CloudSave struct {
	Version int64    `json:"version"`
	SavedAt string   `json:"saved_at"`
	Save    GameSave `json:"save"`
}

// Validate checks bounded, compatible structure, not proof of honest production.
func (s GameSave) Validate(owner string, c Catalog) error {
	bad := func() error { return fmt.Errorf("%w: 存档格式或游戏版本不兼容", ErrValidation) }
	f := s.Factory
	if s.FormatVersion != 1 || s.RulesVersion != 1 || f.OwnerID != owner || f.ID == "" || len(f.ID) > 128 || f.Width != InitialFactorySize || f.Height != InitialFactorySize || len(f.Buildings) < 1 || len(f.Buildings) > InitialFactorySize*InitialFactorySize || f.Revision < 0 || f.Revision > MaxSafeInteger {
		return bad()
	}
	if !utf8.ValidString(f.Name) || strings.TrimSpace(f.Name) == "" || utf8.RuneCountInString(f.Name) > 32 {
		return bad()
	}
	for _, ch := range f.Name {
		if unicode.IsControl(ch) {
			return bad()
		}
	}
	definitions := map[string]bool{}
	for _, d := range c.Buildings {
		definitions[d.ID] = true
	}
	ids := map[string]bool{}
	cells := map[[2]int]bool{}
	buses := 0
	for _, b := range f.Buildings {
		cell := [2]int{b.X, b.Y}
		if b.ID == "" || len(b.ID) > 128 || ids[b.ID] || cells[cell] || b.FactoryID != f.ID || !definitions[b.BuildingType] || !f.Contains(BuildingPlacement{X: b.X, Y: b.Y}) || (b.Rotation != 0 && b.Rotation != 90 && b.Rotation != 180 && b.Rotation != 270) {
			return bad()
		}
		if b.BuildingType == "bus" {
			buses++
			if b.X != 0 || b.Y != 0 || b.Rotation != 0 {
				return bad()
			}
		}
		configuration := bytes.TrimSpace(b.Configuration)
		if len(configuration) < 2 || configuration[0] != '{' || configuration[len(configuration)-1] != '}' {
			return bad()
		}
		if m := f.Simulation.Buildings[b.ID]; m != nil && m.Belt != nil && b.BuildingType != "conveyor" {
			return bad()
		}
		ids[b.ID] = true
		cells[cell] = true
	}
	sim := f.Simulation
	if buses != 1 || sim.TickRate != 1 || sim.Tick > MaxSafeInteger || len(sim.Buildings) != len(ids) || sim.Warehouse == nil || sim.Transfers == nil || len(sim.Transfers) > 3*len(ids) {
		return bad()
	}
	for id := range ids {
		if sim.Buildings[id] == nil {
			return bad()
		}
	}
	for _, count := range sim.Warehouse {
		if count > MaxSafeInteger {
			return bad()
		}
	}
	if err := sim.Validate(c); err != nil {
		return bad()
	}
	return nil
}
