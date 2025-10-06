# Catalog Transform MVP

A runnable MVP for your Shopify → Zilo CMS catalog transformation tool.

## Features
- Upload Shopify CSV
- Select one of the 12 Zilo templates (schemas included in `backend/templates/`)
- Map **CMS fields → Shopify columns**
- Auto-map images from Shopify `Image Src` + `Image Position` (1–5) to `Front/Back/Side/Detail/Lifestyle`
- Optional Text Cleanup: mojibake fix, decode HTML entities, strip HTML tags, normalize whitespace (per selected Shopify columns)
- Unmapped fields are **excluded** from export (popup with Proceed Anyway / Go Back)
- **SKU is required**; rows with blank SKU are dropped
- Download transformed CSV

## How to run (local)

### 1) Install backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload
```

This serves the API and also the front-end at: **http://localhost:8000/**

### 2) Open the app
Visit **http://localhost:8000** in your browser.

## Notes
- Default mappings are stored in `backend/mappings_store.json` (auto-created).
- Template schemas live in `backend/templates/`. To update a template: replace its JSON and restart the server.
- CSV output is encoded as UTF-8 with BOM for Excel compatibility.
- If Shopify export lacks `Handle`, grouping falls back to row-by-row (images may not broadcast).
