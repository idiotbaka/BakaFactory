package application

import (
	"bakafactory/server/internal/domain"
	"context"
	"log/slog"
	"time"
)

type SimulationRepository interface {
	AdvanceAll(context.Context, domain.Catalog) error
}

// RunSimulation owns the server clock; clients never advance game time.
// No wall-clock catch-up is applied after shutdown or when the loop is slow.
func RunSimulation(ctx context.Context, repo SimulationRepository, c domain.Catalog, logger *slog.Logger) {
	// Start the next interval after processing, so a slow tick cannot leave
	// a queued ticker event that executes immediately and shortens cooldowns.
	timer := time.NewTimer(time.Second / domain.TickRate)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			tick, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := repo.AdvanceAll(tick, c)
			cancel()
			if err != nil && ctx.Err() == nil {
				logger.Error("simulation tick failed", "error", err)
			}
			timer.Reset(time.Second / domain.TickRate)
		}
	}
}
