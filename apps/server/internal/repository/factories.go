package repository

import (
	"bakafactory/server/internal/domain"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"modernc.org/sqlite"
)

type Factories struct{ db *sql.DB }

func NewFactories(db *sql.DB) *Factories { return &Factories{db: db} }
func (r *Factories) List(ctx context.Context, owner string) ([]domain.Factory, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT id,owner_id,name,width,height,created_at,revision FROM factories WHERE owner_id=? ORDER BY created_at,id", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Factory{}
	for rows.Next() {
		var f domain.Factory
		if err := rows.Scan(&f.ID, &f.OwnerID, &f.Name, &f.Width, &f.Height, &f.CreatedAt, &f.Revision); err != nil {
			return nil, err
		}
		result = append(result, f)
	}
	return result, rows.Err()
}
func (r *Factories) Get(ctx context.Context, owner, id string) (domain.FactoryDetail, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return domain.FactoryDetail{}, err
	}
	defer tx.Rollback()
	f, err := readFactory(ctx, tx, owner, id)
	if err != nil {
		return f, err
	}
	return f, tx.Commit()
}

type factoryQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readFactory(ctx context.Context, q factoryQuery, owner, id string) (domain.FactoryDetail, error) {
	f := domain.FactoryDetail{Buildings: []domain.BuildingInstance{}}
	err := q.QueryRowContext(ctx, "SELECT id,owner_id,name,width,height,created_at,revision FROM factories WHERE id=? AND owner_id=?", id, owner).Scan(&f.ID, &f.OwnerID, &f.Name, &f.Width, &f.Height, &f.CreatedAt, &f.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return f, domain.ErrFactoryNotFound
	}
	if err != nil {
		return f, err
	}
	rows, err := q.QueryContext(ctx, "SELECT id,factory_id,building_type,x,y,rotation,configuration FROM building_instances WHERE factory_id=? ORDER BY y,x,id", id)
	if err != nil {
		return f, err
	}
	defer rows.Close()
	for rows.Next() {
		var b domain.BuildingInstance
		var configuration string
		if err := rows.Scan(&b.ID, &b.FactoryID, &b.BuildingType, &b.X, &b.Y, &b.Rotation, &configuration); err != nil {
			return f, err
		}
		b.Configuration = []byte(configuration)
		f.Buildings = append(f.Buildings, b)
	}
	if err := rows.Err(); err != nil {
		return f, err
	}
	if err := rows.Close(); err != nil {
		return f, err
	}
	f.Simulation, err = readSimulation(ctx, q, owner, id, f.Buildings)
	return f, err
}

func (r *Factories) mutate(ctx context.Context, owner, factoryID string, change func(*sql.Tx, domain.Factory) error) (domain.FactoryDetail, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.FactoryDetail{}, err
	}
	defer tx.Rollback()
	var f domain.Factory
	err = tx.QueryRowContext(ctx, "SELECT id,width,height FROM factories WHERE id=? AND owner_id=?", factoryID, owner).Scan(&f.ID, &f.Width, &f.Height)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.FactoryDetail{}, domain.ErrFactoryNotFound
	}
	if err != nil {
		return domain.FactoryDetail{}, err
	}
	if err := change(tx, f); err != nil {
		return domain.FactoryDetail{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE factories SET revision=revision+1 WHERE id=?", factoryID); err != nil {
		return domain.FactoryDetail{}, err
	}
	result, err := readFactory(ctx, tx, owner, factoryID)
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}
func validateTile(ctx context.Context, tx *sql.Tx, f domain.Factory, p domain.BuildingPlacement, excludedID string) error {
	if !f.Contains(p) {
		return fmt.Errorf("%w: 坐标超出工厂边界", domain.ErrValidation)
	}
	var id string
	err := tx.QueryRowContext(ctx, "SELECT id FROM building_instances WHERE factory_id=? AND x=? AND y=? AND id<>?", f.ID, p.X, p.Y, excludedID).Scan(&id)
	if err == nil {
		return domain.ErrTileOccupied
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}
func editableBuilding(ctx context.Context, tx *sql.Tx, factoryID, buildingID string) error {
	var kind string
	err := tx.QueryRowContext(ctx, "SELECT building_type FROM building_instances WHERE factory_id=? AND id=?", factoryID, buildingID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrBuildingNotFound
	}
	if err != nil {
		return err
	}
	if kind == "bus" {
		return domain.ErrBuildingFixed
	}
	return nil
}
func (r *Factories) Place(ctx context.Context, owner, factoryID string, b domain.BuildingInstance) (domain.FactoryDetail, error) {
	return r.mutate(ctx, owner, factoryID, func(tx *sql.Tx, f domain.Factory) error {
		if b.BuildingType == "bus" {
			return domain.ErrBuildingFixed
		}
		p := domain.BuildingPlacement{X: b.X, Y: b.Y, Rotation: b.Rotation}
		if err := p.Validate(); err != nil {
			return err
		}
		if err := validateTile(ctx, tx, f, p, ""); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO building_instances(id,factory_id,building_type,x,y,rotation,configuration) VALUES(?,?,?,?,?,?,?)", b.ID, factoryID, b.BuildingType, b.X, b.Y, b.Rotation, string(b.Configuration))
		return err
	})
}
func (r *Factories) UpdateBuilding(ctx context.Context, owner, factoryID, buildingID string, p domain.BuildingPlacement) (domain.FactoryDetail, error) {
	return r.mutate(ctx, owner, factoryID, func(tx *sql.Tx, f domain.Factory) error {
		if err := editableBuilding(ctx, tx, factoryID, buildingID); err != nil {
			return err
		}
		if err := p.Validate(); err != nil {
			return err
		}
		if err := validateTile(ctx, tx, f, p, buildingID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE building_instances SET x=?,y=?,rotation=? WHERE factory_id=? AND id=?", p.X, p.Y, p.Rotation, factoryID, buildingID)
		return err
	})
}
func (r *Factories) DeleteBuilding(ctx context.Context, owner, factoryID, buildingID string) (domain.FactoryDetail, error) {
	return r.mutate(ctx, owner, factoryID, func(tx *sql.Tx, f domain.Factory) error {
		if err := editableBuilding(ctx, tx, factoryID, buildingID); err != nil {
			return err
		}
		// Reclaim inventory atomically, including an in-flight conveyor payload.
		before, err := readFactory(ctx, tx, owner, factoryID)
		if err != nil {
			return err
		}
		if err := reclaimBuilding(&before.Simulation, buildingID); err != nil {
			return err
		}
		if err := saveWarehouse(ctx, tx, owner, before.Simulation.Warehouse); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM building_instances WHERE factory_id=? AND id=?", factoryID, buildingID)
		return err
	})
}
func (r *Factories) Create(ctx context.Context, f domain.Factory) (domain.FactoryDetail, error) {
	// SQLite's AFTER INSERT trigger creates the center Bus in the same atomic statement.
	_, err := r.db.ExecContext(ctx, "INSERT INTO factories(id,owner_id,name,width,height,created_at) VALUES(?,?,?,?,?,?)", f.ID, f.OwnerID, f.Name, f.Width, f.Height, f.CreatedAt)
	if err != nil {
		var sqliteErr *sqlite.Error
		if errors.As(err, &sqliteErr) && sqliteErr.Code() == 2067 {
			return domain.FactoryDetail{}, domain.ErrFactoryLimit
		}
		return domain.FactoryDetail{}, err
	}
	return r.Get(ctx, f.OwnerID, f.ID)
}
