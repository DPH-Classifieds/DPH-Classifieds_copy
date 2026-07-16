# ocr-service

A small, stateless PaddleOCR microservice. Pure image -> text; all field
parsing and validation lives in the main backend. Runs as its own Railway
service so heavy OCR can't starve the main API and can scale independently.

## Endpoints

- `GET /health` — `200 {"status":"ok"}` once the model is loaded, else `503`.
- `POST /scan` — multipart `image` file, header `X-OCR-Service-Key`, returns
  `{"text": "..."}` (space-joined OCR text in reading order).

## Run locally

```bash
pip install -r requirements.txt
python download_models.py            # warm the model cache (first run only)
OCR_SERVICE_KEY=dev uvicorn app:app --port 8000
# curl -s -H "X-OCR-Service-Key: dev" -F image=@some.jpg localhost:8000/scan
```

## Docker

```bash
docker build -t ocr-service .
docker run -e OCR_SERVICE_KEY=dev -p 8000:8000 ocr-service
```

## Deploy (Railway, project DPH-Classifieds)

Deployed as a separate service from the same repo, root dir
`flask-react-supabase-app/ocr-service`. The main backend reaches it over
Railway private networking (`ocr-service.railway.internal`). Set
`OCR_SERVICE_KEY` on both this service and the main backend; set
`OCR_SERVICE_URL=http://ocr-service.railway.internal:8000` on the main backend.

## Config

See `.env.example`.
