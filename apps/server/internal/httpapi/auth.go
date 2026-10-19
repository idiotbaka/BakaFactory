package httpapi

import (
	"bakafactory/server/internal/application"
	"bakafactory/server/internal/domain"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
)

type AuthOptions struct {
	Service   *application.AuthService
	Secure    bool
	TTL       time.Duration
	Origins   []string
	Factories *application.FactoryService
}

func (a *API) cookieName() string {
	if a.authOptions.Secure {
		return "__Host-bakafactory_session"
	}
	return "bakafactory_session"
}
func (a *API) token(r *http.Request) string {
	cookie, err := r.Cookie(a.cookieName())
	if err != nil {
		return ""
	}
	return cookie.Value
}
func (a *API) setCookie(w http.ResponseWriter, token string, expires time.Time) {
	maxAge := int(a.authOptions.TTL.Seconds())
	if token == "" {
		maxAge = -1
		expires = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: a.cookieName(), Value: token, Path: "/", HttpOnly: true, Secure: a.authOptions.Secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Expires: expires})
}
func (a *API) originAllowed(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		a.fail(w, r, 403, "origin_forbidden", "请求来源不被允许")
		return false
	}
	for _, allowed := range a.authOptions.Origins {
		if origin == allowed {
			return true
		}
	}
	a.fail(w, r, 403, "origin_forbidden", "请求来源不被允许")
	return false
}
func (a *API) readBody(w http.ResponseWriter, r *http.Request, target any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		a.fail(w, r, 415, "unsupported_media_type", "请使用 application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err = decoder.Decode(target)
	if err == nil {
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			err = errors.New("multiple JSON values")
		}
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			a.fail(w, r, 413, "body_too_large", "请求内容过大")
		} else {
			a.fail(w, r, 400, "invalid_json", "请求格式不正确")
		}
		return false
	}
	return true
}
func (a *API) authError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrValidation):
		a.fail(w, r, 400, "validation_error", strings.TrimPrefix(err.Error(), domain.ErrValidation.Error()+": "))
	case errors.Is(err, domain.ErrUsernameTaken):
		a.fail(w, r, 409, "username_taken", "这个用户名已被使用")
	case errors.Is(err, domain.ErrCredentials):
		a.fail(w, r, 401, "invalid_credentials", "用户名或密码不正确")
	case errors.Is(err, domain.ErrUnauthenticated):
		a.setCookie(w, "", time.Time{})
		a.fail(w, r, 401, "unauthenticated", "请先登录，或重新登录已过期的会话")
	case errors.Is(err, domain.ErrAuthBusy):
		w.Header().Set("Retry-After", "1")
		a.fail(w, r, 429, "auth_busy", "服务繁忙，请稍后再试")
	default:
		a.fail(w, r, 500, "internal_error", "暂时无法完成操作，请稍后重试")
	}
}
func (a *API) authRoutes(mux *http.ServeMux) {
	route := func(path, method string, fn http.HandlerFunc) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != method {
				w.Header().Set("Allow", method)
				a.fail(w, r, 405, "method_not_allowed", "请求方法不被支持")
				return
			}
			if method != "GET" && !a.originAllowed(w, r) {
				return
			}
			fn(w, r)
		})
	}
	route("/api/v1/auth/register", "POST", func(w http.ResponseWriter, r *http.Request) { a.authenticate(w, r, true) })
	route("/api/v1/auth/login", "POST", func(w http.ResponseWriter, r *http.Request) { a.authenticate(w, r, false) })
	route("/api/v1/auth/logout", "POST", func(w http.ResponseWriter, r *http.Request) {
		if err := a.auth.Logout(r.Context(), a.token(r)); err != nil {
			a.authError(w, r, err)
			return
		}
		a.setCookie(w, "", time.Time{})
		w.WriteHeader(204)
	})
	route("/api/v1/me", "GET", func(w http.ResponseWriter, r *http.Request) {
		user, err := a.auth.Current(r.Context(), a.token(r))
		if err != nil {
			a.authError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"user": user})
	})
	route("/api/v1/me/profile", "PATCH", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DisplayName string `json:"display_name"`
		}
		if !a.readBody(w, r, &body) {
			return
		}
		user, err := a.auth.UpdateProfile(r.Context(), a.token(r), body.DisplayName)
		if err != nil {
			a.authError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"user": user})
	})
}
func (a *API) authenticate(w http.ResponseWriter, r *http.Request, register bool) {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if !a.allowAttempt(w, r, "ip:"+ip, 20) {
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !a.readBody(w, r, &body) {
		return
	}
	accountKey := application.NormalizeUsername(body.Username)
	if len(accountKey) > 24 {
		accountKey = "invalid-username"
	}
	if !a.allowAttempt(w, r, "account:"+accountKey, 10) {
		return
	}
	result, err := a.auth.Authenticate(r.Context(), body.Username, body.Password, a.token(r), register)
	if err != nil {
		a.authError(w, r, err)
		return
	}
	a.setCookie(w, result.Token, result.ExpiresAt)
	status := 200
	if register {
		status = 201
	}
	writeJSON(w, status, map[string]any{"user": result.User})
}
func (a *API) allowAttempt(w http.ResponseWriter, r *http.Request, key string, maximum int) bool {
	if a.limits.allow(key, maximum) {
		return true
	}
	w.Header().Set("Retry-After", "900")
	a.fail(w, r, 429, "rate_limited", "尝试次数过多，请稍后再试")
	return false
}
