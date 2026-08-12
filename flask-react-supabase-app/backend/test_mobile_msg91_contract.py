"""The mobile binary must include the native MSG91 module it invokes."""
import json
from pathlib import Path


def test_mobile_declares_msg91_native_dependency():
    package = json.loads(
        (Path(__file__).resolve().parents[1] / "mobile" / "package.json").read_text()
    )
    assert "@msg91comm/sendotp-react-native" in package["dependencies"]
