-- Simulation state is separate from player-owned building configuration.
ALTER TABLE factories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
CREATE TABLE factory_simulations (
    factory_id TEXT NOT NULL PRIMARY KEY REFERENCES factories(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(json_valid(state) AND json_type(state) = 'object')
);
CREATE TABLE player_warehouses (
    owner_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    items TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(items) AND json_type(items) = 'object')
);
