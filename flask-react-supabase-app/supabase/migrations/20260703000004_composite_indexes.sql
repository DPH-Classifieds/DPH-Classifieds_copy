-- Composite indexes for common multi-column filter patterns.
-- These make filtered listing queries significantly faster.
-- Safe to re-run: IF NOT EXISTS throughout.

-- Most common pattern: browse by status + sort by created_at
CREATE INDEX IF NOT EXISTS idx_cars_status_created
  ON public.cars (status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Filter by manufacturer within approved listings
CREATE INDEX IF NOT EXISTS idx_cars_status_manufacturer
  ON public.cars (status, car_manufacturer)
  WHERE deleted_at IS NULL;

-- Filter by city
CREATE INDEX IF NOT EXISTS idx_cars_status_city
  ON public.cars (status, car_city)
  WHERE deleted_at IS NULL;

-- Price range queries
CREATE INDEX IF NOT EXISTS idx_cars_status_price
  ON public.cars (status, expected_selling_price)
  WHERE deleted_at IS NULL;

-- Year range queries
CREATE INDEX IF NOT EXISTS idx_cars_status_year
  ON public.cars (status, make_year)
  WHERE deleted_at IS NULL;

-- Seller's own listings
CREATE INDEX IF NOT EXISTS idx_cars_user_status
  ON public.cars (user_id, status, created_at DESC);

-- Dealership listings
CREATE INDEX IF NOT EXISTS idx_cars_dealership_status
  ON public.cars (dealership_id, status)
  WHERE dealership_id IS NOT NULL;

-- Lifecycle: expiry sweep (worker queries)
CREATE INDEX IF NOT EXISTS idx_cars_expires_status
  ON public.cars (expires_at, status)
  WHERE deleted_at IS NULL AND status = 'approved';

-- car_parts same patterns
CREATE INDEX IF NOT EXISTS idx_car_parts_status_created
  ON public.car_parts (status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_car_parts_user_status
  ON public.car_parts (user_id, status, created_at DESC);

-- license_plates
CREATE INDEX IF NOT EXISTS idx_plates_status_created
  ON public.license_plates (status, created_at DESC)
  WHERE deleted_at IS NULL;

-- lead_events: analytics queries
CREATE INDEX IF NOT EXISTS idx_lead_events_listing
  ON public.lead_events (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_user
  ON public.lead_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- saved_listings: lookup by user
CREATE INDEX IF NOT EXISTS idx_saved_listings_user
  ON public.saved_listings (user_id, created_at DESC);

-- users: admin search by email
CREATE INDEX IF NOT EXISTS idx_users_email
  ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_created
  ON public.users (created_at DESC);
