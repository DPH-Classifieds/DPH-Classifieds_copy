-- Migration: add user_dismissed_at to all listing tables
-- Lets an owner hide a deleted/auto-removed listing from their MyListings view
-- without affecting the deletion audit log or the retention sweep.
-- Run in Supabase SQL Editor.

ALTER TABLE cars
ADD COLUMN IF NOT EXISTS user_dismissed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE bikes
ADD COLUMN IF NOT EXISTS user_dismissed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE car_parts
ADD COLUMN IF NOT EXISTS user_dismissed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE license_plates
ADD COLUMN IF NOT EXISTS user_dismissed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_cars_user_dismissed_at
  ON cars (user_id, user_dismissed_at);
CREATE INDEX IF NOT EXISTS idx_bikes_user_dismissed_at
  ON bikes (user_id, user_dismissed_at);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_dismissed_at
  ON car_parts (user_id, user_dismissed_at);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_dismissed_at
  ON license_plates (user_id, user_dismissed_at);
