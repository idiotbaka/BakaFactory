package repository

import (
	"bakafactory/server/internal/domain"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

func readSimulation(ctx context.Context, q factoryQuery, owner, id string, buildings []domain.BuildingInstance) (domain.Simulation, error) {
	var s domain.Simulation
	var raw string
	err := q.QueryRowContext(ctx, "SELECT state FROM factory_simulations WHERE factory_id=?", id).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return s, err
	}
	if err == nil {
		if err := json.Unmarshal([]byte(raw), &s); err != nil {
			return s, fmt.Errorf("decode simulation: %w", err)
		}
	}
	// The player warehouse is stored independently of factory state.
	s.Warehouse = map[string]int64{}
	err = q.QueryRowContext(ctx, "SELECT items FROM player_warehouses WHERE owner_id=?", owner).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return s, err
	}
	if err == nil {
		if err := json.Unmarshal([]byte(raw), &s.Warehouse); err != nil {
			return s, fmt.Errorf("decode warehouse: %w", err)
		}
	}
	s.Normalize(buildings)
	return s, nil
}
func saveWarehouse(ctx context.Context, tx *sql.Tx, owner string, items map[string]int64) error {
	raw, err := json.Marshal(items)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO player_warehouses(owner_id,items) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET items=excluded.items", owner, string(raw))
	return err
}
func reclaimBuilding(s *domain.Simulation, id string) error {
	m := s.Buildings[id]
	if m == nil {
		return nil
	}
	inventory := append(append(domain.Inventory{}, m.Input...), m.Output...)
	if m.Belt != nil {
		inventory = append(inventory, domain.Stack{Item: m.Belt.Item, Count: 1})
	}
	for _, stack := range inventory {
		if stack.Count <= 0 || s.Warehouse[stack.Item] > math.MaxInt64-stack.Count {
			return fmt.Errorf("%w: 仓库数量超出上限", domain.ErrValidation)
		}
		s.Warehouse[stack.Item] += stack.Count
	}
	delete(s.Buildings, id)
	return nil
}

// AdvanceAll commits each factory tick and its warehouse in one transaction.
// Existing edit transactions share the same SQLite connection, so ticks cannot
// overwrite an edit or duplicate an item reclaimed during demolition.
func (r *Factories) AdvanceAll(ctx context.Context, c domain.Catalog) error {
	rows, err := r.db.QueryContext(ctx, "SELECT id,owner_id FROM factories ORDER BY id")
	if err != nil {
		return err
	}
	type factoryOwner struct{ id, owner string }
	owners := []factoryOwner{}
	for rows.Next() {
		var f factoryOwner
		if err := rows.Scan(&f.id, &f.owner); err != nil {
			rows.Close()
			return err
		}
		owners = append(owners, f)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var failures []error
	for _, owner := range owners {
		if err := r.advance(ctx, owner.owner, owner.id, c); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
func (r *Factories) advance(ctx context.Context, owner, id string, c domain.Catalog) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	f, err := readFactory(ctx, tx, owner, id)
	if err != nil {
		return err
	}
	if err := f.Simulation.Validate(c); err != nil {
		return fmt.Errorf("factory %s: %w", id, err)
	}
	next := domain.Step(f, c)
	if err := next.Validate(c); err != nil {
		return fmt.Errorf("factory %s after tick: %w", id, err)
	}
	if err := saveWarehouse(ctx, tx, owner, next.Warehouse); err != nil {
		return err
	}
	// Warehouse is authoritative in player_warehouses, never duplicated in JSON.
	next.Warehouse = nil
	raw, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO factory_simulations(factory_id,state) VALUES(?,?) ON CONFLICT(factory_id) DO UPDATE SET state=excluded.state", id, string(raw)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE factories SET revision=revision+1 WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}
