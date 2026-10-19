package httpapi

import (
	"bakafactory/server/internal/application"
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/repository"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type failingRepository struct{}

func (failingRepository) Check(context.Context) error {
	return errors.New("private database path should never reach clients")
}

type panicRepository struct{}

func (panicRepository) Check(context.Context) error { panic("private panic details") }
func handler(t *testing.T, repo application.HealthRepository, webDir string) http.Handler {
	t.Helper()
	h, err := New(application.NewHealthService(repo, "0.1.0", "test"), slog.New(slog.NewJSONHandler(io.Discard, nil)), webDir)
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func TestHealthDatabaseIntegrationAndErrors(t *testing.T) {
	db, err := database.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	h := handler(t, repository.NewHealth(db), "")
	for _, path := range []string{"/health", "/api/v1/health"} {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("X-Request-ID", "test-request-01")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Header().Get("X-Request-ID") != "test-request-01" || w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Fatalf("unexpected response: %v", w)
		}
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["status"] != "ok" || body["database"] != "ok" || body["version"] != "0.1.0" || body["environment"] != "test" {
			t.Fatalf("unexpected body: %v", body)
		}
	}
	for _, tc := range []struct {
		method, path, code string
		status             int
	}{{"POST", "/health", "method_not_allowed", 405}, {"GET", "/missing", "not_found", 404}, {"POST", "/api/v1/missing", "not_found", 404}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Header.Set("X-Request-ID", "invalid request id")
		h.ServeHTTP(w, r)
		var body ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != tc.status || body.Error.Code != tc.code || !validID(body.Error.RequestID) || body.Error.RequestID != w.Header().Get("X-Request-ID") {
			t.Fatalf("unexpected error: %v %v", w, body)
		}
		if tc.status == 405 && w.Header().Get("Allow") != "GET" {
			t.Fatal("missing Allow")
		}
	}
	db.Close()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 503 {
		t.Fatalf("closed database returned %d", w.Code)
	}
}
func TestUnavailableAndPanicHideInternalErrors(t *testing.T) {
	for _, tc := range []struct {
		repo   application.HealthRepository
		status int
		code   string
	}{{failingRepository{}, 503, "database_unavailable"}, {panicRepository{}, 500, "internal_error"}} {
		w := httptest.NewRecorder()
		handler(t, tc.repo, "").ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
		var body ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != tc.status || body.Error.Code != tc.code || body.Error.RequestID == "" {
			t.Fatalf("unexpected response %v", w)
		}
		if body.Error.Message != "Database is unavailable" && body.Error.Message != "Internal server error" {
			t.Fatal("internal details leaked")
		}
	}
}
func TestProductionServesWebAndKeepsAPIErrors(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("Persistent Factory"), 0600); err != nil {
		t.Fatal(err)
	}
	h := handler(t, failingRepository{}, dir)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || w.Body.String() != "Persistent Factory" {
		t.Fatalf("web not served: %v", w)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/unknown", nil))
	if w.Code != 404 || w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatal("API errors must remain JSON")
	}
}
