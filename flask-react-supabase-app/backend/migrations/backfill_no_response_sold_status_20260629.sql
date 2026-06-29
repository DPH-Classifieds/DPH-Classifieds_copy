-- Backfill sold_status = 'no_response' for listings that were auto-removed
-- without the user ever explicitly choosing an outcome.
--
-- Before this fix the expiry worker defaulted sold_status to 'sold_elsewhere'
-- for any listing it auto-deleted. This inflated the "Sold elsewhere" count
-- with listings where the user simply went silent.
--
-- Heuristic: auto_removed_at IS NOT NULL means the system removed the listing
-- (not the user). If the user had responded before the deadline, auto_removed_at
-- would be NULL. This correctly reclassifies the silent-removal cases.
--
-- Idempotent: re-running is safe — rows already set to 'no_response' are
-- unaffected by the WHERE clause.

UPDATE public.cars
  SET sold_status = 'no_response'
  WHERE sold_status = 'sold_elsewhere'
    AND auto_removed_at IS NOT NULL;

UPDATE public.bikes
  SET sold_status = 'no_response'
  WHERE sold_status = 'sold_elsewhere'
    AND auto_removed_at IS NOT NULL;

UPDATE public.car_parts
  SET sold_status = 'no_response'
  WHERE sold_status = 'sold_elsewhere'
    AND auto_removed_at IS NOT NULL;

UPDATE public.license_plates
  SET sold_status = 'no_response'
  WHERE sold_status = 'sold_elsewhere'
    AND auto_removed_at IS NOT NULL;
