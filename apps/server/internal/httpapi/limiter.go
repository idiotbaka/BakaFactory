package httpapi

import (
	"sync"
	"time"
)

type attemptWindow struct {
	count int
	until time.Time
}
type authLimiter struct {
	mu        sync.Mutex
	entries   map[string]attemptWindow
	now       func() time.Time
	lastSweep time.Time
}

func newAuthLimiter() *authLimiter {
	return &authLimiter{entries: make(map[string]attemptWindow), now: time.Now}
}
func (l *authLimiter) allow(key string, maximum int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.lastSweep) >= time.Minute {
		for key, entry := range l.entries {
			if !now.Before(entry.until) {
				delete(l.entries, key)
			}
		}
		l.lastSweep = now
	}
	entry, exists := l.entries[key]
	if !exists || !now.Before(entry.until) {
		if !exists && len(l.entries) >= 10000 {
			return false
		}
		entry = attemptWindow{until: now.Add(15 * time.Minute)}
	}
	if entry.count >= maximum {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}
