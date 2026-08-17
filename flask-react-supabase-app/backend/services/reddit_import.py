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

import html
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
# Our own Devvit/bot accounts. A post authored by one of these (or linking back
# to the site) must never be re-imported — closes the loop even though today's
# roundup posts already fail the image/WTS gate below.
_SELF_ORIGIN_AUTHORS = {"dphclassifieds", "dphclassifieds-web", "dph-classifieds-web", "dph-bot"}
_SELF_ORIGIN_DOMAIN = "dphclassifieds.com"
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
    link_flair_text: Optional[str] = None

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
            link_flair_text=data.get("link_flair_text"),
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
    vin: Optional[str] = None
    regional_spec: Optional[str] = None


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


def get_user_access_token(session: requests.Session, client_id: str, client_secret: str,
                          refresh_token: str, user_agent: str) -> str:
    """User-context token via refresh_token grant. Unlike the app-only
    client_credentials token, this carries the DPH account's identity and can
    write (submit posts). Obtain the refresh_token once via
    scripts/reddit_get_refresh_token.py; it does not expire."""
    response = session.post(
        TOKEN_URL,
        auth=(client_id, client_secret),
        data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        headers={"User-Agent": user_agent},
        timeout=20,
    )
    response.raise_for_status()
    token = (response.json() or {}).get("access_token")
    if not token:
        raise ValueError("reddit token response missing access_token")
    return token


def submit_self_post(session, access_token, subreddit, title, body_md, user_agent, flair_id=None):
    """Submit a self (text) post. Returns {"id": t3_..., "url": ...}. Raises on
    Reddit-reported errors (e.g. RATELIMIT, SUBREDDIT_REQUIRED_FLAIR)."""
    data = {
        "sr": subreddit, "kind": "self", "api_type": "json",
        "title": (title or "")[:300], "text": body_md or "",
        "resubmit": "true", "sendreplies": "false",
    }
    if flair_id:
        data["flair_id"] = flair_id
    response = session.post(
        f"{OAUTH_BASE_URL}/api/submit",
        data=data,
        headers={"Authorization": f"Bearer {access_token}", "User-Agent": user_agent},
        timeout=20,
    )
    response.raise_for_status()
    payload = (response.json() or {}).get("json") or {}
    errors = payload.get("errors") or []
    if errors:
        raise ValueError(f"reddit submit errors: {errors}")
    out = payload.get("data") or {}
    return {"id": out.get("name") or out.get("id"), "url": out.get("url")}


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


def _scrub_pii_keep_lines(text: str) -> str:
    """Like _scrub_pii but preserves the post's line breaks so the stored
    description renders with the same layout as the original Reddit post.
    Reddit selftext arrives HTML-escaped (&amp;, &#39;, &#x200B;) — decode it so
    the listing shows exactly what the poster wrote."""
    text = html.unescape(text or "")
    text = text.replace("\u200b", "").replace("\r\n", "\n").replace("\r", "\n")
    text = _URL_RE.sub(" ", text)
    text = _EMAIL_RE.sub(" ", text)
    text = _PHONE_RE.sub(" ", text)
    text = re.sub(r"[ \t]+", " ", text)      # collapse spaces/tabs, keep newlines
    text = re.sub(r"\n[ \t]+", "\n", text)   # trim leading space on each line
    text = re.sub(r"\n{3,}", "\n\n", text)   # cap blank-line runs
    return text.strip()


def _in_price_range(digits: str) -> Optional[int]:
    digits = digits.replace(",", "").replace(" ", "")
    if digits.isdigit() and MIN_PRICE_AED <= int(digits) <= MAX_PRICE_AED:
        return int(digits)
    return None


def _parse_price_aed(text: str) -> Optional[int]:
    low = text.lower()
    # 1. Explicit "Price:" label is the most reliable signal in these structured
    #    posts. Handles "Price: AED 325,000 [neg]" and "Price: 12,000 AED".
    m = re.search(r"price[^\dA-Za-z]{0,4}(?:aed|dhs?|dirhams?)?\s*([\d][\d,]*\d)", low)
    if m:
        val = _in_price_range(m.group(1))
        if val:
            return val
    # 2. "AED 85,000" prefixed — unambiguous.
    m = re.search(r"(?:aed|dhs?|dirhams?)\s*([\d,]{3,})", low)
    if m:
        val = _in_price_range(m.group(1))
        if val:
            return val
    # 3. "85,000 AED" suffix. A bare 4-digit token with no separator that looks
    #    like a model year is not a price ("2022 AED" -> skip).
    for m in re.finditer(r"([\d,]{3,})\s*(?:aed|dhs?|dirhams?)", low):
        raw = m.group(1)
        digits = raw.replace(",", "")
        if "," not in raw and len(digits) == 4 and digits.isdigit() and MIN_YEAR <= int(digits) <= 2100:
            continue
        val = _in_price_range(raw)
        if val:
            return val
    # 4. "AED 85k" / "85k AED" thousands shorthand — ONLY next to an AED cue, so a
    #    mileage like "64k kms" is never mistaken for a price.
    m = re.search(r"(?:aed|dhs?|dirhams?)\s*(\d{1,4})\s?k\b", low) or re.search(
        r"(\d{1,4})\s?k\s*(?:aed|dhs?|dirhams?)", low
    )
    if m:
        val = int(m.group(1)) * 1000
        if MIN_PRICE_AED <= val <= MAX_PRICE_AED:
            return val
    # 5. Bare thousands shorthand "85k" / "85 K" with NO currency cue — accept only
    #    when it is NOT a mileage figure (km/kms/kilometre/miles right after), so a
    #    real price like "…120i 85k" imports but "64k kms" stays mileage.
    for m in re.finditer(r"(?<!\d)(\d{1,4})\s?k\b(?!\s*(?:km|kilomet|mile|mi\b))", low):
        val = int(m.group(1)) * 1000
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
    # 1. Labeled odometer/mileage is the reliable signal ("Odometer: 71,350",
    #    "Mileage: 239,000 km"). Beats an in-body "service done at 64k kms".
    m = re.search(r"(?:odometer|mileage|kms?\s*driven)\s*[:\-]?\s*([\d][\d,]*\d)", low)
    if m:
        digits = m.group(1).replace(",", "")
        if digits.isdigit() and 0 < int(digits) <= 2_000_000:
            return int(digits)
    # 2. "88k km" shorthand.
    m = re.search(r"(\d{1,4})\s?k\s?(?:km|kms)\b", low)
    if m:
        return int(m.group(1)) * 1000
    # 3. Plain "239,000 km".
    m = re.search(r"([\d,]{2,})\s?(?:km|kms|kilometres|kilometers)\b", low)
    if m:
        digits = m.group(1).replace(",", "")
        if digits.isdigit() and 0 < int(digits) <= 2_000_000:
            return int(digits)
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


# Multi-word models the single-token grab would otherwise truncate
# ("Land Cruiser" -> "Land"). Longest first so "Range Rover Sport" wins.
_MULTIWORD_MODELS = sorted((
    "land cruiser prado", "range rover sport", "range rover velar",
    "range rover evoque", "grand cherokee", "grand wagoneer", "grand vitara",
    "grand carnival", "land cruiser", "range rover", "santa fe", "fj cruiser",
    "model 3", "model s", "model x", "model y", "c class", "e class", "s class",
    "g class", "gt coupe", "grand caravan", "outlander phev",
), key=len, reverse=True)


def _first_model_token(tail: str) -> Optional[str]:
    low_tail = " ".join(tail.lower().split())
    for mw in _MULTIWORD_MODELS:
        if low_tail == mw or low_tail.startswith(mw + " "):
            return mw.title()
    # NOTE: hyphen intentionally NOT a separator, so "CX-5", "CR-V", "F-Pace",
    # "X-Trail" survive intact instead of truncating to "CX"/"CR"/"F"/"X".
    for tok in re.split(r"[\s/,:;–—|()]+", tail):
        cleaned = tok.strip().strip(".!?").strip("-")
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


def _is_wts_flair(submission) -> bool:
    """Only import posts on the subreddit's Selling (WTS) flair."""
    flair = str(getattr(submission, "link_flair_text", "") or "").strip().lower()
    if "wts" in flair or "sell" in flair:
        return True
    # Flair is often unset on older posts; the format also mandates a WTS: title.
    return str(getattr(submission, "title", "") or "").strip().lower().startswith("wts")


_LABEL_VALUE_RE_CACHE = {}
_VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")


def _labeled(text: str, *labels: str) -> Optional[str]:
    """Return the value after a 'Label:' line in the standard sell format.

    Tolerates leading bullets/spaces ("• Make: Toyota") and both ':' and '-'.
    """
    for label in labels:
        m = re.search(rf"(?im)^[\s•\-\*]*{re.escape(label)}\s*[:\-]\s*(.+?)\s*$", text or "")
        if m:
            val = m.group(1).strip()
            if val and val.lower() not in ("n/a", "na", "-", "none"):
                return val
    return None


def _labeled_make(text: str) -> Optional[str]:
    raw = _labeled(text, "make", "brand")
    if not raw:
        return None
    low = raw.lower()
    for alias, canonical in _MAKE_ALIASES_BY_LEN:
        if alias in low:
            return canonical
    return None  # unknown label -> caller falls back to the title


def _labeled_year(text: str, now: datetime) -> Optional[int]:
    raw = _labeled(text, "year")
    if raw:
        m = re.search(r"\d{4}", raw)
        if m:
            year = int(m.group())
            if MIN_YEAR <= year <= now.year + 1:
                return year
    return None


def _labeled_regional_spec(text: str) -> Optional[str]:
    raw = _labeled(text, "regional spec", "regional specs", "spec", "specs")
    if not raw:
        return None
    low = raw.lower()
    if "gcc" in low:
        return "GCC"
    if "american" in low or low.strip() == "us" or "usa" in low:
        return "American"
    if "euro" in low:
        return "European"
    if "japan" in low:
        return "Japanese"
    if "canad" in low:
        return "Canadian"
    return raw[:40]


def _extract_vin(text: str) -> Optional[str]:
    candidate = _labeled(text, "vin", "chassis", "chassis number") or ""
    m = _VIN_RE.search(candidate) or _VIN_RE.search(text or "")
    return m.group(1).upper() if m else None


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

    # Only import posts on the Selling (WTS) flair, per the subreddit's format.
    if not _is_wts_flair(submission):
        return None

    selftext = submission.selftext or ""
    combined = f"{title}\n{selftext}"
    if not _looks_like_sale(combined):
        return None

    # Prefer the standard-format labels ("Make:", "Model:", "Year:") — they carry
    # the full value (e.g. "Camry SE") — falling back to title parsing.
    mm = _resolve_make_model(title)
    make = _labeled_make(selftext) or (mm[0] if mm else None)
    model = _labeled(selftext, "model") or (mm[1] if mm else None)
    if model:
        model = model[:100]
    year = _labeled_year(selftext, now) or _parse_year(title, now) or _parse_year(combined, now)
    price = _parse_price_aed(combined)
    if not (price and year and make and model):
        return None
    if not submission.images:
        return None

    vin = _extract_vin(selftext)
    regional_spec = _labeled_regional_spec(selftext)
    mileage = _parse_mileage(combined)
    try:
        source_url = canonical_reddit_url(submission.permalink)
    except ValueError:
        return None

    safe_title = _scrub_pii(title)[:200] or f"{year} {make} {model}"
    # The description is the original post body, verbatim (PII scrubbed, line
    # breaks kept). Fall back to a short summary only when the post has no body.
    body = _scrub_pii_keep_lines(submission.selftext or "")[:5000]
    if body:
        description = body
    else:
        parts = [f"{year} {make} {model}", f"AED {price:,}"]
        if mileage:
            parts.append(f"{mileage:,} km")
        description = " · ".join(parts)

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
        vin=vin,
        regional_spec=regional_spec,
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
        # From the post's labels when present, else honest Unspecified.
        "regional_spec": parsed.regional_spec or _UNSPECIFIED,
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
    if parsed.vin:
        payload["vin_number"] = parsed.vin
    # Mark post-supplied fields so VIN decode fills only the gaps, never overrides
    # what the seller explicitly wrote.
    sources = {"car_manufacturer": "post", "car_model": "post", "make_year": "post"}
    if parsed.regional_spec:
        sources["regional_spec"] = "post"
    payload["import_field_sources"] = sources
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


def _first_keyword_pos(text_low, needles):
    """Start index of the earliest matching needle in text_low, else None."""
    best = None
    for n in needles:
        pat = n if "\\" in n else rf"\b{re.escape(n)}\b"
        m = re.search(pat, text_low)
        if m and (best is None or m.start() < best):
            best = m.start()
    return best


def _vehicle_identity_pos(title, title_low, now):
    """Earliest index of a plausible model-year or a car make alias in the title."""
    positions = []
    for m in re.finditer(r"(?<!\d)(\d{4})(?!\d)", title):
        if MIN_YEAR <= int(m.group(1)) <= now.year + 1:
            positions.append(m.start())
            break
    for alias, _canon in _MAKE_ALIASES_BY_LEN:
        m = re.search(rf"\b{re.escape(alias)}\b", title_low)
        if m:
            positions.append(m.start())
            break
    return min(positions) if positions else None


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


def classify(submission, now):
    """Return 'part' | 'plate' | 'bike' | 'car' | None for a sale post.
    Classification uses the TITLE only — a car's selftext is full of part nouns
    ('seats', 'wheels', 'tyres'), so title is what states what's being sold.
    Precedence: a complete, title-leading vehicle identity (make + model + a
    model-year) beats an incidental part noun, so '2019 Nissan Patrol, new tyres
    & brakes' is a car; a post that LEADS with the part ('Recaro seats for 2019
    Patrol') stays a part."""
    title = submission.title or ""
    title_low = title.lower()
    part_pos = _first_keyword_pos(title_low, _PART_KEYWORDS)
    plate_pos = _first_keyword_pos(title_low, _PLATE_KEYWORDS)
    car_mm = _resolve_make_model(title)
    year = _parse_year(title, now)
    car_pos = _vehicle_identity_pos(title, title_low, now)
    # A complete, title-leading vehicle wins over an incidental part word.
    # ponytail: naive position rule; a genuine 'YEAR MAKE MODEL <part>' parts post
    # (e.g. '2008 BMW M3 wheels') still reads as a car. Upgrade path: a dedicated
    # Parts flair, or require the part word not to immediately follow the model.
    car_wins = bool(
        car_mm and year and car_pos is not None
        and (part_pos is None or car_pos <= part_pos)
    )
    if part_pos is not None and not car_wins:
        return "part"
    if plate_pos is not None:
        return "plate"
    if _resolve_bike_make(title):
        return "bike"
    # Ambiguous marque only counts as a bike with an explicit bike signal.
    for alias in _BIKE_AMBIGUOUS:
        if re.search(rf"\b{alias}\b", title_low):
            if _match_keywords(title_low, _BIKE_SIGNAL_WORDS) or any(h in title_low for h in _BIKE_MODEL_HINTS):
                return "bike"
    if car_mm:
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

    m = re.search(r"\b(\d\.\d)\s*(?:l|litre|liter)\b", low)
    if m:
        out["engine_capacity"] = f"{m.group(1)}L"
    m = (re.search(r"\bv(\d{1,2})\b", low) or re.search(r"\b(\d{1,2})\s*(?:cyl|cylinder)", low)
         or re.search(r"\binline[\s-]?(\d)\b", low))
    if m:
        try:
            n = int(m.group(1))
            if 2 <= n <= 16:
                out["cylinders"] = n
        except ValueError:
            pass
    m = re.search(r"\b([2-5])\s*[-\s]?door\b", low) or re.search(r"\b([2-5])dr\b", low)
    if m:
        out["doors"] = int(m.group(1))
    if re.search(r"\bfull service history\b|\bfsh\b|\bfully? serviced\b|\bagency (?:service|maintained|serviced)\b|\bdealer (?:serviced|maintained)\b", low):
        out["service_history"] = "Full service history"
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
    if (submission.author or "").strip().lower() in _SELF_ORIGIN_AUTHORS:
        return None
    title = (submission.title or "").strip()
    if not title:
        return None
    combined = f"{title}\n{submission.selftext or ''}"
    if _SELF_ORIGIN_DOMAIN in combined.lower():
        return None
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
    category = classify(submission, now)
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
        for k in ("engine_capacity", "cylinders", "doors", "service_history"):
            if extras.get(k) is not None:
                payload[k] = extras[k]
        if f.get("vin"):
            payload["vin_number"] = f["vin"]
        # Provenance: where each field came from. The worker flips fields it
        # overwrites from a clean VIN decode to 'vin'.
        sources = {"car_manufacturer": "title", "car_model": "title", "make_year": "title",
                   "expected_selling_price": "post", "listing_title": "post",
                   "regional_spec": "description" if extras.get("regional_spec") else "default",
                   "steering_side": "description" if extras.get("steering_side") else "default",
                   "car_city": "default", "vehicle_type": "default"}
        if f.get("mileage_km") is not None:
            sources["kilometer_driven"] = "description"
        for k in ("fuel_type", "transmission_type", "color", "engine_capacity",
                  "cylinders", "doors", "service_history"):
            if extras.get(k) is not None:
                sources[k] = "description"
        if f.get("vin"):
            sources["vin_number"] = "post"
        payload["import_field_sources"] = sources
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
