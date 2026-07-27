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
        # Guarantee a make from the WMI when NHTSA has no record (Chinese/GCC-only).
        if not base_result["decoded"].get("make"):
            wmi_make = vin_manufacturer(normalized_vin)
            if wmi_make:
                base_result["decoded"]["make"] = wmi_make
                base_result["decoded"]["make_source"] = "wmi"
        base_result["decoded"]["country"] = vin_country(normalized_vin)
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
    def is_checksum_applicable(vin):
        """Whether the ISO 3779 mod-11 check digit is actually verifiable for
        this VIN. It's an NHTSA/North-America regulatory requirement (49 CFR
        565), not a global one — most JDM/EU/GCC manufacturers don't
        necessarily compute position 9 this way. `is_checksum_valid` returns
        True (unverifiable, not "confirmed correct") for these to avoid
        false-rejecting genuine non-NA VINs; callers deciding whether to
        *trust* a checksum pass (e.g. guessing a repair, or auto-filling
        without review) must check this first.
        """
        return bool(vin) and vin[0] in "12345"

    @staticmethod
    def is_checksum_valid(vin):
        if not VIN_ALLOWED_RE.match(vin):
            return False
        if not VINDecoder.is_checksum_applicable(vin):
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
            # Extended fields used to auto-fill a car listing's spec section.
            "trim": result.get("Trim") or result.get("Trim2"),
            "series": result.get("Series") or result.get("Series2"),
            "body_class": result.get("BodyClass"),
            "vehicle_type": result.get("VehicleType"),
            "fuel_primary": result.get("FuelTypePrimary"),
            "fuel_secondary": result.get("FuelTypeSecondary"),
            "electrification": result.get("ElectrificationLevel"),
            "cylinders": result.get("EngineCylinders"),
            "displacement_l": result.get("DisplacementL"),
            "drive_type": result.get("DriveType"),
            "transmission_style": result.get("TransmissionStyle"),
            "engine_hp": result.get("EngineHP"),
            "doors": result.get("Doors"),
            "seats": result.get("Seats"),
            "plant_country": result.get("PlantCountry"),
        }
        decoded = {key: value for key, value in decoded.items() if value and str(value).strip()}

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


# --- Local, offline VIN structure decode (works for ANY market) -------------
# WMI first char -> region/country of manufacture (ISO 3780). A weak signal for
# a listing, but guarantees an origin even when NHTSA can't decode a GCC/JDM VIN.
_WMI_REGION = {
    "1": "USA", "4": "USA", "5": "USA", "7": "USA", "2": "Canada", "3": "Mexico",
    "6": "Australia", "8": "Argentina", "9": "Brazil",
    "J": "Japan", "K": "South Korea", "L": "China", "M": "India", "N": "Turkey",
    "R": "Taiwan", "S": "United Kingdom", "T": "Europe", "U": "Romania",
    "V": "Europe", "W": "Germany", "X": "Russia", "Y": "Sweden", "Z": "Italy",
}


def vin_country(vin):
    """Country/region of manufacture from the WMI (VIN char 1). Universal."""
    v = str(vin or "").upper()
    if not VIN_ALLOWED_RE.match(v):
        return None
    return _WMI_REGION.get(v[0])


# WMI (VIN chars 1-3) -> manufacturer. Guarantees a make even when NHTSA has no
# record (e.g. Chinese/GCC-only vehicles). Focused on the UAE market + globals;
# unknown prefixes fall back to country only. Keyed by 3-char, then 2-char.
_WMI_MAKE = {
    # Japan
    "JT": "Toyota", "JTD": "Toyota", "JTE": "Toyota", "JTM": "Toyota", "JF1": "Subaru",
    "JF2": "Subaru", "JTH": "Lexus", "JTJ": "Lexus", "JTG": "Lexus", "JN": "Nissan",
    "JN1": "Nissan", "JN6": "Nissan", "JN8": "Nissan", "JNK": "Infiniti", "JNR": "Infiniti",
    "JHM": "Honda", "JHL": "Honda", "JHG": "Honda", "JM1": "Mazda", "JM3": "Mazda",
    "JMZ": "Mazda", "JA": "Mitsubishi", "JMB": "Mitsubishi", "JS": "Suzuki", "JD": "Daihatsu",
    # Germany
    "WBA": "BMW", "WBS": "BMW", "WBX": "BMW", "WBY": "BMW", "WMW": "MINI",
    "WDB": "Mercedes-Benz", "WDD": "Mercedes-Benz", "WDC": "Mercedes-Benz",
    "W1K": "Mercedes-Benz", "W1N": "Mercedes-Benz", "WDF": "Mercedes-Benz",
    "WAU": "Audi", "WA1": "Audi", "TRU": "Audi", "WVW": "Volkswagen", "WVG": "Volkswagen",
    "WV1": "Volkswagen", "WV2": "Volkswagen", "WP0": "Porsche", "WP1": "Porsche",
    "W0L": "Opel", "WF0": "Ford",
    # Korea
    "KMH": "Hyundai", "KM8": "Hyundai", "KMF": "Hyundai", "KNA": "Kia", "KND": "Kia",
    "KNM": "Renault Samsung", "KL": "GM Korea",
    # UK / Europe
    "SAL": "Land Rover", "SAJ": "Jaguar", "SAD": "Jaguar", "SCA": "Rolls-Royce",
    "SCB": "Bentley", "SCC": "Lotus", "SCF": "Aston Martin", "SAR": "Rover",
    "ZFF": "Ferrari", "ZHW": "Lamborghini", "ZAM": "Maserati", "ZFA": "Fiat",
    "ZAR": "Alfa Romeo", "YV1": "Volvo", "YV4": "Volvo", "VF1": "Renault",
    "VF3": "Peugeot", "VF7": "Citroen", "VF6": "Renault Trucks",
    # China (the key gap NHTSA can't fill)
    "LGW": "Great Wall", "LGB": "Dongfeng", "LGX": "BYD", "LC0": "BYD", "L6T": "Geely",
    "LB3": "Geely", "LVS": "Ford China", "LVV": "Chery", "LVT": "Chery", "LSV": "SAIC-VW",
    "LSJ": "MG", "LS5": "Changan", "LFV": "FAW-VW", "LFP": "FAW", "LJ1": "JAC",
    "LZW": "Wuling", "L5Y": "Zhongtong", "LNB": "Baic", "LDC": "Dongfeng-PSA",
    "LMG": "GAC", "LPA": "NIO", "LW9": "Xpeng",
    # North America (common imports)
    "1G": "GM", "1GC": "Chevrolet", "1FA": "Ford", "1FT": "Ford", "1FM": "Ford",
    "1C4": "Jeep", "1J4": "Jeep", "2C4": "Chrysler", "1N4": "Nissan", "5N1": "Nissan",
    "3N1": "Nissan", "5XX": "Kia", "5NP": "Hyundai", "2LM": "Lincoln", "1L": "Lincoln",
    "1GY": "Cadillac", "1G6": "Cadillac", "2T": "Toyota", "4T": "Toyota", "5T": "Toyota",
    "1HG": "Honda", "2HG": "Honda", "5FN": "Honda", "19U": "Acura", "JH4": "Acura",
    "2G1": "Chevrolet", "3G": "GM", "5UX": "BMW", "4US": "BMW", "55S": "Mercedes-Benz",
    "4JG": "Mercedes-Benz",
}


def vin_manufacturer(vin):
    """Manufacturer from the WMI. Tries 3-char then 2-char prefix. Universal
    fallback for when NHTSA returns no make (e.g. Chinese/GCC-only VINs)."""
    v = str(vin or "").upper()
    if not VIN_ALLOWED_RE.match(v):
        return None
    return _WMI_MAKE.get(v[:3]) or _WMI_MAKE.get(v[:2])


def resolve_vin_year(vin, hint_year=None):
    """Model year from position 10, disambiguating the 30-year cycle with a hint
    (e.g. the year in the post title). Universal — correct even when NHTSA's
    ModelYear is wrong for a non-US VIN."""
    cands = decode_vin_year(vin)
    if not cands:
        return None
    if hint_year:
        try:
            hint = int(hint_year)
            match = min(cands, key=lambda y: abs(y - hint))
            if abs(match - hint) <= 1:
                return match
        except (TypeError, ValueError):
            pass
    return max(cands)  # newest plausible when no hint


def _int(value):
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def _map_body_type(v):
    v = (v or "").lower()
    if not v:
        return None
    if any(k in v for k in ("sport utility", "suv", "mpv", "multipurpose")):
        return "SUV"
    if "sedan" in v or "saloon" in v:
        return "Sedan"
    if "hatchback" in v or "liftback" in v:
        return "Hatchback"
    if "convertible" in v or "cabriolet" in v or "roadster" in v or "spyder" in v:
        return "Convertible"
    if "coupe" in v:
        return "Coupe"
    if "wagon" in v or "estate" in v:
        return "Wagon"
    if "van" in v or "minivan" in v:
        return "Van"
    if "pickup" in v or "truck" in v:
        return "Truck"
    return "Other"


def _map_fuel(primary, electrification=None):
    p = (primary or "").lower()
    e = (electrification or "").lower()
    # NHTSA ElectrificationLevel uses HEV/PHEV/MHEV for hybrids, BEV for electric.
    if "hybrid" in e or "hybrid" in p or "hev" in e or "plug-in" in e:
        return "Hybrid"
    if "diesel" in p:
        return "Diesel"
    if "electric" in p or "bev" in e:
        return "Electric"
    if any(k in p for k in ("gasoline", "petrol", "flex", "ethanol", "e85")):
        return "Petrol"
    return "Other" if p else None


def _map_transmission(v):
    v = (v or "").lower()
    if not v:
        return None
    if "manual" in v and "automated" not in v:
        return "Manual"
    if any(k in v for k in ("automat", "cvt", "dct", "dual-clutch", "dual clutch")):
        return "Automatic"
    return None


def _map_drive(v):
    v = (v or "").lower()
    if not v:
        return None
    if "awd" in v or "all-wheel" in v or "all wheel" in v:
        return "All Wheel Drive"
    if "4wd" in v or "4-wheel" in v or "4x4" in v or "four-wheel" in v or "four wheel" in v:
        return "Four Wheel Drive"
    if "fwd" in v or "front" in v:
        return "Front Wheel Drive"
    if "rwd" in v or "rear" in v:
        return "Rear Wheel Drive"
    return None


def map_decoded_to_listing(decoded):
    """Map an NHTSA `decoded` dict to canonical car-listing spec columns, using
    the exact enum values the listing form expects. Only clean, mappable values
    are returned; callers fill the rest from the description or leave blank."""
    if not decoded:
        return {}
    out = {}
    body = _map_body_type(decoded.get("body_class"))
    if body:
        out["body_type"] = body
    fuel = _map_fuel(decoded.get("fuel_primary"), decoded.get("electrification"))
    if fuel:
        out["fuel_type"] = fuel
    trans = _map_transmission(decoded.get("transmission_style"))
    if trans:
        out["transmission_type"] = trans
    drive = _map_drive(decoded.get("drive_type"))
    if drive:
        out["drivetrain"] = drive
    cyl = _int(decoded.get("cylinders"))
    if cyl:
        out["cylinders"] = cyl
    disp = decoded.get("displacement_l")
    if disp:
        try:
            out["engine_capacity"] = f"{float(disp):.1f}L"
        except (TypeError, ValueError):
            pass
    hp = _int(decoded.get("engine_hp"))
    if hp:
        out["horsepower"] = str(hp)
    doors = _int(decoded.get("doors"))
    if doors:
        out["doors"] = doors
    seats = _int(decoded.get("seats"))
    if seats:
        out["seating_capacity"] = seats
    trim = decoded.get("trim")
    if trim:
        out["trim"] = str(trim).strip()[:60]
    return out
