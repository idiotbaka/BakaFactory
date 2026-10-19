CREATE TABLE factories (
    id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 32),
    width INTEGER NOT NULL CHECK(width > 0 AND width % 2 = 1),
    height INTEGER NOT NULL CHECK(height > 0 AND height % 2 = 1),
    created_at TEXT NOT NULL
);

CREATE TABLE building_instances (
    id TEXT NOT NULL PRIMARY KEY,
    factory_id TEXT NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    building_type TEXT NOT NULL,
    x INTEGER NOT NULL CHECK(typeof(x) = 'integer'),
    y INTEGER NOT NULL CHECK(typeof(y) = 'integer'),
    rotation INTEGER NOT NULL DEFAULT 0 CHECK(rotation IN (0,90,180,270)),
    configuration TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(configuration) AND json_type(configuration) = 'object'),
    UNIQUE(factory_id, x, y),
    CHECK(building_type <> 'bus' OR (x = 0 AND y = 0 AND rotation = 0)),
    CHECK(building_type = 'bus' OR x <> 0 OR y <> 0)
);
CREATE UNIQUE INDEX one_bus_per_factory ON building_instances(factory_id) WHERE building_type = 'bus';

CREATE TRIGGER protect_bus_replace BEFORE INSERT ON building_instances
WHEN EXISTS(SELECT 1 FROM building_instances WHERE building_type = 'bus' AND (
    id = NEW.id OR (factory_id = NEW.factory_id AND (NEW.building_type = 'bus' OR (NEW.x = 0 AND NEW.y = 0)))
))
BEGIN SELECT RAISE(ABORT,'central bus cannot be replaced'); END;

CREATE TRIGGER initialize_factory_bus AFTER INSERT ON factories
BEGIN
    INSERT INTO building_instances(id,factory_id,building_type,x,y,rotation,configuration)
    VALUES(lower(hex(randomblob(16))),NEW.id,'bus',0,0,0,'{}');
END;

CREATE TRIGGER protect_bus_update BEFORE UPDATE ON building_instances
WHEN OLD.building_type = 'bus' AND (
    NEW.id <> OLD.id OR NEW.factory_id <> OLD.factory_id OR NEW.building_type <> OLD.building_type
    OR NEW.x <> 0 OR NEW.y <> 0 OR NEW.rotation <> 0
)
BEGIN SELECT RAISE(ABORT,'central bus is immutable'); END;

CREATE TRIGGER protect_bus_delete BEFORE DELETE ON building_instances
WHEN OLD.building_type = 'bus' AND EXISTS(SELECT 1 FROM factories WHERE id = OLD.factory_id)
BEGIN SELECT RAISE(ABORT,'central bus cannot be deleted'); END;

CREATE TRIGGER building_bounds_insert BEFORE INSERT ON building_instances
WHEN NEW.x < -(SELECT width/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.x > (SELECT width/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.y < -(SELECT height/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.y > (SELECT height/2 FROM factories WHERE id = NEW.factory_id)
BEGIN SELECT RAISE(ABORT,'building outside factory'); END;

CREATE TRIGGER building_bounds_update BEFORE UPDATE ON building_instances
WHEN NEW.x < -(SELECT width/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.x > (SELECT width/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.y < -(SELECT height/2 FROM factories WHERE id = NEW.factory_id)
  OR NEW.y > (SELECT height/2 FROM factories WHERE id = NEW.factory_id)
BEGIN SELECT RAISE(ABORT,'building outside factory'); END;
