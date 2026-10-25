package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStaticCachePolicy(t *testing.T) {
	dir := t.TempDir()
	modified := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	for _, name := range []string{
		"index.html", "favicon.svg", "assets/plain.png", "assets/i0032-CGNlxRRo.png",
		"assets/index-Abcd_1-2.js", "assets/index-Abcd_1-2.css", "assets/simulation.worker-Abcd_1-2.js",
		"fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v2026.10.16.woff2",
		"fonts/fusion-pixel/manifest.json", "fonts/fusion-pixel/OFL.txt",
	} {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("static fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, modified, modified); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "assets", "folder-Abcd1234.png"), 0700); err != nil {
		t.Fatal(err)
	}
	h := handler(t, failingRepository{}, dir)
	const immutable = "public, max-age=31536000, immutable"
	for _, tc := range []struct {
		name, method, path, header, value, policy string
		status                                    int
	}{
		{name: "entry", path: "/", policy: "no-cache", status: 200},
		{name: "entry redirect", path: "/index.html", policy: "no-store", status: 301},
		{name: "favicon", path: "/favicon.svg", policy: "no-cache", status: 200},
		{name: "unhashed image", path: "/assets/plain.png", policy: "no-cache", status: 200},
		{name: "image", path: "/assets/i0032-CGNlxRRo.png", policy: immutable, status: 200},
		{name: "script", path: "/assets/index-Abcd_1-2.js", policy: immutable, status: 200},
		{name: "style", path: "/assets/index-Abcd_1-2.css", policy: immutable, status: 200},
		{name: "worker", path: "/assets/simulation.worker-Abcd_1-2.js", policy: immutable, status: 200},
		{name: "font", path: "/fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v2026.10.16.woff2", policy: immutable, status: 200},
		{name: "font manifest", path: "/fonts/fusion-pixel/manifest.json", policy: "no-cache", status: 200},
		{name: "font license", path: "/fonts/fusion-pixel/OFL.txt", policy: "no-cache", status: 200},
		{name: "head", method: "HEAD", path: "/assets/i0032-CGNlxRRo.png", policy: immutable, status: 200},
		{name: "query", path: "/assets/i0032-CGNlxRRo.png?v=1", policy: immutable, status: 200},
		{name: "range", path: "/assets/i0032-CGNlxRRo.png", header: "Range", value: "bytes=0-3", policy: immutable, status: 206},
		{name: "image validation", path: "/assets/i0032-CGNlxRRo.png", header: "If-Modified-Since", value: modified.Format(http.TimeFormat), policy: immutable, status: 304},
		{name: "entry validation", path: "/", header: "If-Modified-Since", value: modified.Format(http.TimeFormat), policy: "no-cache", status: 304},
		{name: "invalid range", path: "/assets/i0032-CGNlxRRo.png", header: "Range", value: "bytes=100-200", policy: "no-store", status: 416},
		{name: "missing image", path: "/assets/missing-Abcd1234.png", policy: "no-store", status: 404},
		{name: "missing font", path: "/fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v2099.01.01.woff2", policy: "no-store", status: 404},
		{name: "directory redirect", path: "/assets/folder-Abcd1234.png", policy: "no-store", status: 301},
		{name: "API error", path: "/api/v1/unknown", policy: "no-store", status: 404},
		{name: "API resembling asset", path: "/api/v1/private-Abcd1234.js", policy: "no-store", status: 404},
		{name: "API post", method: "POST", path: "/api/v1/unknown", policy: "no-store", status: 404},
		{name: "static post", method: "POST", path: "/assets/i0032-CGNlxRRo.png", policy: "no-store", status: 404},
		{name: "health error", path: "/health", policy: "no-store", status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			method := tc.method
			if method == "" {
				method = http.MethodGet
			}
			r := httptest.NewRequest(method, tc.path, nil)
			if tc.header != "" {
				r.Header.Set(tc.header, tc.value)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status || w.Header().Get("Cache-Control") != tc.policy {
				t.Fatalf("got status=%d cache=%q, want status=%d cache=%q", w.Code, w.Header().Get("Cache-Control"), tc.status, tc.policy)
			}
			if len(w.Header().Values("Cache-Control")) != 1 {
				t.Fatal("cache policy must replace middleware no-store, not append to it")
			}
			if w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("X-Request-ID") == "" {
				t.Fatal("static caching must preserve common response headers")
			}
			if (method == http.MethodHead || tc.status == http.StatusNotModified) && w.Body.Len() != 0 {
				t.Fatal("HEAD and 304 responses must have no body")
			}
		})
	}
}
