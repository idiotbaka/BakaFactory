package domain

func (v *FactoryDetail) UnmarshalJSON(data []byte) error {
	type plain FactoryDetail
	if err := rejectNullWork(data, "warehouse_activity"); err != nil {
		return err
	}
	return decodeRobotObject(data, (*plain)(v))
}
func (v *WarehouseActivity) UnmarshalJSON(data []byte) error {
	type plain WarehouseActivity
	return decodeRobotObject(data, (*plain)(v), "started_tick", "buckets")
}
func (v *WarehouseActivityBucket) UnmarshalJSON(data []byte) error {
	type plain WarehouseActivityBucket
	return decodeRobotObject(data, (*plain)(v), "tick", "delta", "factories")
}
func (v *WarehouseActivityFlow) UnmarshalJSON(data []byte) error {
	type plain WarehouseActivityFlow
	return decodeRobotObject(data, (*plain)(v), "received", "withdrawn")
}

// Sparse game-time buckets, owned only by the world's root factory.
type WarehouseActivity struct {
	StartedTick int64                     `json:"started_tick"`
	Buckets     []WarehouseActivityBucket `json:"buckets"`
}
type WarehouseActivityBucket struct {
	Tick      int64                            `json:"tick"`
	Delta     map[string]int64                 `json:"delta"`
	Factories map[string]WarehouseActivityFlow `json:"factories"`
}
type WarehouseActivityFlow struct {
	Received  map[string]int64 `json:"received"`
	Withdrawn map[string]int64 `json:"withdrawn"`
}

func validWarehouseActivity(f FactoryDetail, c Catalog) bool {
	h := f.WarehouseActivity
	if h == nil {
		return true
	}
	tick := f.Simulation.Tick
	if h.StartedTick < 0 || h.StartedTick > tick || h.Buckets == nil || len(h.Buckets) > 60*TickRate {
		return false
	}
	factories := map[string]bool{f.ID: true}
	for _, child := range f.Districts {
		factories[child.ID] = true
	}
	items := map[string]bool{}
	for _, item := range c.Items {
		items[item.ID] = true
	}
	counts := func(values map[string]int64, signed bool) bool {
		if values == nil {
			return false
		}
		for id, n := range values {
			if !items[id] || n == 0 || n > MaxSafeInteger || n < -MaxSafeInteger || !signed && n < 0 {
				return false
			}
		}
		return true
	}
	last := int64(-1)
	for _, b := range h.Buckets {
		if b.Tick <= last || b.Tick < h.StartedTick || b.Tick <= tick-60*TickRate || b.Tick > tick || !counts(b.Delta, true) || b.Factories == nil {
			return false
		}
		for id, flow := range b.Factories {
			if !factories[id] || !counts(flow.Received, false) || !counts(flow.Withdrawn, false) {
				return false
			}
		}
		last = b.Tick
	}
	return true
}
