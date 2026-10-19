package application

import (
	"bakafactory/server/internal/domain"
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type FactoryRepository interface {
	List(context.Context, string) ([]domain.Factory, error)
	Get(context.Context, string, string) (domain.FactoryDetail, error)
	Create(context.Context, domain.Factory) (domain.FactoryDetail, error)
	Place(context.Context, string, string, domain.BuildingInstance) (domain.FactoryDetail, error)
	UpdateBuilding(context.Context, string, string, string, domain.BuildingPlacement) (domain.FactoryDetail, error)
	DeleteBuilding(context.Context, string, string, string) (domain.FactoryDetail, error)
}
type FactoryService struct {
	repository  FactoryRepository
	definitions domain.Catalog
}

func NewFactoryService(repo FactoryRepository, definitions domain.Catalog) *FactoryService {
	return &FactoryService{repository: repo, definitions: definitions}
}
func (s *FactoryService) Catalog() domain.Catalog { return s.definitions }
func (s *FactoryService) List(ctx context.Context, owner string) ([]domain.Factory, error) {
	return s.repository.List(ctx, owner)
}
func (s *FactoryService) Get(ctx context.Context, owner, id string) (domain.FactoryDetail, error) {
	return s.repository.Get(ctx, owner, id)
}
func (s *FactoryService) Create(ctx context.Context, owner, name string) (domain.FactoryDetail, error) {
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 32 {
		return domain.FactoryDetail{}, fmt.Errorf("%w: 工厂名称需为 1～32 个字符", domain.ErrValidation)
	}
	for _, c := range name {
		if unicode.IsControl(c) {
			return domain.FactoryDetail{}, fmt.Errorf("%w: 工厂名称不能包含控制字符", domain.ErrValidation)
		}
	}
	f := domain.Factory{ID: randomToken(), OwnerID: owner, Name: name, Width: domain.InitialFactorySize, Height: domain.InitialFactorySize, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	return s.repository.Create(ctx, f)
}

func (s *FactoryService) Place(ctx context.Context, owner, factoryID, buildingType string, p domain.BuildingPlacement) (domain.FactoryDetail, error) {
	if err := p.Validate(); err != nil {
		return domain.FactoryDetail{}, err
	}
	var definition *domain.BuildingDefinition
	for i := range s.definitions.Buildings {
		if s.definitions.Buildings[i].ID == buildingType {
			definition = &s.definitions.Buildings[i]
			break
		}
	}
	if definition == nil {
		return domain.FactoryDetail{}, fmt.Errorf("%w: 建筑类型不存在", domain.ErrValidation)
	}
	if definition.Fixed {
		return domain.FactoryDetail{}, domain.ErrBuildingFixed
	}
	instance := domain.BuildingInstance{ID: randomToken(), FactoryID: factoryID, BuildingType: buildingType, X: p.X, Y: p.Y, Rotation: p.Rotation, Configuration: []byte(`{}`)}
	return s.repository.Place(ctx, owner, factoryID, instance)
}
func (s *FactoryService) UpdateBuilding(ctx context.Context, owner, factoryID, buildingID string, p domain.BuildingPlacement) (domain.FactoryDetail, error) {
	if err := p.Validate(); err != nil {
		return domain.FactoryDetail{}, err
	}
	return s.repository.UpdateBuilding(ctx, owner, factoryID, buildingID, p)
}
func (s *FactoryService) DeleteBuilding(ctx context.Context, owner, factoryID, buildingID string) (domain.FactoryDetail, error) {
	return s.repository.DeleteBuilding(ctx, owner, factoryID, buildingID)
}
