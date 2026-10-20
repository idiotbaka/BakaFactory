package application

import (
	"bakafactory/server/internal/domain"
	"context"
	"errors"
	"fmt"
	"time"
)

type SaveRepository interface {
	Get(context.Context, string, int64) (*domain.CloudSave, error)
	Put(context.Context, string, int64, string, int64, domain.GameSave) (*domain.CloudSave, error)
}
type SaveService struct {
	repository SaveRepository
	auth       *AuthService
	catalog    domain.Catalog
	now        func() time.Time
}

func NewSaveService(repo SaveRepository, auth *AuthService, c domain.Catalog) *SaveService {
	return &SaveService{repository: repo, auth: auth, catalog: c, now: time.Now}
}
func (s *SaveService) Catalog() domain.Catalog { return s.catalog }
func (s *SaveService) Session(ctx context.Context, token, expected string) (domain.User, string, error) {
	user, err := s.auth.Current(ctx, token)
	if err != nil {
		return domain.User{}, "", err
	}
	id := tokenHash(token)
	if expected != "" && expected != id {
		return domain.User{}, "", domain.ErrUnauthenticated
	}
	return user, id, nil
}
func (s *SaveService) Get(ctx context.Context, token, expected string) (*domain.CloudSave, error) {
	if expected == "" {
		return nil, domain.ErrUnauthenticated
	}
	_, id, err := s.Session(ctx, token, expected)
	if err != nil {
		return nil, err
	}
	return s.repository.Get(ctx, id, s.now().Unix())
}
func (s *SaveService) Put(ctx context.Context, token, expected string, base int64, save domain.GameSave) (*domain.CloudSave, error) {
	if expected == "" {
		return nil, domain.ErrUnauthenticated
	}
	user, id, err := s.Session(ctx, token, expected)
	if err != nil {
		return nil, err
	}
	if base < 0 || base > domain.MaxSafeInteger {
		return nil, fmt.Errorf("%w: 无效的云存档版本", domain.ErrValidation)
	}
	if err := save.Validate(user.ID, s.catalog); err != nil {
		return nil, err
	}
	result, err := s.repository.Put(ctx, id, s.now().Unix(), s.now().UTC().Format(time.RFC3339Nano), base, save)
	if errors.Is(err, domain.ErrSaveConflict) {
		return nil, domain.ErrSaveConflict
	}
	return result, err
}
