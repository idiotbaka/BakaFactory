package httpapi

import (
	"bakafactory/server/internal/application"
	"bakafactory/server/internal/catalog"
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/domain"
	"bakafactory/server/internal/repository"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testOrigin = "http://127.0.0.1:5173"

type authFixture struct {
	handler http.Handler
	db      *sql.DB
}

func newAuthFixture(t *testing.T, secure bool) authFixture {
	t.Helper()
	db, err := database.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	service := application.NewAuthService(repository.NewAccounts(db), 7*24*time.Hour)
	definitions, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	factories := application.NewFactoryService(repository.NewFactories(db), definitions)
	h, err := New(application.NewHealthService(repository.NewHealth(db), "test", "test"), slog.New(slog.NewJSONHandler(io.Discard, nil)), "", AuthOptions{Service: service, Secure: secure, TTL: 7 * 24 * time.Hour, Origins: []string{testOrigin}, Factories: factories})
	if err != nil {
		t.Fatal(err)
	}
	return authFixture{h, db}
}
func (f authFixture) request(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Origin", testOrigin)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func credentials(name, pwd string) string {
	body, _ := json.Marshal(map[string]string{"username": name, "password": pwd})
	return string(body)
}
func userFrom(t *testing.T, w *httptest.ResponseRecorder, expected int) domain.User {
	t.Helper()
	if w.Code != expected {
		t.Fatalf("want %d got %d: %s", expected, w.Code, w.Body)
	}
	var body struct {
		User domain.User `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.User
}
func TestAccountLifecycleAndProfilePersistence(t *testing.T) {
	f := newAuthFixture(t, false)
	w := f.request("POST", "/api/v1/auth/register", credentials("Builder_01", "correct-password"), nil)
	u := userFrom(t, w, 201)
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.MaxAge != 604800 || cookie.Domain != "" {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
	if u.Username != "builder_01" || u.CreatedAt == "" || u.LastLoginAt == "" {
		t.Fatalf("invalid user: %+v", u)
	}
	if strings.Contains(w.Body.String(), "password") || strings.Contains(w.Body.String(), cookie.Value) {
		t.Fatal("credentials leaked")
	}
	if current := userFrom(t, f.request("GET", "/api/v1/me", "", cookie), 200); current.ID != u.ID {
		t.Fatal("session not persisted")
	}
	name := "中文厂长 ' 工厂"
	body, _ := json.Marshal(map[string]string{"display_name": name})
	if current := userFrom(t, f.request("PATCH", "/api/v1/me/profile", string(body), cookie), 200); current.DisplayName != name {
		t.Fatal("profile not saved")
	}
	if current := userFrom(t, f.request("GET", "/api/v1/me", "", cookie), 200); current.DisplayName != name {
		t.Fatal("refresh loses nickname")
	}
	if duplicate := f.request("POST", "/api/v1/auth/register", credentials("BUILDER_01", "different-password"), nil); duplicate.Code != 409 {
		t.Fatalf("duplicate: %v", duplicate.Body)
	}
	if wrong := f.request("POST", "/api/v1/auth/login", credentials("builder_01", "wrong-password"), nil); wrong.Code != 401 || len(wrong.Result().Cookies()) != 0 {
		t.Fatal("bad password logged in")
	}
	w = f.request("POST", "/api/v1/auth/logout", "", cookie)
	if w.Code != 204 || w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("logout failed")
	}
	if f.request("GET", "/api/v1/me", "", cookie).Code != 401 {
		t.Fatal("revoked token accepted")
	}
	w = f.request("POST", "/api/v1/auth/login", credentials("BUILDER_01", "correct-password"), nil)
	if current := userFrom(t, w, 200); current.DisplayName != name || current.ID != u.ID {
		t.Fatal("relogin loses nickname")
	}
	if w.Result().Cookies()[0].Value == cookie.Value {
		t.Fatal("session token reused")
	}
	var passwordHash, tokenHash string
	if err := f.db.QueryRow("SELECT password_hash FROM users").Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT token_hash FROM sessions").Scan(&tokenHash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(passwordHash, "$argon2id$") || tokenHash == w.Result().Cookies()[0].Value || len(tokenHash) != 64 {
		t.Fatal("credentials stored unsafely")
	}
}
func TestSessionRotationIsolationAndExpiry(t *testing.T) {
	f := newAuthFixture(t, true)
	first := f.request("POST", "/api/v1/auth/register", credentials("first_user", "correct-password"), nil)
	firstUser := userFrom(t, first, 201)
	a := first.Result().Cookies()[0]
	if !a.Secure || a.Name != "__Host-bakafactory_session" {
		t.Fatal("production cookie must be Secure and host-only")
	}
	rotated := f.request("POST", "/api/v1/auth/login", credentials("first_user", "correct-password"), a)
	userFrom(t, rotated, 200)
	a2 := rotated.Result().Cookies()[0]
	if f.request("GET", "/api/v1/me", "", a).Code != 401 {
		t.Fatal("old browser session survived rotation")
	}
	secondBrowser := f.request("POST", "/api/v1/auth/login", credentials("first_user", "correct-password"), nil)
	userFrom(t, secondBrowser, 200)
	b := secondBrowser.Result().Cookies()[0]
	other := f.request("POST", "/api/v1/auth/register", credentials("second_user", "correct-password"), nil)
	otherUser := userFrom(t, other, 201)
	c := other.Result().Cookies()[0]
	userFrom(t, f.request("PATCH", "/api/v1/me/profile", `{"display_name":"第二位厂长"}`, c), 200)
	if userFrom(t, f.request("GET", "/api/v1/me", "", a2), 200).DisplayName != "first_user" || firstUser.ID == otherUser.ID {
		t.Fatal("profile changed another account")
	}
	if f.request("PATCH", "/api/v1/me/profile", `{"display_name":"hacked","user_id":"other"}`, a2).Code != 400 {
		t.Fatal("accepted foreign user ID")
	}
	f.request("POST", "/api/v1/auth/logout", "", b)
	if f.request("GET", "/api/v1/me", "", b).Code != 401 || f.request("GET", "/api/v1/me", "", a2).Code != 200 {
		t.Fatal("logout affected another browser")
	}
	if _, err := f.db.Exec("UPDATE sessions SET expires_at=?", time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	if f.request("GET", "/api/v1/me", "", a2).Code != 401 {
		t.Fatal("expired server session accepted")
	}
	if f.request("GET", "/api/v1/me", "", nil).Code != 401 {
		t.Fatal("guest accepted")
	}
}
func TestAuthInputAndOriginProtection(t *testing.T) {
	f := newAuthFixture(t, false)
	for _, origin := range []string{"", "null", "https://evil.example", "http://127.0.0.1:5173.evil.example"} {
		r := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(credentials("user_name", "correct-password")))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("accepted origin %s", origin)
		}
	}
	for _, tc := range []struct {
		body   string
		status int
	}{
		{credentials("a", "correct-password"), 400}, {credentials("valid_user", "short"), 400}, {credentials("' OR 1=1 --", "correct-password"), 400},
		{`{"username":"valid_user","password":"correct-password","id":"injected"}`, 400}, {`{} {}`, 400}, {`{invalid`, 400},
		{credentials(strings.Repeat("a", 17000), "correct-password"), 413},
	} {
		if w := f.request("POST", "/api/v1/auth/register", tc.body, nil); w.Code != tc.status {
			t.Fatalf("want %d got %d %s", tc.status, w.Code, w.Body)
		}
	}
	r := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader("username=user_name"))
	r.Header.Set("Origin", testOrigin)
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 415 {
		t.Fatal("accepted form encoded credentials")
	}
	r = httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	r.Header.Set("Origin", testOrigin)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("accepted cross-site fetch")
	}
	if w := f.request("GET", "/api/v1/auth/login", "", nil); w.Code != 405 || w.Header().Get("Allow") != "POST" {
		t.Fatal("method validation missing")
	}
	if w := f.request("POST", "/api/v1/auth/logout", "", nil); w.Code != 204 {
		t.Fatal("logout is not idempotent")
	}
}
func TestAuthRateLimit(t *testing.T) {
	f := newAuthFixture(t, false)
	for range 10 {
		if w := f.request("POST", "/api/v1/auth/login", credentials("unknown_user", "correct-password"), nil); w.Code != 401 {
			t.Fatalf("unexpected %d", w.Code)
		}
	}
	w := f.request("POST", "/api/v1/auth/login", credentials("UNKNOWN_USER", "correct-password"), nil)
	if w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatal("account brute force not limited")
	}
	for i := 0; i < 9; i++ {
		f.request("POST", "/api/v1/auth/login", credentials(fmt.Sprintf("different_%d", i), "correct-password"), nil)
	}
	if f.request("POST", "/api/v1/auth/login", credentials("new_account", "correct-password"), nil).Code != 429 {
		t.Fatal("IP brute force not limited")
	}
}
func TestLimiterExpiryAndCapacity(t *testing.T) {
	l := newAuthLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	if !l.allow("test", 1) || l.allow("test", 1) {
		t.Fatal("limit failed")
	}
	now = now.Add(15 * time.Minute)
	if !l.allow("test", 1) {
		t.Fatal("expired window not reset")
	}
	for i := 0; i < 10000; i++ {
		l.allow(fmt.Sprintf("entry_%d", i), 1)
	}
	if len(l.entries) > 10000 || l.allow("overflow", 1) {
		t.Fatal("unbounded limiter")
	}
}
