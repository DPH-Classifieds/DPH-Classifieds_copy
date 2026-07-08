# Listing Types

## Four types

| Type | DB table | Image table | Image FK | Form component |
|------|----------|-------------|----------|----------------|
| Cars | `cars` | `car_images` | `car_id` | `PostCar.js` |
| Bikes | `bikes` | `bike_images` | `bike_id` | `PostBike.js` |
| Parts | `car_parts` | `part_images` | `part_id` | `PostCarParts.js` |
| Plates | `license_plates` | `plate_images` | `plate_id` | `PostPlate.js` |

## Status values

| Status | Meaning |
|--------|---------|
| `draft` | User saved but not submitted |
| `pending` | Submitted, awaiting manual review |
| `pending_auto_review` | Submitted when auto-review is on; worker picks it up |
| `approved` | Live on platform |
| `rejected` | Rejected by admin, seller notified |
| `expired` | Listing past its expiry date |
| `sold_on_dph` | Marked sold via DPH |
| `sold_elsewhere` | Sold elsewhere, removed |
| `deleted` | Admin-deleted |
| `suspended` | Temporarily hidden |

> `listing_state` (computed view column) is NOT a writable DB column — never PATCH it directly. Use the `status` column.

## Auto-review columns (all listing tables)

- `auto_review_state` — `auto_approved` | `auto_queued` | null
- `auto_review_reasons` — `text[]`, NOT NULL (default `{}`)
- `auto_review_decided_at` — timestamp

## Cars-specific fields

- `car_manufacturer`, `car_model`, `make_year`
- `vin_number` — **required** in the form (HTML `required` attr)
- `car_description`
- Extras: `color`, `mileage`, `fuel_type`, `transmission`, etc.

## Bikes-specific

- `bike_brand`, `bike_model`, `make_year`
- `vin_number` (required in form)

## Parts-specific

- `item_name`, `brand`, `part_type`
- No VIN

## Plates-specific

- `plate_code`, `plate_number`, `emirates`
- OCR via mulkiyya scan
