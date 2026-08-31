# Frontend dependency usage notes

These packages were initially reported as dead based on static source searches,
but their usage is lazy or dynamic and must be included in the build:

- `@react-three/fiber`, `@react-three/drei`, and `three` are imported by
  `src/components/HeroBackground.js`, which is lazy-loaded by the homepage.
- `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, and `nsfwjs` are loaded
  with dynamic imports from `src/utils/imageModeration.js` for the on-device
  image check. The backend remains the source of truth for moderation.

Do not remove these dependencies without tracing dynamic imports and validating
the production bundle. `axios` is separate: it was removed from the web auth
service because global interceptors and bearer-header mutation were unsafe.
