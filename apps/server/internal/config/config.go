package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	Environment  string
	Address      string
	DatabasePath string
	Version      string
	LogLevel     slog.Level
	WebDir       string
	SessionTTL   time.Duration
	Origins      []string
}

func Load() (Config, error) { return LoadFrom(os.LookupEnv) }

func LoadFrom(lookup func(string) (string, bool)) (Config, error) {
	get := func(key, fallback string) string {
		if value, ok := lookup(key); ok {
			return value
		}
		return fallback
	}
	c := Config{Environment: get("APP_ENV", "local"), Address: get("HTTP_ADDR", "127.0.0.1:8080"), Version: get("APP_VERSION", "0.1.0"), WebDir: get("WEB_DIST_DIR", "")}
	switch c.Environment {
	case "local", "test", "production":
	default:
		return c, fmt.Errorf("APP_ENV must be local, test or production")
	}
	c.DatabasePath = get("DATABASE_PATH", "./data/bakafactory."+c.Environment+".db")
	if c.DatabasePath == "" || c.Version == "" {
		return c, fmt.Errorf("DATABASE_PATH and APP_VERSION must not be empty")
	}
	if _, _, err := net.SplitHostPort(c.Address); err != nil {
		return c, fmt.Errorf("invalid HTTP_ADDR: %w", err)
	}
	if err := c.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("invalid LOG_LEVEL: %w", err)
	}
	var err error
	c.SessionTTL, err = time.ParseDuration(get("SESSION_TTL", "168h"))
	if err != nil || c.SessionTTL < time.Hour || c.SessionTTL > 30*24*time.Hour {
		return c, fmt.Errorf("SESSION_TTL must be between 1h and 720h")
	}
	for _, origin := range strings.Split(get("APP_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080"), ",") {
		origin = strings.TrimSpace(origin)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return c, fmt.Errorf("APP_ORIGINS must contain explicit http(s) origins without paths")
		}
		c.Origins = append(c.Origins, origin)
	}
	return c, nil
}
