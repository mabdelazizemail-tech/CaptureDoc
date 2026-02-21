
-- ... (Existing content remains, append this at the end) ...

-- 11. ASSET TAG GENERATION RPC (Single)
CREATE OR REPLACE FUNCTION generate_next_asset_tag(year_prefix text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  last_tag text;
  next_num integer;
BEGIN
  SELECT asset_tag INTO last_tag
  FROM assets
  WHERE asset_tag LIKE 'CD' || year_prefix || '-%'
  ORDER BY asset_tag DESC
  LIMIT 1;

  IF last_tag IS NULL THEN
    next_num := 1;
  ELSE
    BEGIN
        next_num := CAST(SUBSTRING(last_tag FROM 8) AS INTEGER) + 1;
    EXCEPTION WHEN OTHERS THEN
        next_num := 1;
    END;
  END IF;

  RETURN 'CD' || year_prefix || '-' || LPAD(next_num::text, 5, '0');
END;
$$;

-- Ensure current_counter column exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'current_counter') THEN
        ALTER TABLE assets ADD COLUMN current_counter INTEGER DEFAULT 0;
    END IF;
END $$;

-- 12. BULK ASSET REGISTRATION RPC
-- Handles batch insertion with atomic auto-tagging
CREATE OR REPLACE FUNCTION register_assets_bulk(
    assets_data jsonb,
    year_prefix text,
    project_id_input uuid,
    user_id_input uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    last_tag text;
    next_num integer;
    asset_record jsonb;
    new_assets jsonb := '[]'::jsonb;
    inserted_record record;
    current_tag text;
BEGIN
    -- Lock table to prevent race conditions on ID generation during this transaction
    LOCK TABLE assets IN SHARE ROW EXCLUSIVE MODE;

    -- Find the highest tag that matches the pattern 'CD' + year_prefix + '-'
    SELECT asset_tag INTO last_tag
    FROM assets
    WHERE asset_tag LIKE 'CD' || year_prefix || '-%'
    ORDER BY asset_tag DESC
    LIMIT 1;

    -- Determine starting number
    IF last_tag IS NULL THEN
        next_num := 1;
    ELSE
        BEGIN
            next_num := CAST(SUBSTRING(last_tag FROM 8) AS INTEGER) + 1;
        EXCEPTION WHEN OTHERS THEN
            next_num := 1;
        END;
    END IF;

    -- Iterate through the JSON array
    FOR asset_record IN SELECT * FROM jsonb_array_elements(assets_data)
    LOOP
        -- Generate Tag
        current_tag := 'CD' || year_prefix || '-' || LPAD(next_num::text, 5, '0');
        
        -- Insert Record
        INSERT INTO assets (
            asset_tag,
            name,
            type,
            serial_number,
            location,
            project_id,
            assigned_user,
            status,
            purchase_date,
            cost,
            cpu,
            ram,
            storage,
            last_maintenance_date,
            audited_by,
            last_audit_date,
            current_counter
        ) VALUES (
            current_tag,
            asset_record->>'name',
            COALESCE(asset_record->>'type', 'Other'),
            COALESCE(asset_record->>'serialNumber', ''),
            '', -- Physical location removed from bulk input, defaulting to empty
            project_id_input,
            NULL, -- assigned_user (optional in bulk)
            COALESCE(asset_record->>'status', 'in_storage'), -- FIXED: Use status from payload
            COALESCE((asset_record->>'purchaseDate')::date, CURRENT_DATE),
            COALESCE((asset_record->>'cost')::numeric, 0),
            asset_record->>'cpu',
            asset_record->>'ram',
            asset_record->>'storage',
            CURRENT_DATE,
            user_id_input, -- The uploader validates it immediately
            CURRENT_TIMESTAMP,
            COALESCE((asset_record->>'currentCounter')::integer, 0)
        )
        RETURNING id, asset_tag, name, serial_number, location, type, status
        INTO inserted_record;

        -- Append to result array
        new_assets := new_assets || row_to_json(inserted_record)::jsonb;

        -- Increment counter
        next_num := next_num + 1;
    END LOOP;

    RETURN new_assets;
END;
$$;
