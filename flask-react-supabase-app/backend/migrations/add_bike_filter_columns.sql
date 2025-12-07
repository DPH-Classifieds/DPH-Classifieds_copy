-- ============================================================
-- ADD BIKE FILTER COLUMNS MIGRATION
-- ============================================================
-- This migration adds missing columns to the bikes table
-- for enhanced filtering capabilities
-- ============================================================

-- Add cylinders column to bikes table
ALTER TABLE public.bikes 
ADD COLUMN IF NOT EXISTS cylinders INTEGER;

-- Add wheels column to bikes table (default to 2 for motorcycles)
ALTER TABLE public.bikes 
ADD COLUMN IF NOT EXISTS wheels INTEGER DEFAULT 2;

-- Add indexes for better filter performance on new columns only
CREATE INDEX IF NOT EXISTS idx_bikes_cylinders ON public.bikes(cylinders);
CREATE INDEX IF NOT EXISTS idx_bikes_wheels ON public.bikes(wheels);

-- Add helpful comments
COMMENT ON COLUMN public.bikes.cylinders IS 'Number of engine cylinders (1, 2, 3, 4, 6, etc.)';
COMMENT ON COLUMN public.bikes.wheels IS 'Number of wheels (typically 2 for motorcycles, 3 for trikes)';

-- Migration complete
-- ✅ Bike filter columns added successfully!
-- ✅ Added: cylinders, wheels
-- ✅ Created indexes for better performance
