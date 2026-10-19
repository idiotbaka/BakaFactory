package httpapi

import (
	"bakafactory/server/internal/domain"
	"errors"
	"net/http"
	"strings"
)

func (a *API) factoryError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrFactoryLimit):
		a.fail(w, r, 409, "factory_limit", "当前阶段每个账号最多拥有一个工厂")
	case errors.Is(err, domain.ErrFactoryNotFound):
		a.fail(w, r, 404, "factory_not_found", "工厂不存在或无法访问")
	case errors.Is(err, domain.ErrBuildingNotFound):
		a.fail(w, r, 404, "building_not_found", "建筑不存在或无法访问")
	case errors.Is(err, domain.ErrBuildingFixed):
		a.fail(w, r, 409, "building_fixed", "工厂仓库固定，不能放置、移动、旋转或删除")
	case errors.Is(err, domain.ErrTileOccupied):
		a.fail(w, r, 409, "tile_occupied", "目标格子已被占用")
	default:
		a.authError(w, r, err)
	}
}
func (a *API) factoryRoutes(mux *http.ServeMux) {
	protect := func(methods string, fn func(http.ResponseWriter, *http.Request, domain.User)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			allowed := false
			for _, method := range strings.Split(methods, ", ") {
				if r.Method == method {
					allowed = true
				}
			}
			if !allowed {
				w.Header().Set("Allow", methods)
				a.fail(w, r, 405, "method_not_allowed", "请求方法不被支持")
				return
			}
			user, err := a.auth.Current(r.Context(), a.token(r))
			if err != nil {
				a.authError(w, r, err)
				return
			}
			if r.Method != "GET" && !a.originAllowed(w, r) {
				return
			}
			fn(w, r, user)
		}
	}
	mux.HandleFunc("/api/v1/definitions", protect("GET", func(w http.ResponseWriter, r *http.Request, user domain.User) {
		writeJSON(w, 200, a.factories.Catalog())
	}))
	mux.HandleFunc("/api/v1/factories", protect("GET, POST", func(w http.ResponseWriter, r *http.Request, user domain.User) {
		if r.Method == "GET" {
			factories, err := a.factories.List(r.Context(), user.ID)
			if err != nil {
				a.factoryError(w, r, err)
				return
			}
			writeJSON(w, 200, map[string]any{"factories": factories})
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if !a.readBody(w, r, &body) {
			return
		}
		factory, err := a.factories.Create(r.Context(), user.ID, body.Name)
		if err != nil {
			a.factoryError(w, r, err)
			return
		}
		writeJSON(w, 201, map[string]any{"factory": factory})
	}))
	mux.HandleFunc("/api/v1/factories/{id}", protect("GET", func(w http.ResponseWriter, r *http.Request, user domain.User) {
		factory, err := a.factories.Get(r.Context(), user.ID, r.PathValue("id"))
		if err != nil {
			a.factoryError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"factory": factory})
	}))
	mux.HandleFunc("/api/v1/factories/{id}/buildings", protect("POST", func(w http.ResponseWriter, r *http.Request, user domain.User) {
		var body struct {
			BuildingType string `json:"building_type"`
			X            *int   `json:"x"`
			Y            *int   `json:"y"`
			Rotation     *int   `json:"rotation"`
		}
		if !a.readBody(w, r, &body) {
			return
		}
		if body.X == nil || body.Y == nil || body.Rotation == nil {
			a.fail(w, r, 400, "validation_error", "x、y 和 rotation 为必填整数")
			return
		}
		f, err := a.factories.Place(r.Context(), user.ID, r.PathValue("id"), body.BuildingType, domain.BuildingPlacement{X: *body.X, Y: *body.Y, Rotation: *body.Rotation})
		if err != nil {
			a.factoryError(w, r, err)
			return
		}
		writeJSON(w, 201, map[string]any{"factory": f})
	}))
	mux.HandleFunc("/api/v1/factories/{id}/buildings/{buildingID}", protect("PATCH, DELETE", func(w http.ResponseWriter, r *http.Request, user domain.User) {
		var f domain.FactoryDetail
		var err error
		if r.Method == "DELETE" {
			f, err = a.factories.DeleteBuilding(r.Context(), user.ID, r.PathValue("id"), r.PathValue("buildingID"))
		} else {
			var body struct {
				X        *int `json:"x"`
				Y        *int `json:"y"`
				Rotation *int `json:"rotation"`
			}
			if !a.readBody(w, r, &body) {
				return
			}
			if body.X == nil || body.Y == nil || body.Rotation == nil {
				a.fail(w, r, 400, "validation_error", "x、y 和 rotation 为必填整数")
				return
			}
			f, err = a.factories.UpdateBuilding(r.Context(), user.ID, r.PathValue("id"), r.PathValue("buildingID"), domain.BuildingPlacement{X: *body.X, Y: *body.Y, Rotation: *body.Rotation})
		}
		if err != nil {
			a.factoryError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"factory": f})
	}))
}
