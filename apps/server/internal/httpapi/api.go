package httpapi

import (
	"bakafactory/server/internal/application"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type requestIDKey struct{}
type API struct {
	health      *application.HealthService
	logger      *slog.Logger
	auth        *application.AuthService
	authOptions AuthOptions
	limits      *authLimiter
	saves       *application.SaveService
}
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}
type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
}

func New(health *application.HealthService, logger *slog.Logger, webDir string, options ...AuthOptions) (http.Handler, error) {
	a := &API{health: health, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.healthHandler)
	mux.HandleFunc("/api/v1/health", a.healthHandler)
	if len(options) > 0 {
		a.authOptions = options[0]
		a.auth = options[0].Service
		a.limits = newAuthLimiter()
		a.authRoutes(mux)
		if options[0].Saves != nil {
			a.saves = options[0].Saves
			a.saveRoutes(mux)
		}
	}
	var static http.Handler
	if webDir != "" {
		info, err := os.Stat(filepath.Join(webDir, "index.html"))
		if err != nil || info.IsDir() {
			return nil, fmt.Errorf("WEB_DIST_DIR must contain built index.html")
		}
		static = cacheStaticFiles(http.FileServer(http.Dir(webDir)))
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if static != nil && (r.Method == http.MethodGet || r.Method == http.MethodHead) && r.URL.Path != "/api" && !strings.HasPrefix(r.URL.Path, "/api/") {
			static.ServeHTTP(w, r)
			return
		}
		a.fail(w, r, http.StatusNotFound, "not_found", "Endpoint not found")
	})
	return a.middleware(mux), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	// Marshal before writing headers so encoding failure cannot emit a partial response.
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":{"code":"internal_error","message":"Response encoding failed","request_id":""}}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}
func (a *API) fail(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	id, _ := r.Context().Value(requestIDKey{}).(string)
	writeJSON(w, status, ErrorResponse{Error: ErrorBody{Code: code, Message: message, RequestID: id}})
}
func (a *API) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		a.fail(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "Only GET is supported")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	health, err := a.health.Check(ctx)
	if err != nil {
		a.logger.ErrorContext(r.Context(), "database health check failed", "request_id", r.Context().Value(requestIDKey{}), "error", err)
		a.fail(w, r, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, health)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func validID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.') {
			return false
		}
	}
	return true
}
func (a *API) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		id := r.Header.Get("X-Request-ID")
		if !validID(id) {
			var bytes [16]byte
			if _, err := rand.Read(bytes[:]); err != nil {
				panic(err)
			}
			id = hex.EncodeToString(bytes[:])
		}
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		recorder := &statusWriter{ResponseWriter: w}
		defer func() {
			if recovered := recover(); recovered != nil {
				a.logger.Error("request panic", "request_id", id, "error", fmt.Sprint(recovered))
				if recorder.status == 0 {
					a.fail(recorder, r, http.StatusInternalServerError, "internal_error", "Internal server error")
				}
			}
			status := recorder.status
			if status == 0 {
				status = http.StatusOK
			}
			a.logger.Info("http request", "request_id", id, "method", r.Method, "path", r.URL.Path, "status", status, "duration_ms", time.Since(started).Milliseconds())
		}()
		next.ServeHTTP(recorder, r)
	})
}
