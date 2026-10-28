package domain

import (
	"encoding/json"
	"testing"
)

func TestWarehouseActivityWindow(t *testing.T) {
	c := Catalog{Items: []ItemDefinition{{Definition: Definition{ID: "iron"}}}}
	f := FactoryDetail{Factory: Factory{ID: "root"}, Simulation: Simulation{Tick: 120}, Districts: []FactoryDetail{{Factory: Factory{ID: "child"}}}}
	if !validWarehouseActivity(f, c) {
		t.Fatal("legacy missing history rejected")
	}
	f.WarehouseActivity = &WarehouseActivity{StartedTick: 0, Buckets: []WarehouseActivityBucket{{Tick: 1, Delta: map[string]int64{"iron": -2}, Factories: map[string]WarehouseActivityFlow{"child": {Received: map[string]int64{"iron": 3}, Withdrawn: map[string]int64{"iron": 5}}}}}}
	data, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	var restored FactoryDetail
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if !validWarehouseActivity(restored, c) {
		t.Fatal("valid restored history rejected")
	}
	for name, change := range map[string]func(*FactoryDetail){
		"future start":   func(v *FactoryDetail) { v.WarehouseActivity.StartedTick = 121 },
		"expired bucket": func(v *FactoryDetail) { v.WarehouseActivity.Buckets[0].Tick = 0 },
		"future bucket":  func(v *FactoryDetail) { v.WarehouseActivity.Buckets[0].Tick = 121 },
		"duplicate ticks": func(v *FactoryDetail) {
			v.WarehouseActivity.Buckets = append(v.WarehouseActivity.Buckets, v.WarehouseActivity.Buckets[0])
		},
		"unknown item": func(v *FactoryDetail) { v.WarehouseActivity.Buckets[0].Delta["missing"] = 1 },
		"unsafe count": func(v *FactoryDetail) { v.WarehouseActivity.Buckets[0].Delta["iron"] = MaxSafeInteger + 1 },
		"unknown factory": func(v *FactoryDetail) {
			v.WarehouseActivity.Buckets[0].Factories["missing"] = WarehouseActivityFlow{Received: map[string]int64{}, Withdrawn: map[string]int64{}}
		},
		"negative gross count": func(v *FactoryDetail) { v.WarehouseActivity.Buckets[0].Factories["child"].Received["iron"] = -1 },
	} {
		t.Run(name, func(t *testing.T) {
			var invalid FactoryDetail
			if err := json.Unmarshal(data, &invalid); err != nil {
				t.Fatal(err)
			}
			change(&invalid)
			if validWarehouseActivity(invalid, c) {
				t.Fatal("invalid history accepted")
			}
		})
	}
}

func TestWarehouseActivityStrictJSON(t *testing.T) {
	for _, raw := range []string{
		`{"warehouse_activity":null}`,
		`{"warehouse_activity":{"buckets":[]}}`,
		`{"warehouse_activity":{"started_tick":0,"buckets":null}}`,
		`{"warehouse_activity":{"started_tick":0,"buckets":[],"extra":true}}`,
		`{"warehouse_activity":{"started_tick":0,"buckets":[{"tick":1,"delta":{},"factories":{"root":{"received":null,"withdrawn":{}}}}]}}`,
		`{"warehouse_activity":{"started_tick":0,"buckets":[{"tick":1,"delta":{"iron":0.5},"factories":{}}]}}`,
	} {
		var f FactoryDetail
		if json.Unmarshal([]byte(raw), &f) == nil {
			t.Fatal("invalid history JSON accepted", raw)
		}
	}
}
