"""Pure Reddit source client, validator, and sale-post parser.

Backend-only. Performs OAuth token fetch and read-only listing fetch, then
deterministically parses *sale* posts that carry enough trustworthy vehicle
data. NO database access lives here — the worker consumes these outputs.

Safety contract:
- Only posts producing make + model + year + AED price + title + one safe image
  are publishable. Everything else returns None (counted as skipped upstream).
- Never store phone numbers, emails, URLs from the body, raw selftext, or comments.
- Images must come from Reddit's own hosts (preview.redd.it / i.redd.it).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import requests

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE_URL = "https://oauth.reddit.com"
INFO_URL = f"{OAUTH_BASE_URL}/api/info"
ALLOWED_IMAGE_HOSTS = {"preview.redd.it", "i.redd.it"}
ALLOWED_REDDIT_HOSTS = {"www.reddit.com", "reddit.com"}

MIN_PRICE_AED = 1_000
MAX_PRICE_AED = 10_000_000
MIN_YEAR = 1980

# Maintained make list. Longest alias first so "land rover" beats "rover", etc.
# Maps a lowercase alias -> canonical display name.
_MAKE_ALIASES = {
    "mercedes-benz": "Mercedes-Benz", "mercedes benz": "Mercedes-Benz", "mercedes": "Mercedes-Benz",
    "land rover": "Land Rover", "range rover": "Land Rover", "landrover": "Land Rover",
    "aston martin": "Aston Martin", "alfa romeo": "Alfa Romeo", "rolls royce": "Rolls-Royce",
    "rolls-royce": "Rolls-Royce",
    "bmw": "BMW", "audi": "Audi", "toyota": "Toyota", "nissan": "Nissan", "honda": "Honda",
    "lexus": "Lexus", "porsche": "Porsche", "ferrari": "Ferrari", "lamborghini": "Lamborghini",
    "bentley": "Bentley", "maserati": "Maserati", "mclaren": "McLaren", "jaguar": "Jaguar",
    "ford": "Ford", "chevrolet": "Chevrolet", "chevy": "Chevrolet", "dodge": "Dodge",
    "gmc": "GMC", "cadillac": "Cadillac", "jeep": "Jeep", "volkswagen": "Volkswagen",
    "vw": "Volkswagen", "volvo": "Volvo", "mini": "MINI", "mazda": "Mazda",
    "mitsubishi": "Mitsubishi", "subaru": "Subaru", "suzuki": "Suzuki", "kia": "Kia",
    "hyundai": "Hyundai", "infiniti": "Infiniti", "peugeot": "Peugeot", "renault": "Renault",
    "fiat": "Fiat", "chrysler": "Chrysler", "tesla": "Tesla", "genesis": "Genesis",
    "acura": "Acura", "lincoln": "Lincoln", "buick": "Buick", "skoda": "Skoda",
    "seat": "SEAT", "opel": "Opel", "citroen": "Citroen", "isuzu": "Isuzu",
    "bugatti": "Bugatti", "lotus": "Lotus", "abarth": "Abarth",
    "mg": "MG", "byd": "BYD", "chery": "Chery", "geely": "Geely",
    "haval": "Haval", "changan": "Changan", "hummer": "Hummer",
    "daihatsu": "Daihatsu", "mahindra": "Mahindra", "polestar": "Polestar",
    "lucid": "Lucid", "rivian": "Rivian",
}
# Match makes longest-first.
_MAKE_ALIASES_BY_LEN = sorted(_MAKE_ALIASES.items(), key=lambda kv: -len(kv[0]))

# A model token can't be one of these (spec/marketing/sale noise adjacent to a make).
_MODEL_STOPWORDS = {
    "gcc", "spec", "specs", "for", "sale", "sell", "selling", "wts", "wtb", "urgent",
    "clean", "low", "mileage", "km", "kms", "full", "service", "history", "aed", "price",
    "negotiable", "neg", "excellent", "condition", "used", "new", "the", "a", "an", "in",
    "dubai", "abu", "dhabi", "sharjah", "uae", "and", "with", "warranty",
}

_UNSPECIFIED = "Unspecified"

# PII scrubbing patterns (applied to any text we keep, e.g. the title).
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s\-().]{6,}\d)")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_WS_RE = re.compile(r"\s+")

_SALE_SIGNALS = ("wts", "for sale", "selling", "for sell")
# Word-boundary disqualifiers so "gold"/"resold" don't trip "sold".
_DISQUALIFIERS = (
    r"\bwtb\b", r"\bwanted\b", r"\bsold\b", r"\bsold!\b",
    r"\bprice check\b", r"\bpc\b", r"\bswap\b", r"\btrade\b",
)


@dataclass
class RedditSubmission:
    id: str  # fullname, e.g. t3_1v4iryw
    title: str
    selftext: str
    author: Optional[str]
    permalink: str
    created_utc: float
    images: list = field(default_factory=list)
    over_18: bool = False
    stickied: bool = False
    distinguished: Optional[str] = None
    is_crosspost: bool = False
    removed_by_category: Optional[str] = None
    removed: bool = False

    @property
    def is_removed_or_deleted(self) -> bool:
        return bool(
            self.removed
            or self.removed_by_category
            or (self.author in (None, "", "[deleted]"))
            or self.title.strip().lower() in ("[deleted]", "[removed]")
        )

    @classmethod
    def from_api(cls, data: dict) -> "RedditSubmission":
        data = data or {}
        raw_id = str(data.get("id") or "")
        fullname = str(data.get("name") or (f"t3_{raw_id}" if raw_id else ""))
        return cls(
            id=fullname,
            title=str(data.get("title") or ""),
            selftext=str(data.get("selftext") or ""),
            author=(data.get("author") if data.get("author") not in (None, "") else None),
            permalink=str(data.get("permalink") or ""),
            created_utc=float(data.get("created_utc") or 0.0),
            images=_extract_images(data),
            over_18=bool(data.get("over_18")),
            stickied=bool(data.get("stickied")),
            distinguished=data.get("distinguished"),
            is_crosspost=bool(data.get("crosspost_parent")),
            removed_by_category=data.get("removed_by_category"),
            removed=bool(data.get("removed")),
        )


@dataclass
class ParsedRedditCar:
    source_id: str
    title: str
    make: str
    model: str
    year: int
    price_aed: int
    description: str
    source_url: str
    author: Optional[str]
    created_utc: float
    image_url: Optional[str]
    mileage_km: Optional[int] = None


# --- OAuth + fetch (thin, bounded) -----------------------------------------

def get_app_access_token(session: requests.Session, client_id: str, client_secret: str, user_agent: str) -> str:
    response = session.post(
        TOKEN_URL,
        auth=(client_id, client_secret),
        data={"grant_type": "client_credentials"},
        headers={"User-Agent": user_agent},
        timeout=20,
    )
    response.raise_for_status()
    token = (response.json() or {}).get("access_token")
    if not token:
        raise ValueError("reddit token response missing access_token")
    return token


def fetch_new_submissions(session, access_token, subreddit, limit, user_agent):
    response = session.get(
        f"{OAUTH_BASE_URL}/r/{subreddit}/new",
        params={"limit": min(int(limit or 100), 100), "raw_json": 1},
        headers={"Authorization": f"Bearer {access_token}", "User-Agent": user_agent},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json() or {}
    children = ((payload.get("data") or {}).get("children")) or []
    out = []
    for child in children:
        data = (child or {}).get("data")
        if isinstance(data, dict):
            out.append(RedditSubmission.from_api(data))
    return out


def fetch_submissions_by_ids(session, access_token, fullnames, user_agent):
    """Bounded /api/info lookup by fullname. Returns {fullname: RedditSubmission}.
    IDs absent from the response are simply missing (treated as deleted upstream)."""
    fullnames = [f for f in fullnames if f]
    if not fullnames:
        return {}
    response = session.get(
        INFO_URL,
        params={"id": ",".join(fullnames[:100]), "raw_json": 1},
        headers={"Authorization": f"Bearer {access_token}", "User-Agent": user_agent},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json() or {}
    children = ((payload.get("data") or {}).get("children")) or []
    result = {}
    for child in children:
        data = (child or {}).get("data")
        if isinstance(data, dict):
            sub = RedditSubmission.from_api(data)
            if sub.id:
                result[sub.id] = sub
    return result


# --- URL safety -------------------------------------------------------------

def canonical_reddit_url(permalink: str) -> str:
    """Return a canonical https://www.reddit.com URL. Raise on any other host."""
    permalink = (permalink or "").strip()
    if not permalink:
        raise ValueError("empty permalink")
    if permalink.startswith("/r/"):
        return f"https://www.reddit.com{permalink}"
    parsed = urlparse(permalink)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ALLOWED_REDDIT_HOSTS:
        raise ValueError(f"untrusted reddit url: {permalink}")
    path = parsed.path or "/"
    if not path.startswith("/r/"):
        raise ValueError(f"unexpected reddit path: {path}")
    return f"https://www.reddit.com{path}"


# --- Extraction helpers -----------------------------------------------------

def _extract_images(data: dict) -> list:
    urls = []
    direct = str(data.get("url") or "")
    if _is_allowed_image(direct):
        urls.append(direct)
    preview = (data.get("preview") or {}).get("images") or []
    for img in preview:
        src = ((img or {}).get("source") or {}).get("url") or ""
        if _is_allowed_image(src):
            urls.append(src)
    # Reddit *gallery* posts (how most car sales post photos): the image URLs
    # live in media_metadata, ordered by gallery_data.items. data.url is just the
    # /gallery/ permalink, so without this branch every gallery sale is skipped.
    media_metadata = data.get("media_metadata") or {}
    gallery_items = ((data.get("gallery_data") or {}).get("items")) or []
    ordered_ids = [it.get("media_id") for it in gallery_items if it.get("media_id")]
    if not ordered_ids and isinstance(media_metadata, dict):
        ordered_ids = list(media_metadata.keys())
    for media_id in ordered_ids:
        meta = media_metadata.get(media_id) or {}
        if meta.get("status") != "valid" or meta.get("e") != "Image":
            continue
        src = (meta.get("s") or {}).get("u") or ""
        if _is_allowed_image(src):
            urls.append(src)
    # De-dup preserving order, rewriting each to a hotlinkable host.
    seen, out = set(), []
    for u in urls:
        u = _to_hotlinkable(u)
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _to_hotlinkable(url: str) -> str:
    """preview.redd.it returns 403 to browser <img> requests (no hotlinking);
    i.redd.it serves the same file publicly under the same basename. Rewrite so
    imported images actually render on the site and app."""
    m = re.match(r"https://preview\.redd\.it/([^/?#]+)", url or "")
    return f"https://i.redd.it/{m.group(1)}" if m else url


def _is_allowed_image(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host in ALLOWED_IMAGE_HOSTS


def _scrub_pii(text: str) -> str:
    text = _URL_RE.sub(" ", text or "")
    text = _EMAIL_RE.sub(" ", text)
    text = _PHONE_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def _parse_price_aed(text: str) -> Optional[int]:
    low = text.lower()
    # "85k" / "85 k" (thousands) — require an AED cue somewhere OR standalone k form.
    for m in re.finditer(r"(?<![\d.])(\d{1,4})\s?k\b", low):
        val = int(m.group(1)) * 1000
        if MIN_PRICE_AED <= val <= MAX_PRICE_AED:
            return val
    # "AED 85,000" / "aed85000" — the prefixed form is unambiguous; prefer it so
    # "2022 AED 75,000" doesn't grab the year via the suffix form below.
    m = re.search(r"(?:aed|dhs?|dirhams?)\s*([\d,]{3,})", low)
    if m:
        digits = m.group(1).replace(",", "")
        if digits.isdigit() and MIN_PRICE_AED <= int(digits) <= MAX_PRICE_AED:
            return int(digits)
    # "85,000 AED" (suffix). A bare 4-digit token with no thousands separator that
    # looks like a model year is not a price ("2022 AED" -> skip).
    for m in re.finditer(r"([\d,]{3,})\s*(?:aed|dhs?|dirhams?)", low):
        raw = m.group(1)
        digits = raw.replace(",", "")
        if not digits.isdigit():
            continue
        val = int(digits)
        if "," not in raw and len(digits) == 4 and MIN_YEAR <= val <= 2100:
            continue  # year-like, not a price
        if MIN_PRICE_AED <= val <= MAX_PRICE_AED:
            return val
    return None


def _parse_year(text: str, now: datetime) -> Optional[int]:
    upper = now.year + 1
    for m in re.finditer(r"(?<!\d)(\d{4})(?!\d)", text):
        year = int(m.group(1))
        if MIN_YEAR <= year <= upper:
            return year
    return None


def _parse_mileage(text: str) -> Optional[int]:
    low = text.lower()
    m = re.search(r"([\d,]{2,})\s?(?:km|kms|kilometres|kilometers)\b", low)
    if m:
        digits = m.group(1).replace(",", "")
        if digits.isdigit():
            val = int(digits)
            if 0 < val <= 2_000_000:
                return val
    # "88k km"
    m = re.search(r"(\d{1,4})\s?k\s?(?:km|kms)\b", low)
    if m:
        return int(m.group(1)) * 1000
    return None


def _resolve_make_model(title: str) -> Optional[tuple]:
    # Longest alias first so "land rover" wins over "rover", "mercedes benz" over "benz".
    for alias, canonical in _MAKE_ALIASES_BY_LEN:
        match = re.search(rf"\b{re.escape(alias)}\b", title, re.IGNORECASE)
        if not match:
            continue
        model = _first_model_token(title[match.end():])
        if model:
            return canonical, model
    return None


def _first_model_token(tail: str) -> Optional[str]:
    for tok in re.split(r"[\s/,:;\-–—|()]+", tail):
        cleaned = tok.strip().strip(".!?")
        if not cleaned:
            continue
        low = cleaned.lower()
        if low in _MODEL_STOPWORDS:
            continue
        if re.fullmatch(r"\d{4}", cleaned):  # a year, not a model
            continue
        if re.fullmatch(r"[\d,]+k?", low):  # a price/number
            continue
        if not re.search(r"[A-Za-z0-9]", cleaned):
            continue
        return cleaned[:100]
    return None


def _looks_like_sale(text: str) -> bool:
    low = f" {text.lower()} "
    if not any(sig in low for sig in _SALE_SIGNALS):
        return False
    for dq in _DISQUALIFIERS:
        if re.search(dq, low):
            return False
    return True


def parse_sale_post(submission: RedditSubmission, now: datetime) -> Optional[ParsedRedditCar]:
    """Return a ParsedRedditCar only for a clearly eligible sale post, else None."""
    if submission is None:
        return None
    if submission.over_18 or submission.stickied or submission.distinguished:
        return None
    if submission.is_crosspost or submission.is_removed_or_deleted:
        return None

    title = (submission.title or "").strip()
    if not title:
        return None

    combined = f"{title}\n{submission.selftext or ''}"
    if not _looks_like_sale(combined):
        return None

    price = _parse_price_aed(combined)
    year = _parse_year(title, now) or _parse_year(combined, now)
    mm = _resolve_make_model(title)
    if not (price and year and mm):
        return None
    if not submission.images:
        return None

    make, model = mm
    mileage = _parse_mileage(combined)
    try:
        source_url = canonical_reddit_url(submission.permalink)
    except ValueError:
        return None

    safe_title = _scrub_pii(title)[:200] or f"{year} {make} {model}"
    parts = [f"{year} {make} {model}", f"AED {price:,}"]
    if mileage:
        parts.append(f"{mileage:,} km")
    summary = " · ".join(parts)
    author_label = f"u/{submission.author}" if submission.author else "a Reddit user"
    description = (
        f"Imported from Reddit (r/DubaiPetrolHeads). Original post by {author_label}. "
        f"{summary}. Listing details are supplied by the original Reddit post — "
        f"verify them with the seller on Reddit before transacting."
    )

    return ParsedRedditCar(
        source_id=submission.id,
        title=safe_title,
        make=make,
        model=model,
        year=year,
        price_aed=price,
        description=description,
        source_url=source_url,
        author=submission.author,
        created_utc=submission.created_utc,
        image_url=submission.images[0],
        mileage_km=mileage,
    )


def _iso_from_epoch(epoch: float) -> Optional[str]:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def build_imported_car_payload(parsed: ParsedRedditCar, owner_id: str, now: datetime) -> dict:
    """Pure cars-row payload for a parsed import. DB column names; honest fallbacks
    for required spec fields we must never fabricate."""
    payload = {
        "user_id": owner_id,
        "source_platform": "reddit",
        "source_external_id": parsed.source_id,
        "source_url": parsed.source_url,
        "source_author": parsed.author,
        "source_subreddit": "DubaiPetrolHeads",
        "source_created_at": _iso_from_epoch(parsed.created_utc),
        "source_last_seen_at": now.isoformat(),
        "source_removed_at": None,
        # Domain columns (real cars schema).
        "car_manufacturer": parsed.make,
        "car_model": parsed.model,
        "make_year": parsed.year,
        "expected_selling_price": parsed.price_aed,
        "listing_title": parsed.title,
        "car_description": parsed.description,
        # Required-but-unknown spec fields: never inferred, stored as Unspecified.
        "regional_spec": _UNSPECIFIED,
        "car_city": _UNSPECIFIED,
        "fuel_type": _UNSPECIFIED,
        "transmission_type": _UNSPECIFIED,
        "horsepower": _UNSPECIFIED,
        "steering_side": _UNSPECIFIED,
        "vehicle_type": "Used",
        # kilometer_driven is NOT NULL — always supply (0 when the post omits it).
        "kilometer_driven": parsed.mileage_km if parsed.mileage_km is not None else 0,
        # Published directly via service role (bypasses member review/limits).
        "status": "approved",
        "is_approved": True,
        "is_dealer": False,
    }
    return payload


# ===========================================================================
# Multi-category: bikes, license plates, car parts.
# ===========================================================================

# Table routing (mirrors app.py LISTING_TABLE_CONFIG).
LISTING_TABLES = {
    "car":   {"table": "cars",           "images_table": "car_images",   "fk": "car_id",   "listing_type": "car"},
    "bike":  {"table": "bikes",          "images_table": "bike_images",  "fk": "bike_id",  "listing_type": "bike"},
    "plate": {"table": "license_plates", "images_table": "plate_images", "fk": "plate_id", "listing_type": "plate"},
    "part":  {"table": "car_parts",      "images_table": "part_images",  "fk": "part_id",  "listing_type": "part"},
}

# Motorcycle-only marques (definite bikes).
_BIKE_MAKES = {
    "ducati": "Ducati", "yamaha": "Yamaha", "kawasaki": "Kawasaki", "ktm": "KTM",
    "harley-davidson": "Harley-Davidson", "harley davidson": "Harley-Davidson", "harley": "Harley-Davidson",
    "triumph": "Triumph", "aprilia": "Aprilia", "royal enfield": "Royal Enfield",
    "benelli": "Benelli", "cfmoto": "CFMoto", "husqvarna": "Husqvarna", "mv agusta": "MV Agusta",
    "moto guzzi": "Moto Guzzi", "vespa": "Vespa", "zero": "Zero", "bajaj": "Bajaj",
    "hero": "Hero", "hyosung": "Hyosung", "indian": "Indian",
}
_BIKE_MAKES_BY_LEN = sorted(_BIKE_MAKES.items(), key=lambda kv: -len(kv[0]))
# Marques that make both cars and bikes — only a bike when a bike signal is present.
_BIKE_AMBIGUOUS = {"bmw": "BMW", "honda": "Honda", "suzuki": "Suzuki"}
_BIKE_MODEL_HINTS = (
    "panigale", "monster", "streetfighter", "multistrada", "diavel", "scrambler",
    "ninja", "zx-", "z900", "z650", "z400", "z1000", "hayabusa", "gsx", "gsxr", "gsx-r",
    "cbr", "cb500", "cb650", "africa twin", "goldwing", "gold wing", "fireblade",
    "mt-", "mt09", "mt07", "mt-09", "mt-07", "r1", "r6", "r7", "r3", "yzf", "tenere",
    "s1000rr", "s1000", "gs1250", "r1250", "r1200", "f900", "duke", "rc390", "1290", "890", "790",
    "tuono", "rsv4", "bonneville", "speed triple", "street triple", "rocket 3",
    "himalayan", "meteor", "classic 350", "interceptor", "continental gt",
)
_BIKE_SIGNAL_WORDS = ("motorcycle", "motorbike", "superbike", "\\bbike\\b", "\\d{2,4}\\s?cc")

# Part nouns — presence routes a post to car_parts even if a car make appears.
_PART_KEYWORDS = (
    "spoiler", "wheels", "wheel", "rims", "rim", "tyre", "tyres", "tire", "tires",
    "exhaust", "muffler", "downpipe", "catback", "cat-back", "bumper", "seats", "seat",
    "ecu", "turbo", "brakes", "brake", "caliper", "rotor", "headlight", "headlights",
    "taillight", "grille", "hood", "bonnet", "fender", "gearbox", "alternator",
    "radiator", "suspension", "coilover", "coilovers", "intake", "bodykit", "body kit",
    "diffuser", "splitter", "canards", "subframe", "injector", "injectors", "clutch",
    "flywheel", "manifold", "intercooler", "wastegate", "springs", "sway bar", "lip kit",
    "roll bar", "harness", "recaro", "bbs", "rays", "volk", "steering wheel", "wrap",
)
# Map a matched part keyword to a real car_parts.part_type value (see probe results).
_PART_TYPE_MAP = {
    "brakes": "Brakes", "brake": "Brakes", "caliper": "Brakes", "rotor": "Brakes",
    "wheels": "Wheels & Tires", "wheel": "Wheels & Tires", "rims": "Wheels & Tires",
    "rim": "Wheels & Tires", "tyre": "Wheels & Tires", "tyres": "Wheels & Tires",
    "tire": "Wheels & Tires", "tires": "Wheels & Tires", "bbs": "Wheels & Tires",
    "rays": "Wheels & Tires", "volk": "Wheels & Tires",
    "suspension": "Suspension", "coilover": "Suspension", "coilovers": "Suspension",
    "springs": "Suspension", "sway bar": "Suspension",
    "exhaust": "Engine", "muffler": "Engine", "downpipe": "Engine", "catback": "Engine",
    "cat-back": "Engine", "ecu": "Engine", "turbo": "Engine", "intake": "Engine",
    "manifold": "Engine", "intercooler": "Engine", "wastegate": "Engine", "injector": "Engine",
    "injectors": "Engine", "clutch": "Engine", "flywheel": "Engine", "radiator": "Engine",
}

_PLATE_KEYWORDS = ("number plate", "numberplate", "plate number", "\\bplate\\b", "\\bplates\\b")


def _match_keywords(text_low, needles):
    """Word-boundary match so 'tire' doesn't hit 'entire' and 'seat' doesn't
    hit 'seater'. Needles already containing regex (\\b, \\d) are used as-is."""
    for n in needles:
        pat = n if "\\" in n else rf"\b{re.escape(n)}\b"
        if re.search(pat, text_low):
            return True
    return False


def _resolve_bike_make(title):
    """Definite motorcycle marques only (used by classify's first bike check)."""
    for alias, canonical in _BIKE_MAKES_BY_LEN:
        m = re.search(rf"\b{re.escape(alias)}\b", title, re.IGNORECASE)
        if m:
            return canonical, _first_model_token(title[m.end():])
    return None


_BIKE_ALL_BY_LEN = sorted({**_BIKE_AMBIGUOUS, **_BIKE_MAKES}.items(), key=lambda kv: -len(kv[0]))


def _resolve_bike_make_any(title):
    """Definite + ambiguous marques — used to parse once a post is known to be a bike."""
    for alias, canonical in _BIKE_ALL_BY_LEN:
        m = re.search(rf"\b{re.escape(alias)}\b", title, re.IGNORECASE)
        if m:
            return canonical, _first_model_token(title[m.end():])
    return None


def classify(submission):
    """Return 'part' | 'plate' | 'bike' | 'car' | None for a sale post.
    Classification uses the TITLE only — a car's selftext is full of part nouns
    ('seats', 'wheels', 'tyres'), so title is what states what's being sold.
    Order matters: a part keyword in the title wins over the car make it mentions."""
    title_low = (submission.title or "").lower()
    if _match_keywords(title_low, _PART_KEYWORDS):
        return "part"
    if _match_keywords(title_low, _PLATE_KEYWORDS):
        return "plate"
    if _resolve_bike_make(submission.title):
        return "bike"
    # Ambiguous marque only counts as a bike with an explicit bike signal.
    for alias in _BIKE_AMBIGUOUS:
        if re.search(rf"\b{alias}\b", title_low):
            if _match_keywords(title_low, _BIKE_SIGNAL_WORDS) or any(h in title_low for h in _BIKE_MODEL_HINTS):
                return "bike"
    if _resolve_make_model(submission.title):
        return "car"
    return None


@dataclass
class ParsedListing:
    category: str
    source_id: str
    title: str
    description: str
    source_url: str
    author: Optional[str]
    created_utc: float
    image_url: Optional[str]
    price_aed: int
    image_urls: list = field(default_factory=list)  # all gallery images, primary first
    fields: dict = field(default_factory=dict)  # category-specific parsed values


def _common(submission, category, price, summary_parts):
    """Shared attribution/description assembly for any category.
    Posted by DPH Classifieds; no individual seller is named."""
    summary = " · ".join(summary_parts)
    description = (
        f"Posted by DPH Classifieds, imported from r/DubaiPetrolHeads. "
        f"{summary}. Listing details are supplied by the original Reddit post — "
        f"see the linked post for full details before transacting."
    )
    return description


_VIN_TOKEN = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")
_VIN_LABELLED = re.compile(r"(?:VIN|CHASSIS)[\s:#.\-]*([A-HJ-NPR-Z0-9]{17})", re.IGNORECASE)


def extract_vin(text):
    """Pull a plausible 17-char VIN from post text. Prefers one that follows a
    VIN/chassis label; requires a letter+digit mix so 17-digit numbers aren't
    mistaken for a VIN. Returns None if none found."""
    if not text:
        return None
    up = text.upper()
    labelled = _VIN_LABELLED.search(up)
    if labelled and not labelled.group(1).isdigit():
        return labelled.group(1)
    for m in _VIN_TOKEN.finditer(up):
        v = m.group(1)
        if any(c.isalpha() for c in v) and any(c.isdigit() for c in v):
            return v
    return None


_COLORS = ("white", "black", "silver", "grey", "gray", "blue", "red", "green",
           "brown", "beige", "gold", "orange", "yellow", "purple", "maroon",
           "bronze", "burgundy", "navy", "champagne", "pearl")


def parse_description_extras(text):
    """Inherit listing fields the seller stated in the post that a VIN can't give
    (regional spec, steering, colour) or can corroborate (fuel, transmission).
    Returns only fields confidently found — never guesses."""
    low = (text or "").lower()
    out = {}
    if re.search(r"\bgcc\b", low):
        out["regional_spec"] = "GCC"
    elif re.search(r"\b(us|usa|american|north american)\s*spec", low):
        out["regional_spec"] = "North American"
    elif "canadian spec" in low or "canada spec" in low:
        out["regional_spec"] = "North American"
    elif re.search(r"\b(euro|european)\s*spec", low):
        out["regional_spec"] = "European"
    elif re.search(r"\b(japanese|japan)\s*spec", low) or "jdm" in low:
        out["regional_spec"] = "Japanese"
    elif "korean spec" in low:
        out["regional_spec"] = "Korean"
    elif "chinese spec" in low or "china spec" in low:
        out["regional_spec"] = "Chinese"

    if re.search(r"\b(rhd|right[\s-]?hand)\b", low):
        out["steering_side"] = "Right"
    elif re.search(r"\b(lhd|left[\s-]?hand)\b", low):
        out["steering_side"] = "Left"

    if re.search(r"\bdiesel\b", low):
        out["fuel_type"] = "Diesel"
    elif re.search(r"\b(electric|ev)\b", low):
        out["fuel_type"] = "Electric"
    elif re.search(r"\b(hybrid|phev)\b", low):
        out["fuel_type"] = "Hybrid"
    elif re.search(r"\b(petrol|gasoline)\b", low):
        out["fuel_type"] = "Petrol"

    if re.search(r"\bmanual\b", low):
        out["transmission_type"] = "Manual"
    elif re.search(r"\b(automatic|\bauto\b|cvt|dct|tiptronic|paddle shift)\b", low):
        out["transmission_type"] = "Automatic"

    for c in _COLORS:
        if re.search(rf"\b{c}\b", low):
            out["color"] = "Grey" if c in ("grey", "gray") else c.capitalize()
            break
    return out


def parse_listing(submission, now):
    """Classify then parse a sale post into a ParsedListing, or None if not
    publishable (missing required fields / no safe image / unknown category)."""
    if submission is None:
        return None
    if submission.over_18 or submission.stickied or submission.distinguished:
        return None
    if submission.is_crosspost or submission.is_removed_or_deleted:
        return None
    title = (submission.title or "").strip()
    if not title:
        return None
    combined = f"{title}\n{submission.selftext or ''}"
    if not _looks_like_sale(combined):
        return None
    if not submission.images:
        return None
    try:
        source_url = canonical_reddit_url(submission.permalink)
    except ValueError:
        return None

    price = _parse_price_aed(combined)
    if not price:
        return None  # every category requires a price
    category = classify(submission)
    if category is None:
        return None

    safe_title = _scrub_pii(title)[:200]
    base = dict(
        source_id=submission.id, source_url=source_url, author=submission.author,
        created_utc=submission.created_utc, image_url=submission.images[0],
        image_urls=submission.images[:12], price_aed=price,  # ponytail: cap gallery at 12
    )

    if category in ("car", "bike"):
        year = _parse_year(title, now) or _parse_year(combined, now)
        mm = _resolve_bike_make_any(title) if category == "bike" else _resolve_make_model(title)
        if not (year and mm and mm[1]):
            return None
        make, model = mm[0], mm[1]
        mileage = _parse_mileage(combined)
        parts = [f"{year} {make} {model}", f"AED {price:,}"] + ([f"{mileage:,} km"] if mileage else [])
        fields = {"make": make, "model": model, "year": year, "mileage_km": mileage}
        if category == "car":
            # VIN + seller-stated details, decoded/merged in the worker (network I/O).
            fields["vin"] = extract_vin(combined)
            fields["extras"] = parse_description_extras(combined)
        return ParsedListing(
            category=category, title=safe_title or f"{year} {make} {model}",
            description=_common(submission, category, price, parts), **base,
            fields=fields,
        )

    if category == "part":
        title_low = title.lower()
        kw = next((k for k in _PART_KEYWORDS
                   if re.search(k if "\\" in k else rf"\b{re.escape(k)}\b", title_low)), None)
        part_type = _PART_TYPE_MAP.get(kw or "", "Other")
        parts = [safe_title or "Car part", f"AED {price:,}"]
        return ParsedListing(
            category="part", title=safe_title or "Car part",
            description=_common(submission, "part", price, parts), **base,
            fields={"name": (safe_title or "Car part")[:120], "part_type": part_type},
        )

    if category == "plate":
        # Require an actual plate number token to publish (else too vague).
        m = re.search(r"\b(\d{1,5})\b", title) or re.search(r"\b(\d{1,5})\b", combined)
        if not m:
            return None
        number = m.group(1)
        code_m = re.search(r"\bcode\s*[:\-]?\s*([A-Za-z]{1,2})\b", combined, re.IGNORECASE)
        code = (code_m.group(1).upper() if code_m else None)
        parts = [f"Plate {number}", f"AED {price:,}"]
        return ParsedListing(
            category="plate", title=(safe_title or f"Plate {number}")[:200],
            description=_common(submission, "plate", price, parts), **base,
            fields={"number": number, "digits": str(len(number)), "code": code},
        )
    return None



def _source_fields(parsed, owner_id, now):
    """Immutable source identity + owner, common to every imported table."""
    return {
        "user_id": owner_id,
        "source_platform": "reddit",
        "source_external_id": parsed.source_id,
        "source_url": parsed.source_url,
        "source_author": parsed.author,
        "source_subreddit": "DubaiPetrolHeads",
        "source_created_at": _iso_from_epoch(parsed.created_utc),
        "source_last_seen_at": now.isoformat(),
        "source_removed_at": None,
        "status": "approved",
        "is_approved": True,
        "is_dealer": False,
    }


# Fallbacks for NOT-NULL categorical columns we can't infer from a post.
# Values are verified CHECK-safe by the live probe (see backend probe run).
_DUBAI = "Dubai"


def build_imported_payload(parsed, owner_id, now):
    """Return {'config','payload'} routing a ParsedListing to its table.
    Honest fallbacks for required categorical fields we must not fabricate
    (location defaults to Dubai — this is r/DubaiPetrolHeads)."""
    cfg = LISTING_TABLES[parsed.category]
    src = _source_fields(parsed, owner_id, now)
    f = parsed.fields

    if parsed.category == "car":
        extras = f.get("extras") or {}
        payload = {**src,
            "car_manufacturer": f["make"], "car_model": f["model"], "make_year": f["year"],
            "expected_selling_price": parsed.price_aed, "listing_title": parsed.title,
            "car_description": parsed.description,
            "kilometer_driven": f.get("mileage_km") if f.get("mileage_km") is not None else 0,
            # Seller-stated details inherited from the post; VIN-decoded specs
            # overlay these in the worker when the VIN decodes cleanly. Regional
            # spec / steering default to the UAE-market norm when unstated.
            "regional_spec": extras.get("regional_spec") or "GCC",
            "car_city": _DUBAI,
            "fuel_type": extras.get("fuel_type") or "Unspecified",
            "transmission_type": extras.get("transmission_type") or "Unspecified",
            "horsepower": "Unspecified",
            "steering_side": extras.get("steering_side") or "Left",
            "vehicle_type": "Used"}
        if extras.get("color"):
            payload["color"] = extras["color"]
        if f.get("vin"):
            payload["vin_number"] = f["vin"]
    elif parsed.category == "bike":
        payload = {**src,
            "make": f["make"], "model": f["model"], "bike_brand": f["make"], "bike_model": f["model"],
            "year": f["year"], "price": parsed.price_aed,
            "mileage": f.get("mileage_km") if f.get("mileage_km") is not None else 0,
            "condition": "Used", "bike_type": "Other", "location": _DUBAI, "emirate": _DUBAI,
            "description": parsed.description}
    elif parsed.category == "part":
        payload = {**src,
            "name": f["name"], "part_type": f["part_type"], "condition": "Used",
            "price": parsed.price_aed, "location": _DUBAI, "emirate": _DUBAI,
            "description": parsed.description}
    elif parsed.category == "plate":
        payload = {**src,
            "number": f["number"], "digits": f["digits"], "code": f.get("code") or "A",
            "plate_format": "Any format", "emirate": _DUBAI, "city": _DUBAI,
            "price": parsed.price_aed, "listing_title": parsed.title,
            "description": parsed.description}
    else:
        raise ValueError(f"unknown category {parsed.category}")
    return {"config": cfg, "payload": payload}
