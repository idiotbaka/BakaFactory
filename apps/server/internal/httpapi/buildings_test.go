package httpapi

import (
	"bakafactory/server/internal/domain"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func buildingFixture(t *testing.T) (authFixture, domain.FactoryDetail, *http.Cookie) {
	t.Helper()
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("editor_owner", "correct-password"), nil)
	userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	factory := factoryFrom(t, f.request("POST", "/api/v1/factories", `{"name":"编辑测试工厂"}`, cookie), 201)
	return f, factory, cookie
}
func placementBody(kind string, x, y, rotation int) string {
	body, _ := json.Marshal(map[string]any{"building_type": kind, "x": x, "y": y, "rotation": rotation})
	return string(body)
}
func TestBuildingEditingLifecycle(t *testing.T) {
	f, original, cookie := buildingFixture(t)
	path := "/api/v1/factories/" + original.ID + "/buildings"
	snapshot := original
	for i, kind := range []string{"miner", "furnace", "assembler", "conveyor"} {
		snapshot = factoryFrom(t, f.request("POST", path, placementBody(kind, i+1, 1, i*90), cookie), 201)
	}
	if len(snapshot.Buildings) != 5 {
		t.Fatal("not all palette buildings placed")
	}
	var miner domain.BuildingInstance
	for _, b := range snapshot.Buildings {
		if b.BuildingType == "miner" {
			miner = b
		}
	}
	if miner.FactoryID != original.ID || string(miner.Configuration) != "{}" {
		t.Fatal("client determined invalid instance state")
	}
	updated := factoryFrom(t, f.request("PATCH", path+"/"+miner.ID, `{"x":-10,"y":10,"rotation":270}`, cookie), 200)
	for _, b := range updated.Buildings {
		if b.ID == miner.ID && (b.X != -10 || b.Y != 10 || b.Rotation != 270) {
			t.Fatal("move and rotate did not preserve identity")
		}
	}
	loaded := factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200)
	if !reflect.DeepEqual(loaded, updated) {
		t.Fatal("refresh lost edited layout")
	}
	deleted := factoryFrom(t, f.request("DELETE", path+"/"+miner.ID, "", cookie), 200)
	if len(deleted.Buildings) != 4 {
		t.Fatal("delete did not update layout")
	}
	for _, b := range deleted.Buildings {
		if b.ID == miner.ID {
			t.Fatal("deleted instance survived")
		}
	}
	if f.request("DELETE", path+"/"+miner.ID, "", cookie).Code != 404 {
		t.Fatal("missing building not rejected")
	}
	if len(factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200).Buildings) != 4 {
		t.Fatal("delete not persisted")
	}
}
func TestBuildingValidationAndBusProtection(t *testing.T) {
	f, original, cookie := buildingFixture(t)
	path := "/api/v1/factories/" + original.ID + "/buildings"
	for _, tc := range []struct {
		body   string
		status int
	}{
		{placementBody("unknown", 1, 1, 0), 400}, {placementBody("bus", 1, 1, 0), 409}, {placementBody("miner", 0, 0, 0), 409},
		{placementBody("miner", 11, 0, 0), 400}, {placementBody("miner", 0, -11, 0), 400}, {placementBody("miner", 1, 1, 45), 400},
		{`{"building_type":"miner","x":1,"rotation":0}`, 400}, {`{"building_type":"miner","x":null,"y":1,"rotation":0}`, 400}, {`{"building_type":"miner","x":1.5,"y":1,"rotation":0}`, 400},
		{`{"building_type":"miner","x":1,"y":1,"rotation":0,"configuration":{"inventory":999}}`, 400},
	} {
		if w := f.request("POST", path, tc.body, cookie); w.Code != tc.status {
			t.Fatalf("want %d got %d: %s", tc.status, w.Code, w.Body)
		}
	}
	busPath := path + "/" + original.Buildings[0].ID
	if f.request("PATCH", busPath, `{"x":1,"y":1,"rotation":90}`, cookie).Code != 409 || f.request("DELETE", busPath, "", cookie).Code != 409 {
		t.Fatal("Bus editable through API")
	}
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200); !reflect.DeepEqual(got, original) {
		t.Fatal("rejected mutations changed Bus")
	}
	placed := factoryFrom(t, f.request("POST", path, placementBody("miner", 1, 1, 0), cookie), 201)
	var id string
	for _, b := range placed.Buildings {
		if b.BuildingType == "miner" {
			id = b.ID
		}
	}
	if f.request("POST", path, placementBody("furnace", 1, 1, 0), cookie).Code != 409 {
		t.Fatal("occupied tile accepted")
	}
	for _, body := range []string{`{"x":0,"y":0,"rotation":90}`, `{"x":100,"y":1,"rotation":180}`, `{"x":2,"y":2,"rotation":45}`, `{"x":2,"y":2,"rotation":0,"building_type":"bus"}`} {
		w := f.request("PATCH", path+"/"+id, body, cookie)
		if w.Code != 400 && w.Code != 409 {
			t.Fatalf("invalid update accepted: %s", w.Body)
		}
	}
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200); !reflect.DeepEqual(got, placed) {
		t.Fatal("failed move changed position or rotation")
	}
}
func TestBuildingOwnershipOriginAndMethods(t *testing.T) {
	f, original, cookie := buildingFixture(t)
	path := "/api/v1/factories/" + original.ID + "/buildings"
	placed := factoryFrom(t, f.request("POST", path, placementBody("miner", 1, 1, 0), cookie), 201)
	var id string
	for _, b := range placed.Buildings {
		if b.BuildingType == "miner" {
			id = b.ID
		}
	}
	other := f.request("POST", "/api/v1/auth/register", credentials("editor_other", "correct-password"), nil)
	userFrom(t, other, 201)
	otherCookie := other.Result().Cookies()[0]
	for _, tc := range []struct{ method, path, body string }{{"POST", path, placementBody("miner", 2, 2, 0)}, {"PATCH", path + "/" + id, `{"x":2,"y":2,"rotation":90}`}, {"DELETE", path + "/" + id, ""}} {
		if f.request(tc.method, tc.path, tc.body, otherCookie).Code != 404 {
			t.Fatal("other owner edited factory")
		}
		if f.request(tc.method, tc.path, tc.body, nil).Code != 401 {
			t.Fatal("guest edited factory")
		}
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.AddCookie(cookie)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://evil.example")
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("cross-origin mutation accepted")
		}
	}
	if f.request("GET", path, "", cookie).Code != 405 || f.request("POST", path+"/"+id, `{}`, cookie).Code != 405 {
		t.Fatal("wrong editor method accepted")
	}
	otherFactory := factoryFrom(t, f.request("POST", "/api/v1/factories", `{"name":"另一座"}`, otherCookie), 201)
	if f.request("DELETE", "/api/v1/factories/"+otherFactory.ID+"/buildings/"+id, "", otherCookie).Code != 404 {
		t.Fatal("cross-factory building ID accepted")
	}
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200); !reflect.DeepEqual(got, placed) {
		t.Fatal("unauthorized request changed factory")
	}
}
func TestConcurrentBuildingPlacementAndMove(t *testing.T) {
	f, original, cookie := buildingFixture(t)
	path := "/api/v1/factories/" + original.ID + "/buildings"
	var workers sync.WaitGroup
	results := make(chan int, 2)
	for _, kind := range []string{"miner", "furnace"} {
		workers.Add(1)
		go func() {
			defer workers.Done()
			results <- f.request("POST", path, placementBody(kind, 1, 1, 0), cookie).Code
		}()
	}
	workers.Wait()
	close(results)
	counts := map[int]int{}
	for status := range results {
		counts[status]++
	}
	if counts[201] != 1 || counts[409] != 1 {
		t.Fatalf("placement race: %v", counts)
	}
	second := factoryFrom(t, f.request("POST", path, placementBody("assembler", 2, 2, 0), cookie), 201)
	var editable []domain.BuildingInstance
	for _, b := range second.Buildings {
		if b.BuildingType != "bus" {
			editable = append(editable, b)
		}
	}
	results = make(chan int, 2)
	for _, b := range editable {
		workers.Add(1)
		go func() {
			defer workers.Done()
			results <- f.request("PATCH", path+"/"+b.ID, `{"x":3,"y":3,"rotation":90}`, cookie).Code
		}()
	}
	workers.Wait()
	close(results)
	counts = map[int]int{}
	for status := range results {
		counts[status]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("move race: %v", counts)
	}
	loaded := factoryFrom(t, f.request("GET", "/api/v1/factories/"+original.ID, "", cookie), 200)
	if len(loaded.Buildings) != 3 {
		t.Fatal("race lost or duplicated buildings")
	}
	for _, b := range loaded.Buildings {
		if b.BuildingType != "bus" && b.X != 3 && b.Rotation != 0 {
			t.Fatal("rejected move partially rotated")
		}
	}
}
