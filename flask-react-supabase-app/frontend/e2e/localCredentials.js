// Disposable identities for the browser-only local simulation lane.
// These are intentionally .test addresses and are not valid production secrets.
const LOCAL_E2E_CREDENTIALS = Object.freeze({
  user: Object.freeze({
    email: 'local.user@example.test',
    password: 'LocalUser!2026',
  }),
  dealer: Object.freeze({
    email: 'local.dealer@example.test',
    password: 'LocalDealer!2026',
  }),
  admin: Object.freeze({
    email: 'local.admin@example.test',
    password: 'LocalAdmin!2026',
  }),
});

module.exports = { LOCAL_E2E_CREDENTIALS };
