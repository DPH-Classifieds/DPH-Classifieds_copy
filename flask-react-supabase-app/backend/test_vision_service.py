import unittest
from unittest.mock import MagicMock, patch

from services.vision_service import VisionServiceClient, vision_service_mode


class VisionServiceModeTests(unittest.TestCase):
    def test_defaults_to_disabled(self):
        self.assertEqual(vision_service_mode({}), "disabled")

    def test_only_shadow_is_enabled_before_policy_rollout(self):
        self.assertEqual(vision_service_mode({"VISION_SERVICE_MODE": "shadow"}), "shadow")
        self.assertEqual(vision_service_mode({"VISION_SERVICE_MODE": "enforce"}), "disabled")


class VisionServiceClientTests(unittest.TestCase):
    @patch("requests.post")
    def test_maps_private_service_response_without_exposing_raw_data(self, post):
        response = MagicMock(status_code=200)
        response.json.return_value = {
            "model_version": "nudenet+openclip:test",
            "scores": {"vehicle": 0.98, "explicit": 0.0},
            "observations": {"explicit_detections": []},
            "recommendation": "allow",
            "latency_ms": 123,
        }
        post.return_value = response
        result = VisionServiceClient("http://vision-service.railway.internal:8000", "key").analyze(b"x")
        self.assertEqual(result["model_version"], "nudenet+openclip:test")
        self.assertEqual(result["scores"]["vehicle"], 0.98)
        self.assertEqual(result["latency_ms"], 123)
        self.assertEqual(post.call_args.kwargs["headers"]["X-Vision-Service-Key"], "key")
