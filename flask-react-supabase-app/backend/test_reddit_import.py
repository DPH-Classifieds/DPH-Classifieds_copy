"""Tests for the pure Reddit parser/fetch service and the import worker.

No network access: HTTP and Supabase are mocked. Run:
  ./.venv/bin/python -m unittest test_reddit_import -v
"""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from services.reddit_import import (
    ParsedRedditCar,
    RedditSubmission,
    build_imported_car_payload,
    canonical_reddit_url,
    extract_vin,
    fetch_new_submissions,
    get_app_access_token,
    parse_description_extras,
    parse_sale_post,
)

UTC = timezone.utc
NOW = datetime(2026, 7, 23, tzinfo=UTC)
IMG = "https://i.redd.it/example123.jpg"


def submission(title="", selftext="", id="abc", author="seller", images=None,
               permalink=None, **extra):
    data = {
        "id": id,
        "name": f"t3_{id}",
        "title": title,
        "selftext": selftext,
        "author": author,
        "permalink": permalink or f"/r/DubaiPetrolHeads/comments/{id}/title/",
        "created_utc": 1_700_000_000,
        "url": (images[0] if images else ""),
    }
    data.update(extra)
    sub = RedditSubmission.from_api(data)
    if images is not None:
        sub.images = list(images)
    return sub


def complete_post(id="abc"):
    return submission(
        title="WTS: 2018 BMW 120i GCC - AED 39,000",
        selftext="88,000 km. Call +971501234567 or email me@example.com",
        id=id,
        images=[IMG],
    )


class ParserTests(unittest.TestCase):
    def test_parses_a_complete_wts_post_without_retaining_contact_details(self):
        parsed = parse_sale_post(complete_post("abc"), NOW)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.make, "BMW")
        self.assertEqual(parsed.model, "120i")
        self.assertEqual(parsed.year, 2018)
        self.assertEqual(parsed.price_aed, 39000)
        self.assertEqual(parsed.mileage_km, 88000)
        self.assertNotIn("+971", parsed.description)
        self.assertNotIn("example.com", parsed.description)
        self.assertNotIn("+971", parsed.title)

    def test_rejects_wanted_sold_and_incomplete_posts(self):
        self.assertIsNone(parse_sale_post(submission(title="WTB Porsche 911", id="a", images=[IMG]), NOW))
        self.assertIsNone(parse_sale_post(submission(title="SOLD: 2018 BMW 120i AED 39k", id="b", images=[IMG]), NOW))
        # No price/year → incomplete.
        self.assertIsNone(parse_sale_post(submission(title="WTS: BMW 120i", id="c", images=[IMG]), NOW))
        # No image → not publishable.
        self.assertIsNone(parse_sale_post(submission(title="WTS: 2018 BMW 120i AED 39,000", id="d", images=[]), NOW))

    def test_rejects_removed_deleted_nsfw_and_mod_posts(self):
        self.assertIsNone(parse_sale_post(submission(title="WTS 2018 BMW 120i AED 39,000", id="e", images=[IMG], author="[deleted]"), NOW))
        self.assertIsNone(parse_sale_post(submission(title="WTS 2018 BMW 120i AED 39,000", id="f", images=[IMG], removed_by_category="moderator"), NOW))
        self.assertIsNone(parse_sale_post(submission(title="WTS 2018 BMW 120i AED 39,000", id="g", images=[IMG], over_18=True), NOW))
        self.assertIsNone(parse_sale_post(submission(title="WTS 2018 BMW 120i AED 39,000", id="h", images=[IMG], distinguished="moderator"), NOW))

    def test_price_formats(self):
        for title, expected in [
            ("WTS 2018 BMW 120i AED 85,000", 85000),
            ("WTS 2018 BMW 120i 85,000 AED", 85000),
            ("WTS 2018 BMW 120i 85k", 85000),
            ("WTS 2018 BMW 120i 85 K", 85000),
        ]:
            parsed = parse_sale_post(submission(title=title, id="p", images=[IMG]), NOW)
            self.assertIsNotNone(parsed, title)
            self.assertEqual(parsed.price_aed, expected, title)

    def test_price_out_of_range_rejected(self):
        self.assertIsNone(parse_sale_post(submission(title="WTS 2018 BMW 120i AED 500", id="q", images=[IMG]), NOW))

    def test_multiword_make_resolves(self):
        parsed = parse_sale_post(submission(title="WTS 2019 Land Rover Defender AED 250,000", id="lr", images=[IMG]), NOW)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.make, "Land Rover")
        self.assertEqual(parsed.model, "Defender")

    def test_canonical_url_cannot_be_redirected_to_an_untrusted_host(self):
        self.assertEqual(
            canonical_reddit_url("/r/DubaiPetrolHeads/comments/abc/title/"),
            "https://www.reddit.com/r/DubaiPetrolHeads/comments/abc/title/",
        )
        with self.assertRaises(ValueError):
            canonical_reddit_url("https://evil.example/post")
        with self.assertRaises(ValueError):
            canonical_reddit_url("https://reddit.com.evil.example/r/x/")

    def test_only_reddit_hosted_images_are_kept(self):
        sub = RedditSubmission.from_api({
            "id": "z", "name": "t3_z", "title": "WTS 2018 BMW 120i AED 39,000",
            "author": "s", "permalink": "/r/DubaiPetrolHeads/comments/z/t/",
            "created_utc": 1,
            "url": "https://evil.example/pic.jpg",
            "preview": {"images": [{"source": {"url": "https://preview.redd.it/ok.jpg"}}]},
        })
        # preview.redd.it is rewritten to the hotlinkable i.redd.it CDN.
        self.assertEqual(sub.images, ["https://i.redd.it/ok.jpg"])

    def test_gallery_post_images_are_extracted(self):
        # Real car sales post as galleries: image URLs live in media_metadata,
        # ordered by gallery_data. data.url is only the /gallery/ permalink.
        sub = RedditSubmission.from_api({
            "id": "g1", "name": "t3_g1",
            "title": "WTS: 2018 BMW 120i GCC AED 39,000", "author": "s",
            "permalink": "/r/DubaiPetrolHeads/comments/g1/t/", "created_utc": 1,
            "url": "https://www.reddit.com/gallery/g1",
            "is_gallery": True,
            "gallery_data": {"items": [{"media_id": "aaa"}, {"media_id": "bbb"}]},
            "media_metadata": {
                "aaa": {"status": "valid", "e": "Image", "s": {"u": "https://preview.redd.it/aaa.jpg?width=1080"}},
                "bbb": {"status": "valid", "e": "Image", "s": {"u": "https://preview.redd.it/bbb.jpg?width=1080"}},
            },
        })
        # Gallery preview URLs are rewritten to hotlinkable i.redd.it (basename,
        # query dropped) so browser <img> tags load them (preview.redd.it 403s).
        self.assertEqual(sub.images[0], "https://i.redd.it/aaa.jpg")
        parsed = parse_sale_post(sub, NOW)
        self.assertIsNotNone(parsed)
        self.assertTrue(parsed.image_url.startswith("https://i.redd.it/aaa"))

    def test_payload_uses_real_columns_and_safe_fallbacks(self):
        parsed = parse_sale_post(complete_post("abc"), NOW)
        payload = build_imported_car_payload(parsed, "owner-uuid", NOW)
        self.assertEqual(payload["user_id"], "owner-uuid")
        self.assertEqual(payload["source_platform"], "reddit")
        self.assertEqual(payload["source_external_id"], "t3_abc")
        self.assertEqual(payload["car_manufacturer"], "BMW")
        self.assertEqual(payload["expected_selling_price"], 39000)
        self.assertEqual(payload["status"], "approved")
        self.assertIs(payload["is_approved"], True)
        self.assertEqual(payload["regional_spec"], "Unspecified")
        self.assertTrue(payload["source_url"].startswith("https://www.reddit.com/r/"))
        # No fabricated / PII fields.
        self.assertNotIn("car_owner_phone_number", payload)


class FetchTests(unittest.TestCase):
    def test_get_app_access_token(self):
        session = MagicMock()
        resp = MagicMock()
        resp.json.return_value = {"access_token": "tok123"}
        resp.raise_for_status.return_value = None
        session.post.return_value = resp
        token = get_app_access_token(session, "cid", "csecret", "ua")
        self.assertEqual(token, "tok123")
        # Credentials go via HTTP basic auth, never logged.
        _, kwargs = session.post.call_args
        self.assertEqual(kwargs["auth"], ("cid", "csecret"))

    def test_get_app_access_token_missing_token_raises(self):
        session = MagicMock()
        resp = MagicMock()
        resp.json.return_value = {}
        resp.raise_for_status.return_value = None
        session.post.return_value = resp
        with self.assertRaises(ValueError):
            get_app_access_token(session, "cid", "csecret", "ua")

    def test_fetch_new_submissions_parses_children(self):
        session = MagicMock()
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"data": {"children": [
            {"data": {"id": "1", "name": "t3_1", "title": "WTS BMW", "author": "a",
                      "permalink": "/r/x/comments/1/t/", "created_utc": 1}},
            {"kind": "t3"},  # missing data → skipped, not a crash
        ]}}
        session.get.return_value = resp
        subs = fetch_new_submissions(session, "tok", "DubaiPetrolHeads", 100, "ua")
        self.assertEqual(len(subs), 1)
        self.assertEqual(subs[0].id, "t3_1")

    def test_fetch_new_submissions_raises_on_http_error(self):
        session = MagicMock()
        resp = MagicMock()
        resp.raise_for_status.side_effect = Exception("429 rate limited")
        session.get.return_value = resp
        with self.assertRaises(Exception):
            fetch_new_submissions(session, "tok", "sub", 100, "ua")


from services.reddit_import import parse_listing, build_imported_payload


class MultiCategoryTests(unittest.TestCase):
    def _p(self, title, id="x"):
        return parse_listing(submission(title=title, id=id, images=[IMG]), NOW)

    def test_car_selftext_full_of_part_nouns_is_still_a_car(self):
        sub = submission(title="WTS: 2018 BMW 120i GCC AED 39,000",
                         selftext="New tyres, wheels, brakes, exhaust, leather seats", id="c", images=[IMG])
        p = parse_listing(sub, NOW)
        self.assertEqual(p.category, "car")

    def test_bike_make_routes_to_bikes(self):
        p = self._p("WTS: Ducati Panigale V2 2022 AED 75,000")
        self.assertEqual(p.category, "bike")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["config"]["table"], "bikes")
        self.assertEqual(built["payload"]["bike_brand"], "Ducati")
        self.assertEqual(built["payload"]["price"], 75000)

    def test_ambiguous_make_needs_bike_signal(self):
        self.assertEqual(self._p("WTS BMW S1000RR 2021 AED 60,000").category, "bike")
        self.assertEqual(self._p("WTS BMW 320i 2019 AED 60,000").category, "car")

    def test_part_keyword_in_title_routes_to_parts(self):
        p = self._p("WTS BBS wheels for BMW AED 3,000")
        self.assertEqual(p.category, "part")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["config"]["table"], "car_parts")
        self.assertEqual(built["payload"]["part_type"], "Wheels & Tires")

    def test_plate_routes_to_license_plates(self):
        p = self._p("WTS number plate 12345 Dubai AED 25,000")
        self.assertEqual(p.category, "plate")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["config"]["table"], "license_plates")
        self.assertEqual(built["payload"]["number"], "12345")

    def test_every_category_payload_carries_source_contract(self):
        for title in ["WTS 2018 BMW 120i AED 39,000", "WTS Yamaha MT-09 2022 AED 40,000",
                      "WTS exhaust for Golf AED 2,000", "WTS plate 5555 AED 30,000"]:
            p = self._p(title)
            self.assertIsNotNone(p, title)
            built = build_imported_payload(p, "owner-uuid", NOW)
            pay = built["payload"]
            self.assertEqual(pay["source_platform"], "reddit")
            self.assertEqual(pay["user_id"], "owner-uuid")
            self.assertEqual(pay["status"], "approved")
            self.assertTrue(pay["source_url"].startswith("https://www.reddit.com/r/"))


OWNER_ID = "11111111-1111-1111-1111-111111111111"
_ENV = {
    "REDDIT_IMPORT_ENABLED": "true",
    "REDDIT_CLIENT_ID": "cid",
    "REDDIT_CLIENT_SECRET": "csecret",
    "REDDIT_USER_AGENT": "ua",
    "REDDIT_IMPORT_OWNER_ID": OWNER_ID,
    "REDDIT_IMPORT_SUBREDDIT": "DubaiPetrolHeads",
}


class FakeDB:
    """Route (method, path) → (body, status) like the service-role PostgREST layer."""

    def __init__(self, existing_cars=None, live_cars=None):
        self.existing_cars = existing_cars or []   # for in.() lookup by source id
        self.live_cars = live_cars if live_cars is not None else []  # for removal scan
        self.calls = []

    def __call__(self, method, path, data=None, params=None):
        self.calls.append({"method": method, "path": path, "data": data, "params": params})
        params = params or {}
        if path == "/rest/v1/users":
            return [{"id": OWNER_ID, "email": "admin@dphclassifieds.com"}], 200
        if path == "/rest/v1/reddit_import_runs":
            return [{"id": "run-1"}], 201
        if path.startswith("/rest/v1/reddit_import_runs?"):
            return [], 200
        if path == "/rest/v1/cars" and method == "get":
            if params.get("source_removed_at") == "is.null":
                return list(self.live_cars), 200
            return list(self.existing_cars), 200
        if path == "/rest/v1/cars" and method == "post":
            return [{"id": "new-car"}], 201
        if path.startswith("/rest/v1/cars?") and method == "patch":
            return [], 204
        if path == "/rest/v1/car_images" and method == "get":
            return [], 200
        if path == "/rest/v1/car_images" and method == "post":
            return [{"id": "img-1"}], 201
        if path.startswith("/rest/v1/car_images?") and method == "delete":
            return [], 204
        return [], 200


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.env_patch = patch.dict("os.environ", _ENV, clear=False)
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()

    def test_disabled_skips_import_but_still_expires(self):
        # When importing is disabled, run() must NOT fetch/import, but it MUST
        # still run the 7-day expiry sweep so old Reddit listings always age out.
        import workers.reddit_import_worker as w
        stub = MagicMock(return_value=([], 200))
        with patch.dict("os.environ", {"REDDIT_IMPORT_ENABLED": "false"}), \
                patch("workers.reddit_import_worker.fetch_new_submissions") as mock_fetch, \
                patch.object(w, "supabase_request", stub):
            result = w.run()
        self.assertEqual(result["status"], "disabled")
        self.assertIn("expired", result)
        mock_fetch.assert_not_called()  # no import work when disabled
        # The expiry sweep issued a PATCH setting status=expired on Reddit rows.
        expire_calls = [
            c for c in stub.call_args_list
            if c.args and c.args[0] == "patch"
            and c.kwargs.get("data", {}).get("status") == "expired"
        ]
        self.assertTrue(expire_calls, "expiry sweep should run even when disabled")

    @patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={})
    @patch("workers.reddit_import_worker.get_app_access_token", return_value="tok")
    @patch("workers.reddit_import_worker.fetch_new_submissions")
    def test_first_run_creates(self, mock_fetch, _tok, _info):
        import workers.reddit_import_worker as w
        mock_fetch.return_value = [complete_post("new1")]
        db = FakeDB(existing_cars=[], live_cars=[])
        with patch.object(w, "supabase_request", db):
            result = w.run()
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["status"], "succeeded")
        # The created car row carries the owner + source contract.
        car_post = next(c for c in db.calls if c["path"] == "/rest/v1/cars" and c["method"] == "post")
        self.assertEqual(car_post["data"]["user_id"], OWNER_ID)
        self.assertEqual(car_post["data"]["source_external_id"], "t3_new1")
        self.assertEqual(car_post["data"]["status"], "approved")

    @patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={})
    @patch("workers.reddit_import_worker.get_app_access_token", return_value="tok")
    @patch("workers.reddit_import_worker.fetch_new_submissions")
    def test_second_run_updates_same_source_id_not_creates_duplicate(self, mock_fetch, _tok, _info):
        import workers.reddit_import_worker as w
        mock_fetch.return_value = [complete_post("same")]
        db = FakeDB(
            existing_cars=[{"id": "car-1", "source_external_id": "t3_same"}],
            live_cars=[{"id": "car-1", "source_external_id": "t3_same"}],
        )
        with patch.object(w, "supabase_request", db):
            result = w.run()
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["updated"], 1)
        # No new insert into cars.
        self.assertFalse(any(c["path"] == "/rest/v1/cars" and c["method"] == "post" for c in db.calls))

    def test_removed_import_is_unpublished_not_deleted(self):
        import workers.reddit_import_worker as w
        db = FakeDB(live_cars=[{"id": "car-9", "source_external_id": "t3_gone"}])
        session = MagicMock()
        with patch.object(w, "supabase_request", db), \
                patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={}):
            # t3_gone is absent from the fresh page and absent from /api/info → removed.
            result = w.sync_removed_imports(session, "tok", live_source_ids=set(), user_agent="ua", now=NOW)
        self.assertEqual(result["removed"], 1)
        patch_call = next(c for c in db.calls if c["path"].startswith("/rest/v1/cars?") and c["method"] == "patch")
        self.assertEqual(patch_call["data"]["status"], "source_removed")
        self.assertIs(patch_call["data"]["is_approved"], False)

    def test_still_live_post_out_of_window_is_not_removed(self):
        import workers.reddit_import_worker as w
        db = FakeDB(live_cars=[{"id": "car-9", "source_external_id": "t3_live"}])
        session = MagicMock()
        # /api/info confirms it still exists and is not removed → keep published.
        still_live = {"t3_live": complete_post("live")}
        with patch.object(w, "supabase_request", db), \
                patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value=still_live):
            result = w.sync_removed_imports(session, "tok", live_source_ids=set(), user_agent="ua", now=NOW)
        self.assertEqual(result["removed"], 0)
        self.assertFalse(any(c["method"] == "patch" for c in db.calls))

    def test_fixture_driven_end_to_end_stores_one_clean_car(self):
        """Full run() over a saved OAuth fixture: exactly one car + one image +
        one run row, owned by the import owner, with no phone/email/selftext."""
        import json
        import os as _os
        import workers.reddit_import_worker as w
        from services.reddit_import import fetch_new_submissions

        fixture_path = _os.path.join(_os.path.dirname(__file__), "tests", "fixtures", "reddit_new_listing.json")
        with open(fixture_path) as fh:
            fixture = json.load(fh)

        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = fixture
        fake_session = MagicMock()
        fake_session.get.return_value = resp
        subs = fetch_new_submissions(fake_session, "tok", "DubaiPetrolHeads", 100, "ua")

        db = FakeDB(existing_cars=[], live_cars=[])
        with patch.object(w, "supabase_request", db), \
                patch("workers.reddit_import_worker.get_app_access_token", return_value="tok"), \
                patch("workers.reddit_import_worker.fetch_new_submissions", return_value=subs), \
                patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={}):
            result = w.run()

        self.assertEqual(result["created"], 1)
        self.assertEqual(result["skipped"], 1)  # the WTB post
        car_posts = [c for c in db.calls if c["path"] == "/rest/v1/cars" and c["method"] == "post"]
        image_posts = [c for c in db.calls if c["path"] == "/rest/v1/car_images" and c["method"] == "post"]
        run_posts = [c for c in db.calls if c["path"] == "/rest/v1/reddit_import_runs" and c["method"] == "post"]
        self.assertEqual(len(car_posts), 1)
        self.assertEqual(len(image_posts), 1)
        self.assertEqual(len(run_posts), 1)

        car = car_posts[0]["data"]
        self.assertEqual(car["user_id"], OWNER_ID)
        self.assertEqual(car["car_manufacturer"], "BMW")
        blob = json.dumps(car)
        # PII must never leak, and raw selftext prose must not be dumped.
        self.assertNotIn("+971", blob)
        self.assertNotIn("501234567", blob)
        self.assertNotIn("example.com", blob)
        self.assertNotIn("Contact me", blob)
        self.assertNotIn("Clean car", blob)
        # But structured facts ARE inherited from the description.
        self.assertEqual(car.get("service_history"), "Full service history")
        self.assertEqual(car.get("kilometer_driven"), 88000)
        self.assertEqual(car.get("regional_spec"), "GCC")
        # Provenance is recorded per field (this post has no VIN -> title/description).
        sources = car.get("import_field_sources") or {}
        self.assertEqual(sources.get("car_manufacturer"), "title")
        self.assertEqual(sources.get("service_history"), "description")
        # Title says "GCC", so regional spec is inherited, not the UAE default.
        self.assertEqual(sources.get("regional_spec"), "description")
        self.assertEqual(sources.get("steering_side"), "default")  # not stated
        # Price is tracked end to end.
        price_posts = [c for c in db.calls
                       if c["path"] == "/rest/v1/listing_price_history" and c["method"] == "post"]
        self.assertEqual(len(price_posts), 1)
        self.assertEqual(price_posts[0]["data"]["price"], 39000)
        # Images are bulk-inserted as a list; the first is the primary, reddit-hosted URL.
        imgs = image_posts[0]["data"]
        self.assertIsInstance(imgs, list)
        self.assertIn("redd.it", imgs[0]["image_url"])
        self.assertTrue(imgs[0]["is_primary"])

    @patch("workers.reddit_import_worker.fetch_new_submissions")
    def test_owner_mismatch_records_failed_run_and_aborts(self, mock_fetch):
        import workers.reddit_import_worker as w
        db = FakeDB()
        # Owner lookup returns a different email.
        def bad_owner(method, path, data=None, params=None):
            if path == "/rest/v1/users":
                return [{"id": OWNER_ID, "email": "someone@else.com"}], 200
            return db(method, path, data=data, params=params)
        with patch.object(w, "supabase_request", side_effect=bad_owner):
            result = w.run()
        self.assertEqual(result["status"], "failed")
        mock_fetch.assert_not_called()


class VinAndDescriptionTests(unittest.TestCase):
    def test_extract_vin_prefers_labelled_and_rejects_all_digits(self):
        self.assertEqual(extract_vin("Selling my car. VIN: JN8AY2DB3P9831507 clean title"),
                         "JN8AY2DB3P9831507")
        # a bare 17-char alnum token still works
        self.assertEqual(extract_vin("chassis WBAJG3101JEE24467 gcc"), "WBAJG3101JEE24467")
        # a 17-digit number is not a VIN
        self.assertIsNone(extract_vin("call me 12345678901234567"))
        self.assertIsNone(extract_vin("no vin here"))

    def test_description_extras_inherits_stated_fields(self):
        e = parse_description_extras("2018 BMW X1, GCC specs, automatic, petrol, white, LHD")
        self.assertEqual(e["regional_spec"], "GCC")
        self.assertEqual(e["transmission_type"], "Automatic")
        self.assertEqual(e["fuel_type"], "Petrol")
        self.assertEqual(e["color"], "White")
        self.assertEqual(e["steering_side"], "Left")

    def test_description_extras_handles_diesel_manual_jdm(self):
        e = parse_description_extras("Japanese spec import, manual, diesel, RHD, grey")
        self.assertEqual(e["regional_spec"], "Japanese")
        self.assertEqual(e["transmission_type"], "Manual")
        self.assertEqual(e["fuel_type"], "Diesel")
        self.assertEqual(e["steering_side"], "Right")
        self.assertEqual(e["color"], "Grey")


if __name__ == "__main__":
    unittest.main()
