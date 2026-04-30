-- One-time backfill for existing listings so the WhatsApp pre-text includes
-- the specific listing URL for current rows.
--
-- This preserves any custom text that already exists and only appends the
-- listing link when it is missing.

DO $$
DECLARE
  site_url CONSTANT text := 'https://dphclassifieds.com';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cars'
      AND column_name = 'whatsapp_prefill_text'
  ) THEN
    UPDATE public.cars
    SET whatsapp_prefill_text = CASE
      WHEN whatsapp_prefill_text IS NULL OR btrim(whatsapp_prefill_text) = '' THEN
        'Hi, I saw your car on dphclassifieds.com and I am interested. Listing: ' || site_url || '/cars/' || id::text
      WHEN whatsapp_prefill_text ILIKE '%' || site_url || '/cars/' || id::text || '%' THEN
        whatsapp_prefill_text
      ELSE
        btrim(whatsapp_prefill_text) || E'\n\nListing: ' || site_url || '/cars/' || id::text
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bikes'
      AND column_name = 'whatsapp_prefill_text'
  ) THEN
    UPDATE public.bikes
    SET whatsapp_prefill_text = CASE
      WHEN whatsapp_prefill_text IS NULL OR btrim(whatsapp_prefill_text) = '' THEN
        'Hi, I saw your bike on dphclassifieds.com and I am interested. Listing: ' || site_url || '/bikes/' || id::text
      WHEN whatsapp_prefill_text ILIKE '%' || site_url || '/bikes/' || id::text || '%' THEN
        whatsapp_prefill_text
      ELSE
        btrim(whatsapp_prefill_text) || E'\n\nListing: ' || site_url || '/bikes/' || id::text
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'license_plates'
      AND column_name = 'whatsapp_prefill_text'
  ) THEN
    UPDATE public.license_plates
    SET whatsapp_prefill_text = CASE
      WHEN whatsapp_prefill_text IS NULL OR btrim(whatsapp_prefill_text) = '' THEN
        'Hi, I saw your plate on dphclassifieds.com and I am interested. Listing: ' || site_url || '/plates/' || id::text
      WHEN whatsapp_prefill_text ILIKE '%' || site_url || '/plates/' || id::text || '%' THEN
        whatsapp_prefill_text
      ELSE
        btrim(whatsapp_prefill_text) || E'\n\nListing: ' || site_url || '/plates/' || id::text
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'car_parts'
      AND column_name = 'whatsapp_prefill_text'
  ) THEN
    UPDATE public.car_parts
    SET whatsapp_prefill_text = CASE
      WHEN whatsapp_prefill_text IS NULL OR btrim(whatsapp_prefill_text) = '' THEN
        'Hi, I saw your part on dphclassifieds.com and I am interested. Listing: ' || site_url || '/car-parts/' || id::text
      WHEN whatsapp_prefill_text ILIKE '%' || site_url || '/car-parts/' || id::text || '%' THEN
        whatsapp_prefill_text
      ELSE
        btrim(whatsapp_prefill_text) || E'\n\nListing: ' || site_url || '/car-parts/' || id::text
    END;
  END IF;
END
$$;
