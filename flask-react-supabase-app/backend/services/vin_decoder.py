import copy
import logging
import os
import re

import requests

logger = logging.getLogger(__name__)

DEFAULT_DECODER_URL = (
    "https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/{vin}?format=json"
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


class VINDecoder:
    def __init__(
        self,
        decoder_url=None,
        timeout=None,
        session=None,
        cache=None,
    ):
        self.decoder_url = decoder_url or os.getenv("VIN_DECODER_URL", DEFAULT_DECODER_URL)
        self.timeout = timeout or float(os.getenv("VIN_DECODER_TIMEOUT_SECONDS", "6"))
        self.session = session or requests.Session()
        self.cache = _VIN_CACHE if cache is None else cache

    def validate_and_decode(self, vin):
        normalized_vin = self.normalize_vin(vin)
        cached = self.cache.get(normalized_vin)
        if cached is not None:
            return copy.deepcopy(cached)

        base_result = {
            "vin": normalized_vin,
            "is_valid": False,
            "checksum_valid": False,
            "decoded": {},
            "errors": [],
        }

        if not VIN_ALLOWED_RE.match(normalized_vin):
            base_result["errors"].append("invalid_format")
            return self._cache(normalized_vin, base_result)

        checksum_valid = self.is_checksum_valid(normalized_vin)
        base_result["checksum_valid"] = checksum_valid
        if not checksum_valid:
            base_result["errors"].append("invalid_checksum")
            return self._cache(normalized_vin, base_result)

        remote = self._remote_decode(normalized_vin)
        base_result["decoded"] = remote["decoded"]
        base_result["errors"].extend(remote["errors"])
        base_result["is_valid"] = not base_result["errors"]
        return self._cache(normalized_vin, base_result)

    def _cache(self, vin, result):
        self.cache[vin] = copy.deepcopy(result)
        return copy.deepcopy(result)

    @staticmethod
    def normalize_vin(vin):
        return re.sub(r"[^A-Z0-9]", "", str(vin or "").upper())

    @staticmethod
    def is_checksum_valid(vin):
        if not VIN_ALLOWED_RE.match(vin):
            return False
        total = 0
        for char, weight in zip(vin, WEIGHTS):
            value = int(char) if char.isdigit() else TRANSLITERATION[char]
            total += value * weight
        remainder = total % 11
        expected = "X" if remainder == 10 else str(remainder)
        return vin[8] == expected

    def _remote_decode(self, vin):
        try:
            response = self.session.get(
                self.decoder_url.format(vin=vin),
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
        }
        decoded = {key: value for key, value in decoded.items() if value}

        errors = []
        error_code = str(result.get("ErrorCode") or "").strip()
        if error_code and error_code not in {"0", "00"}:
            errors.append("decoder_error")
        if not decoded:
            errors.append("decoder_empty")

        return {
            "decoded": decoded,
            "errors": errors,
        }
