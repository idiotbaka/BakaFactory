package domain

import (
	"encoding/json"
	"testing"
)

func TestDiscoveredItemSaveBounds(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "seen"}}}, Stages: make([]StageDefinition, 6)}
	s := Simulation{Industry: &IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}, DiscoveredItems: []string{"seen"}}}
	if err := s.Validate(c); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(s.Industry)
	if err != nil {
		t.Fatal(err)
	}
	var restored IndustryState
	if err := json.Unmarshal(data, &restored); err != nil || len(restored.DiscoveredItems) != 1 {
		t.Fatal("discovery history lost", err)
	}
	for _, bad := range [][]string{{"unknown"}, {"seen", "seen"}} {
		s.Industry.DiscoveredItems = bad
		if s.Validate(c) == nil {
			t.Fatal("invalid discoveries accepted")
		}
	}
	for _, bad := range []string{`{"discovered_items":null}`, `{"discovered_items":[1]}`} {
		if json.Unmarshal([]byte(bad), &restored) == nil {
			t.Fatal("invalid discovery JSON accepted")
		}
	}
}
