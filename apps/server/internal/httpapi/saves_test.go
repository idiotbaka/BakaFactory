package httpapi

import (
	"bakafactory/server/internal/domain"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

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
func uploadBody(t *testing.T, base int, save domain.GameSave) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"base_version": base, "save": save})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestCloudSaveSingleSlotOwnershipAndSessionRevocation(t *testing.T) {
	f := newAuthFixture(t, false)
	registered := f.request("POST", "/api/v1/auth/register", credentials("local_player", "correct-password"), nil)
	user := userFrom(t, registered, 201)
	cookie := registered.Result().Cookies()[0]
	session := heartbeatID(t, f, cookie)
	if w := f.cloudRequest("GET", session, "", cookie); w.Code != 200 || !strings.Contains(w.Body.String(), `"backup":null`) {
		t.Fatalf("new game must start empty: %s", w.Body)
	}
	save := sampleSave(user.ID)
	first := f.cloudRequest("PUT", session, uploadBody(t, 0, save), cookie)
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
		func(s *domain.GameSave) { s.Factory.Buildings[0].X = 1 },
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
