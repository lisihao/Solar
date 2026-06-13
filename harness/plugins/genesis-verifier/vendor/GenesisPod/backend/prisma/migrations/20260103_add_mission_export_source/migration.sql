-- CreateEnum ExportSourceType if not exists, then add MISSION value
DO $$
BEGIN
    -- Check if enum type exists
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportSourceType') THEN
        -- Create the enum with all values including MISSION
        CREATE TYPE "ExportSourceType" AS ENUM ('DOCUMENT', 'RESEARCH', 'REPORT', 'RAW', 'MISSION');
    ELSE
        -- Enum exists, just add MISSION if not present
        BEGIN
            ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'MISSION';
        EXCEPTION WHEN duplicate_object THEN
            -- Value already exists, ignore
            NULL;
        END;
    END IF;
END
$$;
