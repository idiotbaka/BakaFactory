package config

import "testing"

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
		})
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
