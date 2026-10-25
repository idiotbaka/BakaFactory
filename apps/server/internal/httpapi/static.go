package httpapi

import (
	"net/http"
	"regexp"
)

// Vite's default output includes an eight-character content hash. Public files
// without a version must be revalidated rather than cached as immutable.
var immutableStaticPath = regexp.MustCompile(`^/assets/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$|^/fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.woff2$`)

func cacheStaticFiles(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		policy := "no-cache"
		if immutableStaticPath.MatchString(r.URL.Path) {
			policy = "public, max-age=31536000, immutable"
		}
		next.ServeHTTP(&staticCacheWriter{ResponseWriter: w, policy: policy}, r)
	})
}

type staticCacheWriter struct {
	http.ResponseWriter
	policy string
	wrote  bool
}

func (w *staticCacheWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.wrote = true
	// A missing asset, redirect or server error must never inherit the year-long
	// lifetime of the requested filename. API responses retain middleware no-store.
	policy := "no-store"
	if status == http.StatusOK || status == http.StatusPartialContent || status == http.StatusNotModified {
		policy = w.policy
	}
	w.Header().Set("Cache-Control", policy)
	w.ResponseWriter.WriteHeader(status)
}

func (w *staticCacheWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}
