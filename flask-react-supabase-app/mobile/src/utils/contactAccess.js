// Seller phone / WhatsApp are public — no login or phone verification required
// to call or message. Kept as a function (signature-compatible) so the four
// detail screens' handleCall / handleWhatsApp call sites need no changes; the
// clicks are still tracked anonymously by those screens. VIN reveal stays
// phone-verified via a separate path in CarDetailScreen.
export const ensureContactAccess = () => true;
