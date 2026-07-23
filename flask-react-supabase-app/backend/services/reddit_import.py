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
    # De-dup preserving order.
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


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
    # "AED 85,000" / "85,000 AED" / "aed85000"
    for m in re.finditer(r"(?:aed|dhs?|dirhams?)\s*([\d,]{3,})|([\d,]{4,})\s*(?:aed|dhs?|dirhams?)", low):
        raw = m.group(1) or m.group(2) or ""
        digits = raw.replace(",", "")
        if digits.isdigit():
            val = int(digits)
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
        # Published directly via service role (bypasses member review/limits).
        "status": "approved",
        "is_approved": True,
        "is_dealer": False,
    }
    if parsed.mileage_km is not None:
        payload["kilometer_driven"] = parsed.mileage_km
    return payload
