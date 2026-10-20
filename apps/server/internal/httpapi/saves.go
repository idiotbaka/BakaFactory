package httpapi

import (
	"bakafactory/server/internal/domain"
	"errors"
	"net/http"
)

func (a *API) saveRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/game/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			a.fail(w, r, 405, "method_not_allowed", "请求方法不被支持")
			return
		}
		if !a.originAllowed(w, r) {
			return
		}
		var body struct {
			SessionID *string `json:"session_id"`
		}
		if !a.readBody(w, r, &body) {
			return
		}
		if body.SessionID == nil {
			a.fail(w, r, 400, "validation_error", "session_id 为必填字段")
			return
		}
		user, id, err := a.saves.Session(r.Context(), a.token(r), *body.SessionID)
		if err != nil {
			a.authError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"user": user, "session_id": id, "lease_seconds": 30})
	})
	mux.HandleFunc("/api/v1/game/save", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "PUT" {
			w.Header().Set("Allow", "GET, PUT")
			a.fail(w, r, 405, "method_not_allowed", "请求方法不被支持")
			return
		}
		if r.Method == "PUT" && !a.originAllowed(w, r) {
			return
		}
		var result *domain.CloudSave
		var err error
		if r.Method == "GET" {
			result, err = a.saves.Get(r.Context(), a.token(r), r.Header.Get("X-Game-Session"))
		} else {
			var body struct {
				BaseVersion *int64           `json:"base_version"`
				Save        *domain.GameSave `json:"save"`
			}
			if !a.readLimitedBody(w, r, &body, 4*1024*1024) {
				return
			}
			if body.BaseVersion == nil || body.Save == nil {
				a.fail(w, r, 400, "validation_error", "base_version 和 save 为必填字段")
				return
			}
			result, err = a.saves.Put(r.Context(), a.token(r), r.Header.Get("X-Game-Session"), *body.BaseVersion, *body.Save)
		}
		if errors.Is(err, domain.ErrSaveConflict) {
			a.fail(w, r, 409, "save_conflict", "云存档已更新，请选择要保留的进度")
			return
		}
		if err != nil {
			a.authError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"backup": result})
	})
	mux.HandleFunc("/api/v1/definitions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.Header().Set("Allow", "GET")
			a.fail(w, r, 405, "method_not_allowed", "请求方法不被支持")
			return
		}
		if _, err := a.auth.Current(r.Context(), a.token(r)); err != nil {
			a.authError(w, r, err)
			return
		}
		writeJSON(w, 200, a.saves.Catalog())
	})
}
