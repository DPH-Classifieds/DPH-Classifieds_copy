# UI Fix Implementation Plan

## Issues to Fix

### Home Page
1. ✅ Replace AMG image with DPH approved image - Need image size
2. ✅ Fix loading sign
3. ✅ All drop down menus have two arrows
4. ✅ Add all "Make"
5. ✅ Model drop down should be locked until make is selected, depending on make, the relevant Model should drop down
6. ✅ Min year - 1886
7. ✅ Transmission - Only automatic and manual options
8. ✅ Regional specs - Remove "specs" word from drop down menu, change American to North American
9. ✅ Price & Kilometers can be set to negative, need to change that
10. ✅ HP dropdown: >100, 100-199, 200-299 up to 1000+ etc
11. ✅ Engine capacity: 0-999cc, 1000cc-1499cc, 1500cc-1999cc etc up to 8000cc+
12. ✅ Infotainment & Tech: Get rid of wireless/wired options
13. ✅ Special features/ Clear all needs a space between it (Clear filter button) [Don't need that button as there is a separate reset filter button below]

### Why Choose DPH Section
14. ✅ Classifieds section: car clubs -> car community in the middle-east with over 60,000 members
15. ✅ for petrolheads by petrolheads
16. ✅ WHY CHOOSE US:
    - Petrolhead created, with a focus on details that matter
    - Transparent ads
    - No fees
    - A community of over 25 million petrolhead viewers
17. ✅ Replace ready to sell your car image - Need image size

### Individual Listing Page
18. ✅ Colour of phone number to match same green as in website, get rid of red phone icon or make it white
19. ✅ Add whatsapp API option
20. ✅ Get rid of 0 after the 971 so the number flows as +9715xxxxxxxxx
21. ✅ Make VIN in black not blue
22. ✅ Make the popup within the website colours instead of basic text
23. ✅ Order of stuff:
    - Title
    - Images
    - Price
    - Contact seller
    - Description (limit word count as per competitors)
    - Car specifications
    - Location
    - Loan calculator

### Account Creation
24. ✅ Error message for passwords do not match should be automatic above the password section
25. ✅ Final error message should be at the bottom of the page not at the top
26. ✅ The above is true for any * field. The error message should first show up when the field is typed in
27. ✅ Final error message should be at the bottom near the create account button with all the errors listed not just the latest one
28. ✅ Password (first one only) should have an option to view what is typed

## Implementation Order
1. CarList.jsx - Filter improvements
2. PostCar.js - Form improvements
3. CarDetail.jsx - Layout and styling improvements
4. HomePage.js - Content updates
5. Signup.js - Form validation improvements
