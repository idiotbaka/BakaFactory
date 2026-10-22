package domain

type DeveloperSettings struct {
	WarehouseOrdersAlwaysAvailable bool `json:"warehouse_orders_always_available"`
}

func (v *DeveloperSettings) UnmarshalJSON(data []byte) error {
	type plain DeveloperSettings
	return decodeRobotObject(data, (*plain)(v), "warehouse_orders_always_available")
}
