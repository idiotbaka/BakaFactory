package httpapi

import (
	"bakafactory/server/internal/catalog"
	"bakafactory/server/internal/domain"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestIndustrialSaveRoundTripAndBounds(t *testing.T) {
	f := newAuthFixture(t, false)
	w := f.request("POST", "/api/v1/auth/register", credentials("recycling_save", "correct-password"), nil)
	user := userFrom(t, w, 201)
	cookie := w.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	c, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	item := func(name string) string {
		for _, i := range c.Items {
			if i.Name == name {
				return i.ID
			}
		}
		t.Fatalf("missing item %s", name)
		return ""
	}
	save := sampleSave(user.ID)
	save.RulesVersion = 2
	save.Factory.Simulation.Industry = &domain.IndustryState{Stage: 4, Milestones: []string{c.Stages[0].MilestoneItem, c.Stages[1].MilestoneItem, c.Stages[2].MilestoneItem}, Crafted: map[string]int64{}, Workshop: &domain.WorkshopJob{RecipeID: "r1001", Progress: 3}}
	for _, kind := range []string{"m02", "m05"} {
		x := len(save.Factory.Buildings)
		config := `{ "recipe_id": "r1001" }`
		if kind == "m05" {
			config = `{ "recipe_id": "r1017" }`
		}
		save.Factory.Buildings = append(save.Factory.Buildings, domain.BuildingInstance{ID: kind, FactoryID: save.Factory.ID, BuildingType: kind, X: x, Configuration: json.RawMessage(config)})
		save.Factory.Simulation.Buildings[kind] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle"}
	}
	for _, r := range c.Recipes {
		if r.ID == "r1001" {
			for id, n := range r.Outputs {
				save.Factory.Simulation.Buildings["m02"].Output = append(save.Factory.Simulation.Buildings["m02"].Output, domain.Stack{Item: id, Count: n})
			}
		}
	}
	save.Factory.Simulation.Buildings["m05"].Fuel = domain.Inventory{{Item: item("干燥生物质"), Count: 2}}
	save.Factory.Simulation.Buildings["m05"].EnergyKJ = 100
	one, three := 1, 3
	for i, kind := range []string{"hand_belt", "electric_belt"} {
		count := &one
		progress := 2
		power := 0
		if kind == "electric_belt" {
			count = &three
			progress = 1
			power = 2
		}
		save.Factory.Buildings = append(save.Factory.Buildings, domain.BuildingInstance{ID: kind, FactoryID: save.Factory.ID, BuildingType: kind, X: i + 3, Configuration: json.RawMessage(`{"enabled":true,"filter":"","interval":3}`)})
		save.Factory.Simulation.Buildings[kind] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "transporting", SuppliedKW: power, Belt: &domain.BeltItem{ID: kind + "-batch", Item: item("铁质碎片"), Count: count, Progress: progress}}
	}
	busConfig, _ := json.Marshal(map[string]any{"face_0": map[string]any{"mode": "output", "filter": item("垃圾包")}})
	save.Factory.Buildings[0].Configuration = busConfig
	save.Factory.Buildings = append(save.Factory.Buildings, domain.BuildingInstance{ID: "battery", FactoryID: save.Factory.ID, BuildingType: "battery", X: 5, Configuration: json.RawMessage(`{"priority":1,"power_side":180,"battery_mode":"auto","reserve_kj":44}`)}, domain.BuildingInstance{ID: "hyd", FactoryID: save.Factory.ID, BuildingType: "m21", X: 6, Configuration: json.RawMessage(`{}`)})
	save.Factory.Simulation.Buildings["battery"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "charging", ChargeKJ: 88, ChargeRemainder: 12, SuppliedKW: 100, NetworkID: "electric:test"}
	save.Factory.Simulation.Buildings["hyd"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle", Medium: 1, Fuel: domain.Inventory{{Item: item("液体燃料"), Count: 1}}}
	save.Factory.Simulation.Buildings["electric_belt"].WorkEnergyKJ = 1
	save.Factory.Simulation.Networks = []domain.PowerNetwork{{ID: "electric:test", Kind: "electric", StoredKJ: 88, ChargeKW: 100}}
	save.Factory.Buildings = append(save.Factory.Buildings, domain.BuildingInstance{ID: "tank", FactoryID: save.Factory.ID, BuildingType: "tank", X: 7, Configuration: json.RawMessage(`{"fluid_rate":4,"fluid_target":"input","fluid_limit":100}`)}, domain.BuildingInstance{ID: "valve", FactoryID: save.Factory.ID, BuildingType: "valve", X: 8, Configuration: json.RawMessage(`{"split_weights":[1,3,0]}`)})
	save.Factory.Simulation.Buildings["tank"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "fluid_full", Fluid: &domain.FluidVolume{Item: item("净化水"), Count: 500}, FlowIn: 4}
	save.Factory.Simulation.Buildings["valve"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "flowing", Fluid: &domain.FluidVolume{Item: item("净化水"), Count: 4}, FluidCursor: 3, FlowOut: 4}
	child := sampleSave(user.ID).Factory
	child.ID = "smelter"
	child.Name = "冶炼场"
	child.Buildings[0].FactoryID = child.ID
	child.Simulation.Warehouse = map[string]int64{item("净化水"): 500}
	child.Buildings = append(child.Buildings, domain.BuildingInstance{ID: "station", FactoryID: child.ID, BuildingType: "charge_station", X: 2, Configuration: json.RawMessage(`{}`)})
	child.Simulation.Buildings["station"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, StationEnergyKJ: 123, Status: "storage"}
	// Child factories may hold more sources than the former P4 quota of eight.
	for x := 0; x < 10; x++ {
		id := fmt.Sprintf("source:%d", x)
		child.Buildings = append(child.Buildings, domain.BuildingInstance{ID: id, FactoryID: child.ID, BuildingType: "waste_port", X: x, Y: 10, Configuration: json.RawMessage(`{}`)})
		child.Simulation.Buildings[id] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle"}
	}
	save.Factory.Districts = []domain.FactoryDetail{child}
	save.Factory.ActiveDistrictID = child.ID
	save.Factory.Robots = []domain.RobotState{{ID: "robot", Item: item("电动物流机器人"), HomeFactoryID: child.ID, HomeStation: "station", FactoryID: child.ID, X: 3, EnergyKJ: 88, ChargeRemainder: 12, Enabled: true, AllowedZones: []string{save.Factory.ID, child.ID}, Priority: 2, Status: "charging"}}
	save.Factory.Robots[0].Task = &domain.RobotTask{ID: "delivery", Source: domain.RobotEndpoint{FactoryID: save.Factory.ID, BuildingID: save.Factory.Buildings[0].ID}, Target: domain.RobotEndpoint{FactoryID: child.ID, BuildingID: child.Buildings[0].ID}, Item: item("基础铁板"), Count: 4, Channel: "auto", Repeat: true, Phase: "deliver", Delivered: 1}
	save.Factory.Robots[0].Cargo = &domain.Stack{Item: item("基础铁板"), Count: 3}
	save.Factory.Robots[0].WorkProgress = 3
	save.Factory.Robots[0].CompletedTasks = 7
	save.Factory.Simulation.Industry.WorkReceipts = []domain.WorkReceipt{{Kind: "freight", RobotID: "robot", RobotItem: item("电动物流机器人"), Count: 40, LastTick: save.Factory.Simulation.Tick}}
	save.Factory.Simulation.Buildings["m02"].BatchesCompleted = 3
	save.Factory.Simulation.Buildings["m02"].Incident = &domain.WorkIncident{Kind: "no_input", SinceTick: save.Factory.Simulation.Tick, Inspected: true}
	w = f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie)
	if w.Code != 200 {
		t.Fatalf("industrial upload: %d %s", w.Code, w.Body)
	}
	w = f.cloudRequest("GET", session, "", cookie)
	var response struct {
		Backup domain.CloudSave `json:"backup"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(response.Backup.Save.Factory.Simulation, save.Factory.Simulation) {
		t.Fatal("industrial state was changed by cloud persistence")
	}
	if !reflect.DeepEqual(response.Backup.Save.Factory.Districts, save.Factory.Districts) || response.Backup.Save.Factory.ActiveDistrictID != child.ID {
		t.Fatal("districts did not round trip")
	}
	if !reflect.DeepEqual(response.Backup.Save.Factory.Robots, save.Factory.Robots) {
		t.Fatal("robot body, energy or permissions changed in persistence")
	}
	for _, name := range []string{"stage", "recipe", "fuel", "capacity", "batch", "belt_duration", "filter", "rate", "null_enabled", "charge", "medium", "priority", "power_side", "power_kind", "fluid_capacity", "fluid_zero", "fluid_solid", "fluid_rate", "fluid_target", "fluid_weights", "fluid_null", "fluid_flow", "fluid_cursor", "district_owner", "district_nested", "district_tick", "district_id", "district_active", "district_industry", "robot_item", "robot_energy", "robot_remainder", "robot_full_remainder", "robot_zone", "robot_home", "robot_cell", "robot_duplicate_cell", "child_robots", "station_capacity", "station_on_machine"} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(save)
			var invalid domain.GameSave
			if err := json.Unmarshal(raw, &invalid); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "stage":
				invalid.Factory.Simulation.Industry.Stage = 6
			case "recipe":
				invalid.Factory.Buildings[1].Configuration = json.RawMessage(`{"recipe_id":"r1017"}`)
			case "fuel":
				invalid.Factory.Simulation.Buildings["m05"].Fuel[0].Item = item("废电池")
			case "capacity":
				invalid.Factory.Simulation.Buildings["m02"].Output[0].Count = 101
			case "batch":
				zero := 0
				invalid.Factory.Simulation.Buildings["electric_belt"].Belt.Count = &zero
			case "belt_duration":
				invalid.Factory.Simulation.Buildings["hand_belt"].Belt.Progress = 4
			case "filter":
				invalid.Factory.Buildings[0].Configuration = json.RawMessage(`{"face_0":{"mode":"output","filter":"unknown"}}`)
			case "rate":
				invalid.Factory.Buildings[3].Configuration = json.RawMessage(`{"interval":0}`)
			case "null_enabled":
				invalid.Factory.Buildings[3].Configuration = json.RawMessage(`{"enabled":null}`)
			case "charge":
				invalid.Factory.Simulation.Buildings["battery"].ChargeKJ = 15001
			case "medium":
				invalid.Factory.Simulation.Buildings["hyd"].Medium = 11
			case "priority":
				invalid.Factory.Buildings[5].Configuration = json.RawMessage(`{"priority":0}`)
			case "power_side":
				invalid.Factory.Buildings[5].Configuration = json.RawMessage(`{"power_side":45}`)
			case "power_kind":
				invalid.Factory.Simulation.Networks[0].Kind = "invented"
			case "fluid_capacity":
				invalid.Factory.Simulation.Buildings["tank"].Fluid.Count = 501
			case "fluid_zero":
				invalid.Factory.Simulation.Buildings["tank"].Fluid.Count = 0
			case "fluid_solid":
				invalid.Factory.Simulation.Buildings["tank"].Fluid.Item = item("垃圾包")
			case "fluid_rate":
				invalid.Factory.Buildings[7].Configuration = json.RawMessage(`{"fluid_rate":5}`)
			case "fluid_target":
				invalid.Factory.Buildings[7].Configuration = json.RawMessage(`{"fluid_target":"output"}`)
			case "fluid_weights":
				invalid.Factory.Buildings[8].Configuration = json.RawMessage(`{"split_weights":[1,3,11]}`)
			case "fluid_null":
				invalid.Factory.Buildings[7].Configuration = json.RawMessage(`{"fluid_rate":null}`)
			case "fluid_flow":
				invalid.Factory.Simulation.Buildings["tank"].FlowIn = 81
			case "fluid_cursor":
				invalid.Factory.Simulation.Buildings["tank"].FluidCursor = 1
			case "district_owner":
				invalid.Factory.Districts[0].OwnerID = "other"
			case "district_nested":
				invalid.Factory.Districts[0].Districts = []domain.FactoryDetail{{}}
			case "district_tick":
				invalid.Factory.Districts[0].Simulation.Tick++
			case "district_id":
				invalid.Factory.Districts[0].ID = invalid.Factory.ID
			case "district_active":
				invalid.Factory.ActiveDistrictID = "missing"
			case "district_industry":
				invalid.Factory.Districts[0].Simulation.Industry = invalid.Factory.Simulation.Industry
			case "robot_item":
				invalid.Factory.Robots[0].Item = item("垃圾包")
			case "robot_energy":
				invalid.Factory.Robots[0].EnergyKJ = 15001
			case "robot_remainder":
				invalid.Factory.Robots[0].ChargeRemainder = 100
			case "robot_full_remainder":
				invalid.Factory.Robots[0].EnergyKJ = 15000
			case "robot_zone":
				invalid.Factory.Robots[0].AllowedZones = []string{"other"}
			case "robot_home":
				invalid.Factory.Robots[0].HomeStation = "missing"
			case "robot_cell":
				invalid.Factory.Robots[0].X = 0
			case "robot_duplicate_cell":
				another := invalid.Factory.Robots[0]
				another.ID = "second"
				invalid.Factory.Robots = append(invalid.Factory.Robots, another)
			case "child_robots":
				invalid.Factory.Districts[0].Robots = invalid.Factory.Robots
			case "station_capacity":
				invalid.Factory.Districts[0].Simulation.Buildings["station"].StationEnergyKJ = 30001
			case "station_on_machine":
				invalid.Factory.Simulation.Buildings["m02"].StationEnergyKJ = 1
			}
			if w := f.cloudRequest("PUT", session, uploadBody(t, 1, invalid), cookie); w.Code != 400 {
				t.Fatalf("invalid %s accepted: %d %s", name, w.Code, w.Body)
			}
		})
	}
}

func (f authFixture) cloudRequest(method, session, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/v1/game/save", strings.NewReader(body))
	r.Header.Set("Origin", testOrigin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Game-Session", session)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func heartbeatID(t *testing.T, f authFixture, cookie *http.Cookie) string {
	t.Helper()
	w := f.request("POST", "/api/v1/game/heartbeat", `{"session_id":""}`, cookie)
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("online session responses must not be cached")
	}
	if w.Code != 200 {
		t.Fatalf("heartbeat: %d %s", w.Code, w.Body)
	}
	var body struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.SessionID == "" {
		t.Fatal("missing session identity", err)
	}
	return body.SessionID
}
func sampleSave(owner string) domain.GameSave {
	f := domain.FactoryDetail{Factory: domain.Factory{ID: "client-factory", OwnerID: owner, Name: "本机工厂", Width: 21, Height: 21, CreatedAt: "2026-10-20T00:00:00Z", Revision: 7}, Buildings: []domain.BuildingInstance{{ID: "bus", FactoryID: "client-factory", BuildingType: "bus", Configuration: json.RawMessage(`{}`)}}}
	f.Simulation = domain.Simulation{Tick: 7, TickRate: 1, Buildings: map[string]*domain.MachineState{"bus": {Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "warehouse"}}, Warehouse: map[string]int64{"iron_ore": 5}, Transfers: []domain.ItemTransfer{}}
	return domain.GameSave{FormatVersion: 1, RulesVersion: 1, Factory: f}
}

func TestSharedWarehouseCloudSaveAndLegacyCompatibility(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("shared_warehouse", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	save := sampleSave(user.ID)
	save.RulesVersion = 2
	save.Factory.Simulation.Industry = &domain.IndustryState{Stage: 1, Milestones: []string{}, Crafted: map[string]int64{}}
	child := sampleSave(user.ID).Factory
	child.ID = "shared-child"
	child.Buildings[0].FactoryID = child.ID
	child.Simulation.Warehouse["iron_ore"] = 3
	save.Factory.Districts = []domain.FactoryDetail{child}
	save.Factory.ActiveDistrictID = child.ID
	if w := f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie); w.Code != 200 {
		t.Fatal("legacy split stock rejected", w.Code, w.Body)
	}
	// The client merges only public stock, then saves one canonical v3 ledger.
	save.RulesVersion = 3
	save.Factory.Simulation.Warehouse["iron_ore"] = 8
	save.Factory.Districts[0].Simulation.Warehouse = map[string]int64{}
	if w := f.cloudRequest("PUT", session, uploadBody(t, 1, save), cookie); w.Code != 200 {
		t.Fatal("shared warehouse upgrade rejected", w.Code, w.Body)
	}
	var response struct {
		Backup domain.CloudSave `json:"backup"`
	}
	w := f.cloudRequest("GET", session, "", cookie)
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Backup.Version != 2 || !reflect.DeepEqual(response.Backup.Save, save) {
		t.Fatal("shared stock changed during cloud roundtrip", err)
	}
	save.Factory.Districts[0].Simulation.Warehouse["iron_ore"] = 8
	if w := f.cloudRequest("PUT", session, uploadBody(t, 2, save), cookie); w.Code != 400 {
		t.Fatal("duplicate district stock accepted in a v3 save", w.Code, w.Body)
	}
	save.Factory.Districts[0].Simulation.Warehouse = map[string]int64{}
	save.RulesVersion = 4
	if w := f.cloudRequest("PUT", session, uploadBody(t, 2, save), cookie); w.Code != 400 {
		t.Fatal("future warehouse semantics accepted", w.Code, w.Body)
	}
	w = f.cloudRequest("GET", session, "", cookie)
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Backup.Version != 2 || response.Backup.Save.Factory.Simulation.Warehouse["iron_ore"] != 8 {
		t.Fatal("rejected upgrade overwrote the cloud backup", err)
	}
}
func TestConstructionCloudSaveRoundTripAndStrictShape(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("construction_save", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	c, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	save := sampleSave(user.ID)
	save.RulesVersion = 2
	save.Factory.Simulation.Industry = &domain.IndustryState{Stage: 6, Milestones: []string{}, Crafted: map[string]int64{}}
	for _, stage := range c.Stages[:5] {
		save.Factory.Simulation.Industry.Milestones = append(save.Factory.Simulation.Industry.Milestones, stage.MilestoneItem)
	}
	var smart, device string
	for _, r := range c.Robots {
		if r.Role == "smart" {
			smart = r.Item
		}
	}
	for _, b := range c.Buildings {
		if b.ID == "m03" {
			device = b.Item
		}
	}
	save.Factory.Buildings = append(save.Factory.Buildings, domain.BuildingInstance{ID: "station", FactoryID: save.Factory.ID, BuildingType: "charge_station", X: 4, Configuration: json.RawMessage(`{}`)})
	save.Factory.Simulation.Buildings["station"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle"}
	recipe := "r1007"
	save.Factory.Robots = []domain.RobotState{{ID: "builder", Item: smart, HomeFactoryID: save.Factory.ID, HomeStation: "station", FactoryID: save.Factory.ID, X: 5, EnergyKJ: 29990, Enabled: true, AllowedZones: []string{save.Factory.ID}, Priority: 3, Status: "constructing", WorkProgress: 7, Cargo: &domain.Stack{Item: device, Count: 1}, Construction: &domain.RobotConstruction{ID: "site", FactoryID: save.Factory.ID, BuildingType: "m03", X: 6, Y: 2, Rotation: 90, RecipeID: &recipe}, BehaviorLog: []domain.RobotBehavior{{Tick: 7, Kind: "construct", Detail: "实际蓝图"}}}}
	w := f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie)
	if w.Code != 200 {
		t.Fatalf("construction upload %d %s", w.Code, w.Body)
	}
	var response struct {
		Backup domain.CloudSave `json:"backup"`
	}
	w = f.cloudRequest("GET", session, "", cookie)
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil || !reflect.DeepEqual(response.Backup.Save, save) {
		t.Fatal("construction cloud round trip", err)
	}
	body := uploadBody(t, 1, save)
	for _, bad := range []string{strings.Replace(body, `"construction":{`, `"construction":{"free_devices":1,`, 1), strings.Replace(body, `"rotation":90,"recipe_id"`, `"rotation":45,"recipe_id"`, 1), strings.Replace(body, `"recipe_id":"r1007"`, `"recipe_id":null`, 1)} {
		if bad == body {
			t.Fatal("invalid fixture was not changed")
		}
		if w = f.cloudRequest("PUT", session, bad, cookie); w.Code != 400 {
			t.Fatalf("invalid construction accepted %d %s", w.Code, w.Body)
		}
	}
	save.Factory.Robots[0].Returning = "cancelled"
	save.Factory.Robots[0].Cargo = nil
	save.Factory.Robots[0].WorkProgress = 0
	if w = f.cloudRequest("PUT", session, uploadBody(t, 1, save), cookie); w.Code != 200 {
		t.Fatalf("refunded construction return rejected %s", w.Body)
	}
}
func uploadBody(t *testing.T, base int, save domain.GameSave) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"base_version": base, "save": save})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestRelocatedWarehouseCloudRoundTrip(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("moved_warehouse", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	save := sampleSave(user.ID)
	save.Factory.Buildings[0].X, save.Factory.Buildings[0].Y = 8, -8
	if w := f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie); w.Code != 200 {
		t.Fatal("relocated warehouse rejected", w.Code, w.Body)
	}
	var response struct { Backup domain.CloudSave `json:"backup"` }
	w := f.cloudRequest("GET", session, "", cookie)
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || !reflect.DeepEqual(response.Backup.Save, save) {
		t.Fatal("warehouse position or stock changed in cloud roundtrip", err)
	}
	save.Factory.Buildings[0].Rotation = 90
	if w := f.cloudRequest("PUT", session, uploadBody(t, 1, save), cookie); w.Code != 400 {
		t.Fatal("warehouse rotation accepted", w.Code, w.Body)
	}
	w = f.cloudRequest("GET", session, "", cookie)
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Backup.Version != 1 || response.Backup.Save.Factory.Buildings[0].Rotation != 0 {
		t.Fatal("rejected warehouse edit overwrote backup", err)
	}
}

func TestCloudSaveSingleSlotOwnershipAndSessionRevocation(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("local_player", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	if w := f.cloudRequest("GET", session, "", cookie); w.Code != 200 || !strings.Contains(w.Body.String(), `"backup":null`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("new game must start empty: %s", w.Body)
	}
	save := sampleSave(user.ID)
	first := f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie)
	if first.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cloud save responses must not be cached")
	}
	if first.Code != 200 {
		t.Fatalf("upload %d %s", first.Code, first.Body)
	}
	var response struct {
		Backup domain.CloudSave `json:"backup"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Backup.Version != 1 || response.Backup.SavedAt == "" || !reflect.DeepEqual(response.Backup.Save, save) {
		t.Fatal("backup did not round trip")
	}
	save.Factory.Simulation.Tick = 8
	if w := f.cloudRequest("PUT", session, uploadBody(t, 1, save), cookie); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := f.cloudRequest("PUT", session, uploadBody(t, 1, save), cookie); w.Code != 409 {
		t.Fatal("stale upload overwrote sole save")
	}
	var count int
	if err := f.db.QueryRow("SELECT count(*) FROM cloud_saves").Scan(&count); err != nil || count != 1 {
		t.Fatal("more than one cloud slot", err)
	}
	other := f.request("POST", "/api/v1/auth/register", credentials("other_player", "correct-password"), nil)
	otherCookie := other.Result().Cookies()[0]
	otherSession := heartbeatID(t, f, otherCookie)
	if w := f.cloudRequest("GET", otherSession, "", otherCookie); w.Code != 200 || !strings.Contains(w.Body.String(), `"backup":null`) {
		t.Fatal("another account's backup leaked")
	}
	if w := f.cloudRequest("PUT", otherSession, uploadBody(t, 0, save), otherCookie); w.Code != 400 {
		t.Fatal("accepted another owner's payload")
	}
	login := f.request("POST", "/api/v1/auth/login", credentials("local_player", "correct-password"), nil)
	userFrom(t, login, 200)
	next := login.Result().Cookies()[0]
	if w := f.cloudRequest("PUT", session, uploadBody(t, 2, save), cookie); w.Code != 401 {
		t.Fatal("kicked device uploaded")
	}
	if w := f.request("POST", "/api/v1/game/heartbeat", fmt.Sprintf(`{"session_id":%q}`, session), next); w.Code != 401 || len(w.Result().Cookies()) != 0 {
		t.Fatal("old tab acquired new cookie session or erased it")
	}
	nextSession := heartbeatID(t, f, next)
	if w := f.cloudRequest("GET", nextSession, "", next); w.Code != 200 || !strings.Contains(w.Body.String(), `"version":2`) {
		t.Fatal("new device cannot restore saved backup")
	}
	for _, path := range []string{"/api/v1/factories", "/api/v1/factories/client-factory"} {
		if w := f.request("GET", path, "", next); w.Code != 404 {
			t.Fatal("legacy factory route is still active")
		}
	}
}

func TestCloudSaveInputOriginAndFormatBoundaries(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("save_checks", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	if w := f.cloudRequest("GET", "", "", cookie); w.Code != 401 {
		t.Fatal("missing game session accepted")
	}
	save := sampleSave(user.ID)
	for _, change := range []func(*domain.GameSave){
		func(s *domain.GameSave) { s.FormatVersion = 99 },
		func(s *domain.GameSave) { s.Factory.Buildings[0].Rotation = 90 },
		func(s *domain.GameSave) { s.Factory.Simulation.Warehouse["iron_ore"] = domain.MaxSafeInteger + 1 },
		func(s *domain.GameSave) { s.Factory.Simulation.Tick = -1 },
		func(s *domain.GameSave) { delete(s.Factory.Simulation.Buildings, "bus") },
	} {
		candidate := sampleSave(user.ID)
		change(&candidate)
		if w := f.cloudRequest("PUT", session, uploadBody(t, 0, candidate), cookie); w.Code != 400 {
			t.Fatalf("invalid save accepted: %s", w.Body)
		}
	}
	for _, body := range []string{`{}`, `{"base_version":0}`, `{"base_version":0,"save":null}`, `{"base_version":0,"save":{},"owner":"other"}`, uploadBody(t, 0, save) + `{}`} {
		if w := f.cloudRequest("PUT", session, body, cookie); w.Code != 400 {
			t.Fatalf("invalid JSON accepted %d", w.Code)
		}
	}
	for _, test := range []struct {
		origin, media, body string
		status              int
	}{
		{"https://untrusted.invalid", "application/json", uploadBody(t, 0, save), 403},
		{testOrigin, "text/plain", uploadBody(t, 0, save), 415},
		{testOrigin, "application/json", `{"padding":"` + strings.Repeat("x", 4*1024*1024) + `"}`, 400},
	} {
		r := httptest.NewRequest("PUT", "/api/v1/game/save", strings.NewReader(test.body))
		r.AddCookie(cookie)
		r.Header.Set("Origin", test.origin)
		r.Header.Set("Content-Type", test.media)
		r.Header.Set("X-Game-Session", session)
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		if w.Code != test.status && !(len(test.body) > 4*1024*1024 && w.Code == 413) {
			t.Fatalf("boundary: got %d want %d", w.Code, test.status)
		}
	}
}

// Pure validation / JSON fixtures; no persistent database or live services.
func TestMultiCellSaveValidation(t *testing.T) {
	c, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	two := 2
	makeSave := func() domain.GameSave {
		s := sampleSave("footprint-owner")
		s.Factory.Buildings = append(s.Factory.Buildings, domain.BuildingInstance{ID: "large", FactoryID: s.Factory.ID, BuildingType: "m08", X: 4, Y: 4, Size: &two, Configuration: json.RawMessage(`{}`)})
		s.Factory.Simulation.Buildings["large"] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle"}
		return s
	}
	s := makeSave()
	if err := s.Validate("footprint-owner", c); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip domain.GameSave
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if err := roundTrip.Validate("footprint-owner", c); err != nil {
		t.Fatal(err)
	}
	if roundTrip.Factory.Buildings[1].Size == nil || *roundTrip.Factory.Buildings[1].Size != 2 {
		t.Fatal("large footprint lost")
	}
	legacy := makeSave()
	legacy.Factory.Buildings[1].Size = nil
	if err := legacy.Validate("footprint-owner", c); err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{0, 3, -1} {
		bad := makeSave()
		bad.Factory.Buildings[1].Size = &n
		if bad.Validate("footprint-owner", c) == nil {
			t.Fatalf("accepted size %d", n)
		}
	}
	for _, kind := range []string{"bus", "m03", "hand_belt"} {
		bad := makeSave()
		bad.Factory.Buildings[1].BuildingType = kind
		if bad.Validate("footprint-owner", c) == nil {
			t.Fatalf("accepted unsupported type %s", kind)
		}
	}
	for _, pos := range [][2]int{{10, 4}, {4, -10}, {11, 4}, {4, -11}} {
		bad := makeSave()
		bad.Factory.Buildings[1].X = pos[0]
		bad.Factory.Buildings[1].Y = pos[1]
		if bad.Validate("footprint-owner", c) == nil {
			t.Fatal("accepted partial out of bounds")
		}
	}
	for _, pos := range [][2]int{{4, 4}, {5, 4}, {4, 3}, {5, 3}} {
		for _, reverse := range []bool{false, true} {
			bad := makeSave()
			small := domain.BuildingInstance{ID: "overlap", FactoryID: bad.Factory.ID, BuildingType: "hand_belt", X: pos[0], Y: pos[1], Configuration: json.RawMessage(`{}`)}
			bad.Factory.Buildings = append(bad.Factory.Buildings, small)
			bad.Factory.Simulation.Buildings[small.ID] = &domain.MachineState{Input: domain.Inventory{}, Output: domain.Inventory{}, Status: "idle"}
			if reverse {
				bad.Factory.Buildings[1], bad.Factory.Buildings[2] = bad.Factory.Buildings[2], bad.Factory.Buildings[1]
			}
			if bad.Validate("footprint-owner", c) == nil {
				t.Fatal("accepted covered footprint cell")
			}
		}
	}
	for _, replacement := range []string{`"size":null`, `"size":1.5`, `"size":2,"unknown_footprint":true`} {
		var bad domain.GameSave
		if json.Unmarshal([]byte(strings.Replace(string(data), `"size":2`, replacement, 1)), &bad) == nil {
			t.Fatalf("accepted invalid JSON %s", replacement)
		}
	}
}
