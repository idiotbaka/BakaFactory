-- Preserve items and conservatively convert the previous 10 TPS save format.
-- Work rounds down; cooldown rounds up, so upgrading never grants an item.
UPDATE factories SET revision = revision + 1
WHERE id IN (
    SELECT factory_id FROM factory_simulations
    WHERE json_extract(state, '$.tick_rate') = 10
);

UPDATE factory_simulations
SET state = json_set(
    state,
    '$.tick', CAST(COALESCE(json_extract(state, '$.tick'), 0) / 10 AS INTEGER),
    '$.tick_rate', 1,
    '$.buildings', json(COALESCE((
        SELECT json_group_object(machine.key, json(json_set(
            machine.value,
            '$.progress', CAST(COALESCE(json_extract(machine.value, '$.progress'), 0) / 10 AS INTEGER),
            '$.duration', CAST((COALESCE(json_extract(machine.value, '$.duration'), 0) + 9) / 10 AS INTEGER),
            '$.cooldown', CAST((COALESCE(json_extract(machine.value, '$.cooldown'), 0) + 9) / 10 AS INTEGER),
            '$.belt', json(CASE WHEN json_type(machine.value, '$.belt') = 'object'
                THEN json_set(
                    json_extract(machine.value, '$.belt'),
                    '$.progress', CAST(COALESCE(json_extract(machine.value, '$.belt.progress'), 0) / 10 AS INTEGER),
                    '$.id', 'legacy:' || machine.key
                )
                ELSE 'null'
            END)
        ))) FROM json_each(state, '$.buildings') AS machine
    ), '{}'))
)
WHERE json_extract(state, '$.tick_rate') = 10;
