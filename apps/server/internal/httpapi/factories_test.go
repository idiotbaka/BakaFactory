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

func factoryFrom(t *testing.T, w *httptest.ResponseRecorder, status int) domain.FactoryDetail {
	t.Helper()
	if w.Code != status {
		t.Fatalf("want %d got %d: %s", status, w.Code, w.Body)
	}
	var body struct {
		Factory domain.FactoryDetail `json:"factory"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Factory
}
func listFrom(t *testing.T, w *httptest.ResponseRecorder) []domain.Factory {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("list failed %s", w.Body)
	}
	var body struct {
		Factories []domain.Factory `json:"factories"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Factories == nil {
		t.Fatal("empty list must be [] not null")
	}
	return body.Factories
}
func TestFactoryLifecycleOwnershipAndDefinitions(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("factory_owner", "correct-password"), nil)
	owner := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	for _, path := range []string{"/api/v1/factories", "/api/v1/definitions", "/api/v1/factories/nonexistent"} {
		if f.request("GET", path, "", nil).Code != 401 {
			t.Fatal("factory API must require auth")
		}
	}
	if len(listFrom(t, f.request("GET", "/api/v1/factories", "", cookie))) != 0 {
		t.Fatal("new user already has factory")
	}
	catalogResponse := f.request("GET", "/api/v1/definitions", "", cookie)
	var catalog domain.Catalog
	if err := json.Unmarshal(catalogResponse.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if catalogResponse.Code != 200 || catalog.Validate() != nil || len(catalog.Items) != 3 || len(catalog.Buildings) != 7 || len(catalog.Recipes) != 3 {
		t.Fatalf("invalid definitions: %s", catalogResponse.Body)
	}
	for _, body := range []string{`{"name":""}`, `{"name":"    "}`, `{"name":"line\nbreak"}`, `{"name":"ok","owner_id":"attacker"}`, `{"name":"ok","width":999}`} {
		if f.request("POST", "/api/v1/factories", body, cookie).Code != 400 {
			t.Fatalf("accepted invalid factory body %s", body)
		}
	}
	created := factoryFrom(t, f.request("POST", "/api/v1/factories", `{"name":"  新工厂 ' 一号  "}`, cookie), 201)
	if created.OwnerID != owner.ID || created.Name != "新工厂 ' 一号" || created.Width != 21 || created.Height != 21 || created.CreatedAt == "" || len(created.Buildings) != 1 {
		t.Fatalf("wrong factory: %+v", created)
	}
	bus := created.Buildings[0]
	if bus.BuildingType != "bus" || bus.X != 0 || bus.Y != 0 || bus.Rotation != 0 || bus.FactoryID != created.ID || string(bus.Configuration) != "{}" {
		t.Fatalf("wrong bus: %+v", bus)
	}
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+created.ID, "", cookie), 200); !reflect.DeepEqual(got, created) {
		t.Fatal("read differs from saved factory")
	}
	if list := listFrom(t, f.request("GET", "/api/v1/factories", "", cookie)); len(list) != 1 || list[0].ID != created.ID {
		t.Fatal("factory list mismatch")
	}
	if second := f.request("POST", "/api/v1/factories", `{"name":"second"}`, cookie); second.Code != 409 {
		t.Fatalf("second factory accepted: %s", second.Body)
	}
	other := f.request("POST", "/api/v1/auth/register", credentials("other_owner", "correct-password"), nil)
	userFrom(t, other, 201)
	otherCookie := other.Result().Cookies()[0]
	if len(listFrom(t, f.request("GET", "/api/v1/factories", "", otherCookie))) != 0 {
		t.Fatal("leaked other owner's list")
	}
	for _, id := range []string{created.ID, "missing"} {
		w := f.request("GET", "/api/v1/factories/"+id, "", otherCookie)
		if w.Code != 404 {
			t.Fatal("unauthorized factory exposed")
		}
	}
	otherFactory := factoryFrom(t, f.request("POST", "/api/v1/factories", `{"name":"另一个工厂"}`, otherCookie), 201)
	if otherFactory.ID == created.ID || len(otherFactory.Buildings) != 1 {
		t.Fatal("factory isolation failed")
	}
	for _, method := range []string{"PATCH", "DELETE", "POST"} {
		if w := f.request(method, "/api/v1/factories/"+created.ID, `{}`, cookie); w.Code != 405 || w.Header().Get("Allow") != "GET" {
			t.Fatal("unexpected editor endpoint")
		}
	}
	f.request("POST", "/api/v1/auth/logout", "", cookie)
	login := f.request("POST", "/api/v1/auth/login", credentials("factory_owner", "correct-password"), nil)
	userFrom(t, login, 200)
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+created.ID, "", login.Result().Cookies()[0]), 200); !reflect.DeepEqual(got, created) {
		t.Fatal("relogin lost layout")
	}
}
func TestBusDatabaseInvariants(t *testing.T) {
	f := newAuthFixture(t, false)
	register := f.request("POST", "/api/v1/auth/register", credentials("bus_owner", "correct-password"), nil)
	userFrom(t, register, 201)
	cookie := register.Result().Cookies()[0]
	factory := factoryFrom(t, f.request("POST", "/api/v1/factories", `{"name":"protected"}`, cookie), 201)
	bus := factory.Buildings[0]
	for _, tc := range []struct {
		name, query string
		args        []any
	}{
		{"move", "UPDATE building_instances SET x=1 WHERE id=?", []any{bus.ID}},
		{"delete", "DELETE FROM building_instances WHERE id=?", []any{bus.ID}},
		{"overwrite", "UPDATE building_instances SET building_type='miner' WHERE id=?", []any{bus.ID}},
		{"rotate", "UPDATE building_instances SET rotation=90 WHERE id=?", []any{bus.ID}},
		{"second_bus", "INSERT INTO building_instances(id,factory_id,building_type,x,y) VALUES('second',?,'bus',0,0)", []any{factory.ID}},
		{"reserved_center", "INSERT INTO building_instances(id,factory_id,building_type,x,y) VALUES('miner',?,'miner',0,0)", []any{factory.ID}},
		{"replace_bus", "INSERT OR REPLACE INTO building_instances(id,factory_id,building_type,x,y) VALUES(?,?,'miner',1,0)", []any{bus.ID, factory.ID}},
		{"replace_center", "INSERT OR REPLACE INTO building_instances(id,factory_id,building_type,x,y) VALUES('replacement',?,'bus',0,0)", []any{factory.ID}},
		{"outside", "INSERT INTO building_instances(id,factory_id,building_type,x,y) VALUES('outside',?,'miner',11,0)", []any{factory.ID}},
		{"invalid_rotation", "INSERT INTO building_instances(id,factory_id,building_type,x,y,rotation) VALUES('rotated',?,'miner',1,0,45)", []any{factory.ID}},
		{"invalid_config", "INSERT INTO building_instances(id,factory_id,building_type,x,y,configuration) VALUES('config',?,'miner',1,0,'[]')", []any{factory.ID}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := f.db.Exec(tc.query, tc.args...); err == nil {
				t.Fatal("invalid bus/building mutation accepted")
			}
		})
	}
	if got := factoryFrom(t, f.request("GET", "/api/v1/factories/"+factory.ID, "", cookie), 200); !reflect.DeepEqual(got, factory) {
		t.Fatal("bus changed after rejected mutations")
	}
	if _, err := f.db.Exec("INSERT INTO building_instances(id,factory_id,building_type,x,y,rotation,configuration) VALUES('edge',?,'miner',-10,10,270,'{}')", factory.ID); err != nil {
		t.Fatalf("valid edge rejected %v", err)
	}
	if _, err := f.db.Exec("INSERT INTO building_instances(id,factory_id,building_type,x,y) VALUES('occupied',?,'furnace',-10,10)", factory.ID); err == nil {
		t.Fatal("occupied tile accepted")
	}
	if _, err := f.db.Exec("UPDATE building_instances SET y=11 WHERE id='edge'"); err == nil {
		t.Fatal("out of bounds update accepted")
	}
	if _, err := f.db.Exec("DELETE FROM users WHERE id=?", factory.OwnerID); err != nil {
		t.Fatalf("owner cascade broken: %v", err)
	}
	var count int
	if err := f.db.QueryRow("SELECT count(*) FROM building_instances").Scan(&count); err != nil || count != 0 {
		t.Fatal("orphaned buildings")
	}
}
func TestConcurrentFactoryCreationAndOrigin(t *testing.T) {
	f := newAuthFixture(t, false)
	register := f.request("POST", "/api/v1/auth/register", credentials("concurrent_owner", "correct-password"), nil)
	userFrom(t, register, 201)
	cookie := register.Result().Cookies()[0]
	r := httptest.NewRequest("POST", "/api/v1/factories", strings.NewReader(`{"name":"bad origin"}`))
	r.AddCookie(cookie)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("creation origin check missing")
	}
	var workers sync.WaitGroup
	statuses := make(chan int, 2)
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			statuses <- f.request("POST", "/api/v1/factories", `{"name":"concurrent"}`, cookie).Code
		}()
	}
	workers.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent creation: %v", counts)
	}
	var factories, buses int
	f.db.QueryRow("SELECT count(*) FROM factories").Scan(&factories)
	f.db.QueryRow("SELECT count(*) FROM building_instances WHERE building_type='bus'").Scan(&buses)
	if factories != 1 || buses != 1 {
		t.Fatal("concurrent creation duplicated factory/bus")
	}
}
