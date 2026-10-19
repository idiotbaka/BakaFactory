package application

import (
	"bakafactory/server/internal/domain"
	"context"
)

type HealthRepository interface{ Check(context.Context) error }

type HealthService struct {
	repository           HealthRepository
	version, environment string
}

func NewHealthService(repository HealthRepository, version, environment string) *HealthService {
	return &HealthService{repository: repository, version: version, environment: environment}
}

func (s *HealthService) Check(ctx context.Context) (domain.Health, error) {
	h := domain.Health{Status: "ok", Version: s.version, Environment: s.environment, Database: "ok"}
	if err := s.repository.Check(ctx); err != nil {
		h.Status = "degraded"
		h.Database = "unavailable"
		return h, err
	}
	return h, nil
}
