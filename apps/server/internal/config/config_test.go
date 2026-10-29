package config

import (
	"testing"
	"time"
)

func TestEnvironmentIsolation(t *testing.T) {
	for _, env := range []string{"local", "test", "production"} {
		t.Run(env, func(t *testing.T) {
			c, err := LoadFrom(func(key string) (string, bool) {
				if key == "APP_ENV" {
					return env, true
				}
				return "", false
			})
			if err != nil {
				t.Fatal(err)
			}
			if c.DatabasePath != "./data/bakafactory."+env+".db" {
				t.Fatalf("wrong database: %s", c.DatabasePath)
			}
			if c.SessionTTL != 30*24*time.Hour {
				t.Fatalf("default session lifetime must be 30 days: %s", c.SessionTTL)
			}
		})
	}
}

func TestSessionLifetimeOverride(t *testing.T) {
	c, err := LoadFrom(func(key string) (string, bool) {
		return "24h", key == "SESSION_TTL"
	})
	if err != nil || c.SessionTTL != 24*time.Hour {
		t.Fatalf("explicit session lifetime ignored: %s (%v)", c.SessionTTL, err)
	}
}
func TestInvalidConfiguration(t *testing.T) {
	for key, value := range map[string]string{"APP_ENV": "staging", "DATABASE_PATH": "", "APP_VERSION": "", "HTTP_ADDR": "broken", "LOG_LEVEL": "invalid", "SESSION_TTL": "0h", "APP_ORIGINS": "https://example.com/path"} {
		t.Run(key, func(t *testing.T) {
			_, err := LoadFrom(func(k string) (string, bool) {
				if k == key {
					return value, true
				}
				return "", false
			})
			if err == nil {
				t.Fatal("expected validation failure")
			}
		})
	}
}
