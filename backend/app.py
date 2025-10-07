import io
import os
import json
import csv
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import pandas as pd
from bs4 import BeautifulSoup
from ftfy import fix_text
import html

# --------------------------------------------------
# Directory setup
# --------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
MAPPINGS_STORE = os.path.join(BASE_DIR, "mappings_store.json")

# --------------------------------------------------
# App initialization
# --------------------------------------------------
app = FastAPI(title="Catalog Buddy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static and templates
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# --------------------------------------------------
# Homepage route
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    """Serve index.html as homepage."""
    return templates.TemplateResponse("index.html", {"request": request})

# --------------------------------------------------
# Utility functions
# --------------------------------------------------
VARIANT_LEVEL_SHOPIFY_HEADERS = set([
    "Variant SKU", "Variant Price", "Variant Compare At Price", "Variant Barcode",
    "Variant Inventory Qty", "Variant Grams", "Variant Weight", "Variant Weight Unit",
    "Variant Tax Code", "Variant Fulfillment Service", "Variant Requires Shipping",
    "Variant Taxable", "Variant Title", "Variant Image",
    "Option1 Value", "Option2 Value", "Option3 Value",
    "Cost per item", "Inventory Policy", "Inventory Qty", "Inventory Item ID", "Inventory Tracker"
])

def read_templates() -> Dict[str, Any]:
    """Load all JSON schema templates."""
    result = {}
    for fname in os.listdir(TEMPLATES_DIR):
        if fname.endswith(".json"):
            with open(os.path.join(TEMPLATES_DIR, fname), "r", encoding="utf-8") as f:
                data = json.load(f)
                result[data["templateKey"]] = data
    return result

def load_mapping_store() -> Dict[str, Any]:
    if not os.path.exists(MAPPINGS_STORE):
        return {}
    with open(MAPPINGS_STORE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except Exception:
            return {}

def save_mapping_store(store: Dict[str, Any]) -> None:
    with open(MAPPINGS_STORE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

def clean_text_value(val: Any) -> str:
    if val is None:
        return ""
    s = str(val)
    s = fix_text(s)
    s = html.unescape(s)
    s = BeautifulSoup(s, "html.parser").get_text(separator=" ")
    s = " ".join(s.split())
    return s

def normalize_headers(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        df[col] = df[col].astype(str).fillna("")
        df[col] = df[col].replace("nan", "")
    return df

def get_col(df: pd.DataFrame, name: str) -> Optional[pd.Series]:
    if name in df.columns:
        return df[name]
    lowered = {c.lower(): c for c in df.columns}
    if name.lower() in lowered:
        return df[lowered[name.lower()]]
    return None

def collect_images(df: pd.DataFrame) -> Dict[str, Dict[int, str]]:
    images_by_handle: Dict[str, Dict[int, str]] = {}
    handle_col = get_col(df, "Handle")
    src_col = get_col(df, "Image Src")
    pos_col = get_col(df, "Image Position")
    if handle_col is None or src_col is None or pos_col is None:
        return images_by_handle
    for i in range(len(df)):
        handle = (handle_col.iloc[i] or "").strip()
        url = (src_col.iloc[i] or "").strip()
        pos_raw = (pos_col.iloc[i] or "").strip()
        if not handle or not url or not pos_raw:
            continue
        try:
            pos = int(float(pos_raw))
        except Exception:
            continue
        if pos < 1 or pos > 5:
            continue
        slot = images_by_handle.setdefault(handle, {})
        if pos not in slot:
            slot[pos] = url
    return images_by_handle

def stream_csv(header: List[str], rows_iter):
    def iter_bytes():
        yield b'\xef\xbb\xbf'
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\r\n")
        writer.writerow(header)
        yield buf.getvalue().encode("utf-8")
        buf.seek(0); buf.truncate(0)
        for row in rows_iter:
            writer.writerow(row)
            yield buf.getvalue().encode("utf-8")
            buf.seek(0); buf.truncate(0)
    return StreamingResponse(iter_bytes(), media_type="text/csv; charset=utf-8")

# --------------------------------------------------
# Routes
# --------------------------------------------------

@app.get("/templates")
def list_templates():
    """Return list of available templates."""
    return {"templates": list(read_templates().values())}

@app.get("/templates/{template_key}")
def get_template(template_key: str):
    tpls = read_templates()
    if template_key not in tpls:
        raise HTTPException(404, "Template not found")
    return tpls[template_key]

@app.get("/mappings/{template_key}")
def get_mapping(template_key: str):
    store = load_mapping_store()
    return store.get(template_key, {"mapping": {}, "textCleanup": {"columns": []}})

@app.post("/mappings/{template_key}")
async def save_mapping(
    template_key: str,
    mapping: str = Form(...),
    textCleanup: str = Form(""),
    saveAsDefault: str = Form("true")
):
    try:
        mapping_obj = json.loads(mapping)
    except Exception:
        raise HTTPException(400, "Invalid mapping JSON")

    cleanup_cols = []
    if textCleanup:
        try:
            cleanup_cols = json.loads(textCleanup).get("columns", [])
        except Exception:
            cleanup_cols = []

    store = load_mapping_store()
    store[template_key] = {"mapping": mapping_obj, "textCleanup": {"columns": cleanup_cols}}
    save_mapping_store(store)
    return {"ok": True}

@app.post("/transform")
async def transform(
    file: UploadFile = File(...),
    templateKey: str = Form(...),
    mapping: str = Form(...),
    textCleanup: str = Form(""),
    filename: str = Form("zilo_export.csv")
):
    # Load template
    tpls = read_templates()
    if templateKey not in tpls:
        raise HTTPException(400, "Unknown templateKey")
    tpl = tpls[templateKey]
    export_rules = tpl.get("exportRules", {})
    required_key = export_rules.get("requiredFieldKey", "sku")
    drop_if_blank = set(export_rules.get("dropRowIfBlankKeys", []))

    try:
        mapping_obj = json.loads(mapping)
    except Exception:
        raise HTTPException(400, "Invalid mapping JSON")

    cleanup_cols = []
    if textCleanup:
        try:
            cleanup_cols = json.loads(textCleanup).get("columns", [])
        except Exception:
            cleanup_cols = []

    # Read CSV
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, na_filter=False, encoding="utf-8")
    except Exception:
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, na_filter=False, encoding="utf-8-sig")
    df = normalize_headers(df)

    # Cleanup text
    for col in cleanup_cols:
        col_ser = get_col(df, col)
        if col_ser is not None:
            df[col_ser.name] = df[col_ser.name].map(clean_text_value)

    images = collect_images(df)
    auto_image_fields = []
    mapped_fields: List[Dict[str, str]] = []
    label_by_key = {f["key"]: f["label"] for f in tpl["fields"]}

    for f in tpl["fields"]:
        k = f["key"]
        auto_pos = f.get("autoMap")
        if auto_pos and f.get("type") == "image":
            try:
                pos = int(auto_pos.split("=")[-1])
            except Exception:
                pos = None
            if pos:
                auto_image_fields.append((k, pos, f["label"]))
        else:
            if k in mapping_obj and mapping_obj[k]:
                mapped_fields.append({"key": k, "src": mapping_obj[k], "label": f["label"]})

    if required_key not in {f["key"] for f in mapped_fields}:
        raise HTTPException(400, f"Required field '{required_key}' must be mapped.")

    output_headers: List[str] = []
    for f in tpl["fields"]:
        k = f["key"]
        if any(mi["key"] == k for mi in mapped_fields):
            output_headers.append(f["label"])
        elif any(ai[0] == k for ai in auto_image_fields):
            output_headers.append(f["label"])

    handle_series = get_col(df, "Handle")
    if handle_series is None:
        handle_series = pd.Series(["__row__" + str(i) for i in range(len(df))])

    product_values: Dict[str, Dict[str, str]] = {}
    for mi in mapped_fields:
        src = mi["src"]
        is_variant = src in VARIANT_LEVEL_SHOPIFY_HEADERS
        if not is_variant:
            values_by_handle = {}
            src_col = get_col(df, src)
            if src_col is None:
                continue
            for idx, handle in enumerate(handle_series):
                val = (src_col.iloc[idx] or "").strip()
                if not val:
                    continue
                if handle not in values_by_handle:
                    values_by_handle[handle] = val
            for h, v in values_by_handle.items():
                product_values.setdefault(h, {})[mi["key"]] = v

    def rows_iter():
        for idx in range(len(df)):
            handle = handle_series.iloc[idx]
            out_row = []
            sku_src = next((mi["src"] for mi in mapped_fields if mi["key"] == required_key), None)
            sku_val = ""
            if sku_src:
                col = get_col(df, sku_src)
                if col is not None:
                    sku_val = (col.iloc[idx] or "").strip()
            if not sku_val and required_key in drop_if_blank:
                continue

            for f in tpl["fields"]:
                k = f["key"]
                m = next((mi for mi in mapped_fields if mi["key"] == k), None)
                if m:
                    src = m["src"]
                    src_col = get_col(df, src)
                    if src_col is not None and src in VARIANT_LEVEL_SHOPIFY_HEADERS:
                        val = (src_col.iloc[idx] or "").strip()
                    else:
                        val = (
                            product_values.get(handle, {}).get(k)
                            or (src_col.iloc[idx] if src_col is not None else "")
                        )
                    out_row.append(val)
                    continue
                ai = next(((ak, pos, lab) for (ak, pos, lab) in auto_image_fields if ak == k), None)
                if ai:
                    pos = ai[1]
                    url = images.get(handle, {}).get(pos, "")
                    out_row.append(url)
            yield out_row

    response = stream_csv(output_headers, rows_iter())
    response.headers["Content-Disposition"] = f'attachment; filename="{filename or "zilo_export.csv"}"'
    return response
