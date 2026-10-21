package domain

import (
	"encoding/json"
	"testing"
)

func TestWorkshopBatchSaveCompatibility(t *testing.T) {
	for _, raw := range []string{`{"recipe_id":"batch","progress":4}`, `{"recipe_id":"batch","progress":4,"remaining":2,"total":3}`} {
		var job WorkshopJob
		if err := json.Unmarshal([]byte(raw), &job); err != nil || !validWorkshopCounts(&job) {
			t.Fatal("valid queue rejected", err)
		}
		encoded, err := json.Marshal(job)
		if err != nil {
			t.Fatal(err)
		}
		var restored WorkshopJob
		if err := json.Unmarshal(encoded, &restored); err != nil || !validWorkshopCounts(&restored) {
			t.Fatal("queue roundtrip failed", err)
		}
	}
	for _, raw := range []string{`{"recipe_id":"batch","progress":0,"remaining":0,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":2,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":1,"total":101}`, `{"recipe_id":"batch","progress":0,"remaining":1}`} {
		var job WorkshopJob
		if err := json.Unmarshal([]byte(raw), &job); err == nil && validWorkshopCounts(&job) {
			t.Fatal("invalid queue accepted")
		}
	}
	for _, raw := range []string{`{"recipe_id":"batch","progress":0,"remaining":null,"total":1}`, `{"recipe_id":"batch","progress":0,"remaining":1,"total":null}`, `{"recipe_id":"batch","progress":0,"remaining":1.5,"total":2}`, `{"recipe_id":"batch","progress":0,"unknown":1}`} {
		var job WorkshopJob
		if json.Unmarshal([]byte(raw), &job) == nil {
			t.Fatal("invalid queue JSON accepted")
		}
	}
}
