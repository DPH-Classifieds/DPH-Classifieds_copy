import copy
import logging
import os
import re
import time

import requests

logger = logging.getLogger(__name__)

DEFAULT_DECODER_BASE_URL = (
    "https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended"
)
VIN_ALLOWED_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
TRANSLITERATION = {
    **dict.fromkeys("AJS", 1),
    **dict.fromkeys("BKT", 2),
    **dict.fromkeys("CLU", 3),
    **dict.fromkeys("DMV", 4),
    **dict.fromkeys("ENW", 5),
    **dict.fromkeys("FOX", 6),
    **dict.fromkeys("GPY", 7),
    **dict.fromkeys("HQZ", 8),
    **dict.fromkeys("IR", 9),
}
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
_VIN_CACHE = {}

# Position 10 (index 9) encodes model year per ISO 3779 (30-year cycle from 1980)
_YEAR_CODES = {
    **{c: 1980 + i for i, c in enumerate("ABCDEFGHJKLMNPRSTV")},
    **{c: 1998 + i for i, c in enumerate("WXYZ")},  # W=1998,X=1999,Y=2000
    **{str(d): 2001 + d - 1 for d in range(1, 10)},  # 1=2001..9=2009
}
# Second 30-year cycle (2010+) shares letters A-Y
_YEAR_CODES_2010 = {c: y + 30 for c, y in _YEAR_CODES.items() if isinstance(c, str) and c.isalpha()}


def decode_vin_year(vin):
    """Return (base_year, base_year+30) possible model years from VIN position 10, or None."""
    vin = str(vin or "").upper()
    if len(vin) != 17:
        return None
    code = vin[9]
    base = _YEAR_CODES.get(code)
    if base is None:
        return None
    alt = _YEAR_CODES_2010.get(code)
    return (base, alt) if alt else (base,)


class VINDecoder:
    def __init__(
        self,
        decoder_url=None,
        decoder_base_url=None,
        timeout=None,
        session=None,
        cache=None,
        cache_ttl_seconds=None,
        max_cache_entries=None,
        clock=None,
    ):
        self.decoder_url = decoder_url or os.getenv("VIN_DECODER_URL")
        self.decoder_base_url = (
            decoder_base_url
            or os.getenv("VIN_DECODER_BASE_URL")
            or DEFAULT_DECODER_BASE_URL
        )
        self.timeout = timeout or float(os.getenv("VIN_DECODER_TIMEOUT_SECONDS", "6"))
        self.session = session or requests.Session()
        self.cache = _VIN_CACHE if cache is None else cache
        self.cache_ttl_seconds = (
            cache_ttl_seconds
            if cache_ttl_seconds is not None
            else int(os.getenv("VIN_DECODER_CACHE_TTL_SECONDS", "86400"))
        )
        self.max_cache_entries = (
            max_cache_entries
            if max_cache_entries is not None
            else int(os.getenv("VIN_DECODER_MAX_CACHE_ENTRIES", "1000"))
        )
        self.clock = clock or time.time

    def validate_and_decode(self, vin):
        normalized_vin = self.normalize_vin(vin)
        cached = self._get_cached(normalized_vin)
        if cached is not None:
            return copy.deepcopy(cached)

        base_result = {
            "vin": normalized_vin,
            "valid": False,
            "is_valid": False,
            "checksum_valid": False,
            "decoded": {},
            "errors": [],
        }

        if not VIN_ALLOWED_RE.match(normalized_vin):
            base_result["errors"].append("invalid_format")
            return self._cache(normalized_vin, base_result)

        base_result["vin_year_candidates"] = decode_vin_year(normalized_vin)
        checksum_valid = self.is_checksum_valid(normalized_vin)
        base_result["checksum_valid"] = checksum_valid
        if not checksum_valid:
            base_result["errors"].append("invalid_checksum")
            return self._cache(normalized_vin, base_result)

        remote = self._remote_decode(normalized_vin)
        base_result["decoded"] = remote["decoded"]
        base_result["errors"].extend(remote["errors"])
        base_result["is_valid"] = not base_result["errors"]
        base_result["valid"] = base_result["is_valid"]
        if "decoder_unavailable" in base_result["errors"]:
            return copy.deepcopy(base_result)
        return self._cache(normalized_vin, base_result)

    def _cache(self, vin, result):
        self.cache[vin] = {
            "expires_at": self.clock() + self.cache_ttl_seconds,
            "result": copy.deepcopy(result),
        }
        self._enforce_cache_bound()
        return copy.deepcopy(result)

    def _enforce_cache_bound(self):
        while self.max_cache_entries > 0 and len(self.cache) > self.max_cache_entries:
            oldest_key = next(iter(self.cache))
            self.cache.pop(oldest_key, None)

    def _get_cached(self, vin):
        cached = self.cache.get(vin)
        if cached is None:
            return None
        if "result" not in cached or "expires_at" not in cached:
            return copy.deepcopy(cached)
        if cached["expires_at"] <= self.clock():
            self.cache.pop(vin, None)
            return None
        return copy.deepcopy(cached["result"])

    @staticmethod
    def normalize_vin(vin):
        return re.sub(r"[^A-Z0-9]", "", str(vin or "").upper())

    @staticmethod
    def is_checksum_valid(vin):
        if not VIN_ALLOWED_RE.match(vin):
            return False
        # ponytail: checksum is NHTSA/NA-only (WMI 1-5); skip for JDM/EU/GCC-market VINs
        if vin[0] not in "12345":
            return True
        total = 0
        for char, weight in zip(vin, WEIGHTS):
            value = int(char) if char.isdigit() else TRANSLITERATION[char]
            total += value * weight
        remainder = total % 11
        expected = "X" if remainder == 10 else str(remainder)
        return vin[8] == expected

    def _remote_decode(self, vin):
        try:
            url, params = self._decoder_request(vin)
            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            logger.warning("VIN decoder lookup failed for %s: %s", vin, exc)
            return {
                "decoded": {},
                "errors": ["decoder_unavailable"],
            }

        result = {}
        if isinstance(payload, dict):
            rows = payload.get("Results") or []
            if rows:
                result = rows[0] or {}

        decoded = {
            "make": result.get("Make") or result.get("make"),
            "model": result.get("Model") or result.get("model"),
            "year": result.get("ModelYear") or result.get("year"),
            "model_year": result.get("ModelYear") or result.get("model_year"),
        }
        decoded = {key: value for key, value in decoded.items() if value}

        errors = []
        error_code = str(result.get("ErrorCode") or "").strip()
        # ponytail: NHTSA can return multi-code like "0,6"; valid if any code is "0"
        if error_code and not any(c.strip() in {"0", "00"} for c in error_code.split(",")):
            errors.append("decoder_error")
        if not decoded:
            errors.append("decoder_empty")

        return {
            "decoded": decoded,
            "errors": errors,
        }

    def _decoder_request(self, vin):
        if self.decoder_url:
            url = self.decoder_url.format(vin=vin)
            params = None if "format=" in url.lower() else {"format": "json"}
            return url, params
        return f"{self.decoder_base_url.rstrip('/')}/{vin}", {"format": "json"}
