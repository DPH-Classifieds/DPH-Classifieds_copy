-- Add country_code field to all tables that store phone numbers

-- Cars table
ALTER TABLE public.cars 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Bikes table  
ALTER TABLE public.bikes 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- License plates table
ALTER TABLE public.license_plates 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Car parts table
ALTER TABLE public.car_parts 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Update existing records to have the default UAE country code
UPDATE public.cars SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.bikes SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.license_plates SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.car_parts SET country_code = '+971' WHERE country_code IS NULL;

-- Add comments
COMMENT ON COLUMN public.cars.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.bikes.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.license_plates.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.car_parts.country_code IS 'Phone number country code (e.g., +971 for UAE)';

