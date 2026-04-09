-- Listing lifecycle: 30 days live, 30-day seller grace period after expiry.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.cars
SET
  expires_at = COALESCE(expires_at, created_at + INTERVAL '30 days'),
  retention_expires_at = COALESCE(retention_expires_at, created_at + INTERVAL '60 days'),
  expired_at = CASE
    WHEN expired_at IS NOT NULL THEN expired_at
    WHEN NOW() >= COALESCE(expires_at, created_at + INTERVAL '30 days') THEN COALESCE(expires_at, created_at + INTERVAL '30 days')
    ELSE NULL
  END,
  is_archived = CASE
    WHEN is_archived THEN TRUE
    WHEN NOW() >= COALESCE(retention_expires_at, created_at + INTERVAL '60 days') THEN TRUE
    ELSE FALSE
  END;

UPDATE public.bikes
SET
  expires_at = COALESCE(expires_at, created_at + INTERVAL '30 days'),
  retention_expires_at = COALESCE(retention_expires_at, created_at + INTERVAL '60 days'),
  expired_at = CASE
    WHEN expired_at IS NOT NULL THEN expired_at
    WHEN NOW() >= COALESCE(expires_at, created_at + INTERVAL '30 days') THEN COALESCE(expires_at, created_at + INTERVAL '30 days')
    ELSE NULL
  END,
  is_archived = CASE
    WHEN is_archived THEN TRUE
    WHEN NOW() >= COALESCE(retention_expires_at, created_at + INTERVAL '60 days') THEN TRUE
    ELSE FALSE
  END;

UPDATE public.car_parts
SET
  expires_at = COALESCE(expires_at, created_at + INTERVAL '30 days'),
  retention_expires_at = COALESCE(retention_expires_at, created_at + INTERVAL '60 days'),
  expired_at = CASE
    WHEN expired_at IS NOT NULL THEN expired_at
    WHEN NOW() >= COALESCE(expires_at, created_at + INTERVAL '30 days') THEN COALESCE(expires_at, created_at + INTERVAL '30 days')
    ELSE NULL
  END,
  is_archived = CASE
    WHEN is_archived THEN TRUE
    WHEN NOW() >= COALESCE(retention_expires_at, created_at + INTERVAL '60 days') THEN TRUE
    ELSE FALSE
  END;

UPDATE public.license_plates
SET
  expires_at = COALESCE(expires_at, created_at + INTERVAL '30 days'),
  retention_expires_at = COALESCE(retention_expires_at, created_at + INTERVAL '60 days'),
  expired_at = CASE
    WHEN expired_at IS NOT NULL THEN expired_at
    WHEN NOW() >= COALESCE(expires_at, created_at + INTERVAL '30 days') THEN COALESCE(expires_at, created_at + INTERVAL '30 days')
    ELSE NULL
  END,
  is_archived = CASE
    WHEN is_archived THEN TRUE
    WHEN NOW() >= COALESCE(retention_expires_at, created_at + INTERVAL '60 days') THEN TRUE
    ELSE FALSE
  END;

CREATE INDEX IF NOT EXISTS idx_cars_lifecycle ON public.cars (status, is_archived, expires_at, retention_expires_at);
CREATE INDEX IF NOT EXISTS idx_bikes_lifecycle ON public.bikes (status, is_archived, expires_at, retention_expires_at);
CREATE INDEX IF NOT EXISTS idx_car_parts_lifecycle ON public.car_parts (status, is_archived, expires_at, retention_expires_at);
CREATE INDEX IF NOT EXISTS idx_license_plates_lifecycle ON public.license_plates (status, is_archived, expires_at, retention_expires_at);
