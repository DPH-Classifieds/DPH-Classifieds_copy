// Listing-type normalization.
//
// API responses use either singular ('car', 'bike', 'plate') or plural
// ('cars', 'bikes', 'plates') for `listing_type`. The post form's category
// state uses singular for car/bike/plate but 'parts' for parts. Backend
// URLs uniformly use plural ('cars', 'bikes', 'plates', 'parts'). Hence
// two helpers — one for backend URLs, one for category/edit-form input.

const PLURAL_TYPE = {
  car: 'cars', bike: 'bikes', plate: 'plates', part: 'parts',
  cars: 'cars', bikes: 'bikes', plates: 'plates', parts: 'parts',
};

const SINGULAR_TYPE = {
  car: 'car', bike: 'bike', plate: 'plate', part: 'parts', parts: 'parts',
  cars: 'car', bikes: 'bike', plates: 'plate',
};

export const toPluralType = (t) => PLURAL_TYPE[t] || 'cars';
export const toSingularType = (t) => SINGULAR_TYPE[t] || 'car';
