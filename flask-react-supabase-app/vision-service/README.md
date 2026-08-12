# vision-service

Private, self-hosted image-analysis service for DPH moderation. It runs NudeNet
for explicit exposed-part detection and open-CLIP for a vehicle-photo context
score. It returns scores only; the backend retains policy control.

## Railway deployment (later)

Create a Railway service with root directory `flask-react-supabase-app/vision-service`.
Do **not** generate a public domain. The backend/worker will use:

`http://vision-service.railway.internal:8000`

Set the same long random `VISION_SERVICE_KEY` on this service and the backend
worker. Keep `VISION_SERVICE_MODE=disabled` until migrations are applied and
shadow-mode testing is explicitly enabled.
