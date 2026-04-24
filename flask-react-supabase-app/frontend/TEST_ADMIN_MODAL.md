# Admin Modal Test Checklist

**Task:** Test admin modal displays correctly
**File:** `frontend/src/components/AdminListings.js`
**Date:** 2026-04-24

## Test Prerequisites

- [ ] Frontend application is running (`npm start`)
- [ ] Backend API is accessible
- [ ] Database contains test listings with various states (pending, approved, rejected)
- [ ] Admin user is logged in

## Build Verification

- [ ] Application builds successfully without errors (`npm run build`)
- [ ] No TypeScript compilation errors
- [ ] No ESLint warnings
- [ ] No console errors in browser

## Manual Test Instructions

### 1. Navigate to Admin Listings Page
1. Log in as admin user
2. Navigate to `/admin` or admin dashboard
3. Click on "Listings" or navigate to listings management page
4. Verify page loads without errors

### 2. Open Detail Modal
1. Find any listing in the grid
2. Click "View Details" button
3. Verify modal opens with overlay
4. Verify modal displays centered and properly sized

### 3. Verify Hero Section (Top Area)
- [ ] **Main Image**: Displays correctly with proper aspect ratio
- [ ] **Price (AED)**: Shows formatted price (e.g., "150,000 AED")
- [ ] **Price (USD)**: Shows USD equivalent (e.g., "≈ USD 40,870")
- [ ] **Badges**:
  - [ ] "GCC Specs" badge displays when `regional_spec` is true
  - [ ] "Insured" badge displays when `is_insured` is true
  - [ ] "Imported" badge displays when `imported` is true
- [ ] **Seller Info**:
  - [ ] Avatar displays with first letter of seller name
  - [ ] Seller name displays correctly
  - [ ] Verified badge (✓) displays when `dealer_verified` is true
  - [ ] Email address displays below seller name
- [ ] **Location**: City displays with location icon
- [ ] **Photo Count**: Badge showing number of photos (e.g., "12 photos")

### 4. Verify Image Gallery
- [ ] **Thumbnail Grid**: All images display as thumbnails below main image
- [ ] **Active State**: Selected thumbnail has blue border (`#007bff`)
- [ ] **Click Navigation**: Clicking thumbnail updates main image
- [ ] **Active Image Index**: State updates correctly on click
- [ ] **Image Error Handling**: Broken images hide gracefully
- [ ] **Scrollable Gallery**: Horizontal scroll when many images

### 5. Verify Car Specifications Section
Verify all 18 specifications display in responsive grid:

| Spec | Field | Expected Display |
|------|-------|------------------|
| Make | `car_manufacturer` or `display_make` | e.g., "Toyota" |
| Model | `car_model` or `display_model` | e.g., "Camry" |
| Year | `make_year` or `display_year` | e.g., "2023" |
| Trim | `trim` | e.g., "XLE" |
| Body Type | `body_type` | e.g., "Sedan" |
| Color | `color` | e.g., "White" |
| Mileage | `kilometer_driven` or `display_mileage` | e.g., "45,000 km" |
| Fuel Type | `fuel_type` | e.g., "Petrol" |
| Transmission | `transmission_type` | e.g., "Automatic" |
| Cylinders | `cylinders` | e.g., "4" |
| Horsepower | `horsepower` | e.g., "203 HP" |
| Engine | `engine_capacity` | e.g., "2.5L" |
| Doors | `doors` | e.g., "4" |
| Seating Capacity | `seating_capacity` | e.g., "5" |
| Steering Side | `steering_side` | e.g., "Left" |
| Regional Specs | `regional_spec` | e.g., "GCC" |
| Warranty | `warranty` | e.g., "Yes" |
| Service History | `service_history` | e.g., "Full" |

- [ ] All specs display in responsive grid (auto-fill, minmax 200px)
- [ ] Spec cards have proper styling (background, border, padding)
- [ ] Label displays in gray, value displays in bold

### 6. Verify Extras & Features Section

**Test Case 1: JSONB Extras Array**
- [ ] Extras from `extras` array display in grid
- [ ] Each extra has bullet point indicator
- [ ] Extras display in responsive grid (auto-fill, minmax 180px)

**Test Case 2: Boolean Flags Fallback**
- [ ] When `extras` array is empty, boolean flags are checked
- [ ] `climate_control` → "Climate Control"
- [ ] `dvd_player` → "DVD Player"
- [ ] `keyless_entry` → "Keyless Entry"
- [ ] `navigation_system` → "Navigation System"
- [ ] `premium_sound_system` → "Premium Sound System"
- [ ] `cooled_seats` → "Cooled Seats"
- [ ] `front_wheel_drive` → "Front Wheel Drive"
- [ ] `leather_seats` → "Leather Seats"
- [ ] `parking_sensors` → "Parking Sensors"
- [ ] `rear_view_camera` → "Rear View Camera"
- [ ] `lady_driven` → "Lady Driven"

**Test Case 3: No Extras**
- [ ] When no extras, message displays: "No extras were listed for this vehicle."

### 7. Verify Location Section

- [ ] **Location Info Card**:
  - [ ] City displays with location icon
  - [ ] Area displays: `{area}` or `{car_location}` or "Not specified"
  - [ ] Coordinates display when latitude/longitude exist: "24.4539, 54.3773"

- [ ] **Interactive Map**:
  - [ ] Map displays with proper dimensions (height: 200px)
  - [ ] Map uses dark theme (CartoCDN dark_all tiles)
  - [ ] Map centers on coordinates when available
  - [ ] Map zooms to level 13 when coordinates present
  - [ ] Map marker displays at listing location
  - [ ] **Fallback**: If no coordinates, map centers on city (zoom level 10)
  - [ ] **City Fallbacks**:
    - Abu Dhabi: [24.4539, 54.3773]
    - Dubai: [25.2048, 55.2708]
    - Sharjah: [25.3463, 55.4209]
    - Ajman: [25.4052, 55.5136]
    - Umm Al Quwain: [25.5647, 55.5552]
    - Ras Al Khaimah: [25.7895, 55.9432]
    - Fujairah: [25.1288, 56.3265]
  - [ ] **No Map**: If no coordinates and no city, map doesn't render

### 8. Verify Lead Metrics Section

Verify 4 metric cards display in responsive grid:

| Metric | Source Field | Color |
|--------|--------------|-------|
| Total Leads | `qualified_leads` or `call_click + whatsapp_click` | Green (#28a745) |
| Call Clicks | `call_click` | Blue (#007bff) |
| WhatsApp Clicks | `whatsapp_click` | WhatsApp Green (#25D366) |
| VIN Opens | `vin_open` | Gray (#6c757d) |

- [ ] All metrics display as styled cards
- [ ] Cards display in responsive grid (auto-fit, minmax 150px)
- [ ] Numbers display in bold with appropriate colors
- [ ] Labels display in gray above numbers

### 9. Verify Description Section

- [ ] Description displays in styled card
- [ ] Shows `car_description` or `display_description` or `description`
- [ ] Fallback to "No description provided." if none exist
- [ ] Text has proper line-height (1.6)
- [ ] Section has proper padding and styling

### 10. Verify Additional Information Section

Verify 4 info cards display in responsive grid:

| Field | Label | Expected |
|-------|-------|----------|
| VIN | VIN / Chassis Number | `vin_number` or `chassis_number` or `vin` |
| Phone | Phone | `{country_code}{phone_number}` |
| Created | Created | Formatted date from `created_at` |
| Status | Status | Status badge (pending/approved/rejected) |

- [ ] Rejection note displays when present (yellow warning box)
- [ ] Rejection note shows reason and details
- [ ] All fields display in responsive grid

### 11. Verify Contact Buttons (Footer)

**For Pending Listings:**
- [ ] "Reject" button displays
- [ ] "Approve" button displays
- [ ] "Delete Listing" button displays

**For Approved/Rejected Listings:**
- [ ] "Close" button displays
- [ ] "Delete Listing" button displays

- [ ] All buttons have proper styling and hover states
- [ ] Buttons are disabled when action is in progress

### 12. Verify Responsive Layout

**Desktop (>1024px):**
- [ ] Modal displays at max-width: 900px
- [ ] 2:1 grid layout (image + info) works correctly
- [ ] All grids display as multi-column

**Tablet (768px - 1024px):**
- [ ] Modal displays with proper margins
- [ ] Grids adapt to fewer columns
- [ ] No horizontal overflow

**Mobile (<768px):**
- [ ] Modal fills screen width (with margins)
- [ ] 2:1 grid stacks vertically
- [ ] All grids display as single column
- [ ] Buttons stack vertically
- [ ] Images scale properly
- [ ] No horizontal scrolling
- [ ] Touch interactions work

### 13. Verify Modal Behavior

- [ ] Modal opens smoothly with overlay
- [ ] Close button (X) works
- [ ] Clicking outside modal doesn't close (no backdrop click handler)
- [ ] Modal scrolls internally if content overflows
- [ ] Active image index resets when modal opens
- [ ] State cleanup on close

### 14. Verify Error Handling

- [ ] Missing images: Error handler hides broken images
- [ ] Null/undefined fields: Display "N/A" gracefully
- [ ] Invalid coordinates: Fallback to city center or no map
- [ ] Empty extras: Display fallback message
- [ ] Missing data: No crashes, graceful degradation

## Automated Tests (Optional)

If adding automated tests, verify:

```javascript
describe('AdminListings Modal', () => {
  test('modal opens with correct data', () => {
    // Test modal opens when View Details clicked
    // Test all sections render
  });

  test('image navigation works', () => {
    // Test clicking thumbnail updates active image
    // Test active image state highlights correctly
  });

  test('map displays with correct center', () => {
    // Test map renders with coordinates
    // Test fallback to city coordinates
  });

  test('extras display from array or boolean flags', () => {
    // Test JSONB array extras
    // Test boolean flag fallback
  });

  test('responsive layout works', () => {
    // Test at different breakpoints
  });
});
```

## Test Results Summary

| Test Category | Pass | Fail | Notes |
|---------------|------|------|-------|
| Build & Compile | ☐ | ☐ | |
| Hero Section | ☐ | ☐ | |
| Image Gallery | ☐ | ☐ | |
| Specifications | ☐ | ☐ | |
| Extras & Features | ☐ | ☐ | |
| Location & Map | ☐ | ☐ | |
| Lead Metrics | ☐ | ☐ | |
| Description | ☐ | ☐ | |
| Additional Info | ☐ | ☐ | |
| Contact Buttons | ☐ | ☐ | |
| Responsive Layout | ☐ | ☐ | |
| Error Handling | ☐ | ☐ | |

## Known Issues Found During Review

1. ✅ **FIXED**: Modal max-width was 600px, updated to 900px for proper 2:1 grid layout
2. ✅ **FIXED**: Added missing CSS for `<select>` elements in modal

## Recommendations

1. Consider adding image lazy loading for performance
2. Consider adding a lightbox/fullscreen view for images
3. Consider adding a "Print Details" feature for records
4. Consider adding keyboard navigation (ESC to close modal)
5. Consider adding image zoom on hover
6. Consider adding loading states for map tile loading

## Sign-off

**Tester:** _______________
**Date:** _______________
**Status:** ☐ PASSED | ☐ PASSED WITH NOTES | ☐ FAILED
