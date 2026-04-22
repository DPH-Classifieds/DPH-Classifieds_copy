-- Add optional seller-defined WhatsApp prefilled message text to all listing types.
ALTER TABLE IF EXISTS cars
  ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT;

ALTER TABLE IF EXISTS bikes
  ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT;

ALTER TABLE IF EXISTS car_parts
  ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT;

ALTER TABLE IF EXISTS license_plates
  ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT;
