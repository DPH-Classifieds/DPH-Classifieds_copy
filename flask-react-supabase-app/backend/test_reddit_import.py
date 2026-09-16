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
    fetch_submissions_by_ids,
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

        insecure = RedditSubmission.from_api({
            "id": "z2", "name": "t3_z2", "title": "WTS 2018 BMW 120i AED 39,000",
            "author": "s", "permalink": "/r/DubaiPetrolHeads/comments/z2/t/",
            "created_utc": 1, "url": "http://i.redd.it/insecure.jpg",
        })
        self.assertEqual(insecure.images, [])

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
    def test_fetch_submissions_by_ids_batches_all_ids_in_groups_of_100(self):
        session = MagicMock()

        def response_for_batch(*args, **kwargs):
            ids = kwargs["params"]["id"].split(",")
            response = MagicMock()
            response.raise_for_status.return_value = None
            response.json.return_value = {
                "data": {"children": [{"data": {
                    "id": fullname.removeprefix("t3_"), "name": fullname,
                    "title": f"WTS {fullname}", "author": "seller",
                    "permalink": f"/r/DubaiPetrolHeads/comments/{fullname}/title/",
                    "created_utc": 1,
                }} for fullname in ids]}
            }
            return response

        session.get.side_effect = response_for_batch
        ids = [f"t3_post{i}" for i in range(205)]
        found = fetch_submissions_by_ids(session, "tok", ids, "ua")

        self.assertEqual(len(found), 205)
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(len(session.get.call_args_list[0].kwargs["params"]["id"].split(",")), 100)
        self.assertEqual(len(session.get.call_args_list[1].kwargs["params"]["id"].split(",")), 100)
        self.assertEqual(len(session.get.call_args_list[2].kwargs["params"]["id"].split(",")), 5)

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
        return parse_listing(submission(title=title, id=id, images=[IMG], link_flair_text="📈 Selling"), NOW)

    def test_rejects_help_question_post_that_mentions_selling(self):
        sub = submission(
            title="Question in Selling MAZDA 3 2019 with odo 135K",
            selftext="""HI petrol people, just want to ask how much do you think i should price my CAR

Model: MAZDA 3 Sedan 2019 2.0 Skyactive with Sunroof.
Odo: 135,000
I'm not in a hurry in the selling the car. any thoughts what would be the best price guys?""",
            id="help-question",
            images=[IMG],
            link_flair_text="🔰 Help/Question",
        )
        self.assertIsNone(parse_listing(sub, NOW))

    def test_parses_inline_model_label_and_k_mileage(self):
        sub = submission(
            title="[WTS] Mazda 6 2014 Spec V",
            selftext="""Make: Mazda Model: 6 S

Year: 2014

Odometer: 272K

Price - 22,000AED (Negotiable)""",
            id="mazda-6-inline-labels",
            images=[IMG],
            link_flair_text="📈 Selling",
        )
        parsed = parse_listing(sub, NOW)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.fields["make"], "Mazda")
        self.assertEqual(parsed.fields["model"], "6 S")
        self.assertEqual(parsed.fields["year"], 2014)
        self.assertEqual(parsed.fields["mileage_km"], 272000)
        self.assertEqual(parsed.price_aed, 22000)

    def test_does_not_treat_placeholder_mileage_as_a_real_value(self):
        sub = submission(
            title="WTS: (urgent) 04 Chevrolet Trailblazer Ext",
            selftext="""2004 Trailblazer EXT LT (7-seater)

Mileage 115,xxx will confirm exact mileage.

Asking price 10,500""",
            id="trailblazer-placeholder-mileage",
            images=[IMG],
            link_flair_text="📈 Selling",
        )
        parsed = parse_listing(sub, NOW)
        self.assertIsNotNone(parsed)
        self.assertIsNone(parsed.fields["mileage_km"])

    def test_preserves_full_labeled_model_instead_of_title_fragment(self):
        sub = submission(
            title="[WTS] 2013 BMW 35i X6",
            selftext="""Make: BMW
Model: X6 xDrive35i
Year: 2013
Odometer: 352,000 km
Price: 20,000 negotiable""",
            id="bmw-x6-labeled-model",
            images=[IMG],
            link_flair_text="📈 Selling",
        )
        parsed = parse_listing(sub, NOW)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.fields["model"], "X6 xDrive35i")
        self.assertEqual(parsed.fields["mileage_km"], 352000)

    def test_car_selftext_full_of_part_nouns_is_still_a_car(self):
        sub = submission(title="WTS: 2018 BMW 120i GCC AED 39,000",
                         selftext="New tyres, wheels, brakes, exhaust, leather seats", id="c", images=[IMG])
        p = parse_listing(sub, NOW)
        self.assertEqual(p.category, "car")

    def test_active_car_import_is_minimal_and_does_not_parse_rich_extras(self):
        sub = submission(
            title="WTS: 2018 BMW 120i GCC AED 39,000",
            selftext="88,000 km. VIN: WBA00000000000000. White, automatic, full service history.",
            id="minimal-car",
            images=[IMG],
        )
        parsed = parse_listing(sub, NOW)
        self.assertEqual(parsed.fields, {
            "make": "BMW", "model": "120i", "year": 2018, "mileage_km": 88000,
        })
        self.assertEqual(parsed.title, "2018 BMW 120i")
        payload = build_imported_payload(parsed, "owner", NOW)["payload"]
        self.assertEqual(payload["car_manufacturer"], "BMW")
        self.assertEqual(payload["car_model"], "120i")
        self.assertEqual(payload["make_year"], 2018)
        self.assertEqual(payload["expected_selling_price"], 39000)
        self.assertEqual(payload["kilometer_driven"], 88000)
        for field in ("vin_number", "color", "engine_capacity", "cylinders", "doors", "service_history"):
            self.assertIsNone(payload[field])
        self.assertNotIn("import_field_sources", payload)

    def test_active_import_description_contains_the_full_sanitized_reddit_post(self):
        sub = submission(
            title="WTS: 2019 Toyota Camry SE GCC AED 62,000",
            selftext="""Make: Toyota

Model: Camry SE

Year: 2019

Features: sunroof, full service history

Contact +971501234567 or seller@example.com""",
            id="full-description",
            images=[IMG],
        )

        parsed = parse_listing(sub, NOW)

        self.assertIsNotNone(parsed)
        self.assertIn("Original Reddit post:", parsed.description)
        self.assertIn("WTS: 2019 Toyota Camry SE GCC AED 62,000", parsed.description)
        self.assertIn("Features: sunroof, full service history", parsed.description)
        self.assertIn("\n\n", parsed.description)
        self.assertNotIn("+971501234567", parsed.description)
        self.assertNotIn("seller@example.com", parsed.description)

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

    def test_car_with_part_noun_in_title_is_still_a_car(self):
        # A whole-vehicle identity that LEADS the title beats an incidental part word.
        for t in [
            "WTS 2019 Nissan Patrol GCC, new tyres, brakes & wheels AED 120,000",
            "WTS: 2016 Range Rover Vogue, full service history, new brakes AED 150,000",
            "WTS 2020 Ford Mustang GT, full wrap, AED 130,000",
            "WTS 2015 Nissan GTR, upgraded turbo AED 300,000",
            "WTS 2018 Mercedes C300 Recaro seats AED 95,000",
        ]:
            self.assertEqual(self._p(t).category, "car", t)

    def test_part_leading_title_still_routes_to_part(self):
        self.assertEqual(self._p("WTS BBS wheels for BMW AED 3,000").category, "part")
        self.assertEqual(self._p("WTS Recaro seats for 2018 Golf GTI AED 4,000").category, "part")

    def test_plate_routes_to_license_plates(self):
        p = self._p("WTS number plate 12345 Dubai AED 25,000")
        self.assertEqual(p.category, "plate")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["config"]["table"], "license_plates")
        self.assertEqual(built["payload"]["number"], "12345")

    def test_engine_descriptor_leading_title_is_still_a_car(self):
        # A part word used as a descriptor directly on the vehicle (no fitment
        # word like "for"/"fits" separating them) must not demote a full car
        # to a car_parts row — this was the reported "car miscoded as an
        # engine" bug (turbo/exhaust/intake all map to part_type "Engine").
        for t in [
            "WTS Turbo BMW 335i 2013, low mileage AED 45,000",
            "WTS Twin Turbo Mercedes G63 2016 AED 350,000",
            "WTS Supercharged Range Rover Sport 2019 AED 180,000",
        ]:
            self.assertEqual(self._p(t).category, "car", t)

    def test_engine_part_genuinely_for_a_car_stays_a_part(self):
        # The fitment word ("for") between the part word and the vehicle it
        # fits is what makes this genuinely a parts listing, not a car.
        p = self._p("WTS Turbo for BMW 335i, single turbo upgrade AED 3,500")
        self.assertEqual(p.category, "part")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["payload"]["part_type"], "Engine")

    def test_part_descriptor_leading_bike_title_is_still_a_bike(self):
        p = self._p("WTS Akrapovic Exhaust Kawasaki ZX10R 2018 AED 42,000")
        self.assertEqual(p.category, "bike")

    def test_plate_number_survives_a_price_mentioned_first(self):
        # The plate number must not be confused with a nearby price fragment.
        p = self._p("WTS AED 30,000 Dubai plate 5555")
        self.assertEqual(p.category, "plate")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["payload"]["number"], "5555")
        self.assertEqual(built["payload"]["price"], 30000)

    def test_plate_code_and_number_both_labelled_are_not_swapped(self):
        # Abu Dhabi style: a numeric category "code" and a separate "number"
        # must resolve to their own fields, not double up on the code digit.
        p = self._p("WTS Abu Dhabi plate code 1 number 7 AED 40,000")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["payload"]["number"], "7")
        self.assertEqual(built["payload"]["code"], "1")
        self.assertEqual(built["payload"]["emirate"], "Abu Dhabi")
        self.assertEqual(built["payload"]["city"], "Abu Dhabi")

    def test_plate_emirate_is_not_always_dubai(self):
        p = self._p("WTS Sharjah plate O 5 AED 20,000")
        built = build_imported_payload(p, "owner", NOW)
        self.assertEqual(built["payload"]["emirate"], "Sharjah")
        self.assertEqual(built["payload"]["code"], "O")

    def test_vehicle_identity_wins_when_plate_is_incidental(self):
        for title in [
            "WTS 2020 Nissan Patrol plate number 1234 AED 120,000",
            "WTS 2018 BMW 320i with plate 1234 AED 60,000",
            "WTS 2018 BMW 320i number plate AED 60,000",
        ]:
            parsed = self._p(title)
            self.assertIsNotNone(parsed, title)
            self.assertEqual(parsed.category, "car", title)

    def test_plate_sale_before_vehicle_fitment_stays_a_plate(self):
        parsed = self._p("WTS Dubai number plate 1234 for BMW 320i AED 60,000")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.category, "plate")
        self.assertEqual(parsed.fields["number"], "1234")

    def test_plate_requires_number_near_plate_cue(self):
        for title in [
            "WTS 2018 BMW 320i number plate AED 60,000",
            "WTS number plate frame for BMW 320i AED 5,000",
            "WTS 2018 BMW 320i new plate AED 60,000",
        ]:
            parsed = self._p(title)
            self.assertTrue(parsed is None or parsed.category != "plate", title)

    def test_plate_serial_before_digit_count_is_not_scrubbed_or_replaced(self):
        parsed = parse_listing(submission(
            title="WTS: Dubai K 3692, 4 digit number plate, Starting 369",
            selftext="AED 28,000",
            id="plate-3692", images=[IMG],
        ), NOW
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.category, "plate")
        self.assertEqual(parsed.fields["number"], "3692")
        self.assertIn("3692", parsed.title)

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

    def test_self_origin_posts_are_never_imported(self):
        # A post from our own Devvit/bot account, or one linking back to the
        # site, must never come back in as a "new" listing.
        for i, author in enumerate(("DPHClassifieds", "dphclassifieds-web", "DPH-Classifieds-WEB")):
            sub = submission(title="WTS 2018 BMW 120i AED 39,000", id=f"self{i}",
                              images=[IMG], author=author)
            self.assertIsNone(parse_listing(sub, NOW), author)
        sub = submission(title="WTS 2018 BMW 120i AED 39,000",
                          selftext="See www.dphclassifieds.com/cars/abc for more",
                          id="t", images=[IMG])
        self.assertIsNone(parse_listing(sub, NOW))


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

    def __init__(self, existing_cars=None, existing_plates=None, live_cars=None):
        self.existing_cars = existing_cars or []   # for in.() lookup by source id
        self.existing_plates = existing_plates or []
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
        if path == "/rest/v1/license_plates" and method == "get":
            return list(self.existing_plates), 200
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
        if path == "/rest/v1/license_plates" and method == "post":
            return [{"id": "new-plate"}], 201
        if path == "/rest/v1/plate_images" and method == "get":
            return [], 200
        if path == "/rest/v1/plate_images" and method == "post":
            return [{"id": "img-plate-1"}], 201
        return [], 200


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.env_patch = patch.dict("os.environ", _ENV, clear=False)
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()

    def test_hides_existing_row_when_fresh_reddit_post_is_ineligible(self):
        import workers.reddit_import_worker as w

        calls = []

        def fake_request(method, path, data=None, params=None):
            calls.append((method, path, data, params))
            if method == "get" and path == "/rest/v1/cars":
                return [{"id": "old-help-row", "source_external_id": "t3_help", "status": "approved"}], 200
            if method == "get":
                return [], 200
            return [], 204

        with patch.object(w, "supabase_request", side_effect=fake_request):
            hidden = w._hide_ineligible_imports(["t3_help"], OWNER_ID)

        assert hidden == 1
        assert any(
            method == "patch"
            and path == f"/rest/v1/cars?id=eq.old-help-row&user_id=eq.{OWNER_ID}"
            and data == {"status": "expired", "is_approved": False}
            for method, path, data, _params in calls
        )

    def test_disabled_skips_import_but_still_expires(self):
        # When importing is disabled, run() must NOT fetch/import. The age sweep
        # is also disabled by default; upstream removal is the source of truth.
        import workers.reddit_import_worker as w
        stub = MagicMock(return_value=([], 200))
        with patch.dict("os.environ", {"REDDIT_IMPORT_ENABLED": "false"}), \
                patch("workers.reddit_import_worker.fetch_new_submissions") as mock_fetch, \
                patch.object(w, "supabase_request", stub):
            result = w.run()
        self.assertEqual(result["status"], "disabled")
        self.assertIn("expired", result)
        mock_fetch.assert_not_called()  # no import work when disabled
        # No artificial age-expiry PATCH is issued under the default policy.
        expire_calls = [
            c for c in stub.call_args_list
            if c.args and c.args[0] == "patch"
            and c.kwargs.get("data", {}).get("status") == "expired"
        ]
        self.assertFalse(expire_calls, "default policy must not age out active Reddit listings")

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
        source_lookup = next(
            c for c in db.calls
            if c["path"] == "/rest/v1/cars"
            and c["method"] == "get"
            and c["params"].get("source_external_id")
        )
        self.assertEqual(source_lookup["params"]["user_id"], f"eq.{OWNER_ID}")

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

    @patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={})
    @patch("workers.reddit_import_worker.get_app_access_token", return_value="tok")
    @patch("workers.reddit_import_worker.fetch_new_submissions")
    def test_resync_retires_a_previous_wrong_category_before_creating_correct_one(self, mock_fetch, _tok, _info):
        import workers.reddit_import_worker as w
        mock_fetch.return_value = [submission(
            title="WTS 2020 Nissan Patrol plate number AED 120,000",
            id="wrong-category", images=[IMG],
        )]
        db = FakeDB(existing_plates=[{
            "id": "old-plate", "source_external_id": "t3_wrong-category", "status": "approved",
        }])
        with patch.object(w, "supabase_request", db):
            result = w.run()
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["failed"], 0)
        retired = next(c for c in db.calls
                       if c["method"] == "patch" and c["path"].startswith("/rest/v1/license_plates?"))
        self.assertEqual(retired["data"], {"status": "expired", "is_approved": False})
        self.assertTrue(any(c["path"] == "/rest/v1/cars" and c["method"] == "post"
                            for c in db.calls))

    def test_removed_import_is_unpublished_not_deleted(self):
        import workers.reddit_import_worker as w
        db = FakeDB(live_cars=[{"id": "car-9", "source_external_id": "t3_gone"}])
        session = MagicMock()
        with patch.object(w, "supabase_request", db), \
                patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value={}):
            # t3_gone is absent from the fresh page and absent from /api/info → removed.
            result = w.sync_removed_imports(
                session, "tok", live_source_ids=set(), user_agent="ua", now=NOW,
                owner_id=OWNER_ID,
            )
        self.assertEqual(result["removed"], 1)
        patch_call = next(c for c in db.calls if c["path"].startswith("/rest/v1/cars?") and c["method"] == "patch")
        self.assertEqual(patch_call["data"]["status"], "source_removed")
        self.assertIs(patch_call["data"]["is_approved"], False)
        self.assertIn(f"user_id=eq.{OWNER_ID}", patch_call["path"])

    def test_still_live_post_out_of_window_is_not_removed(self):
        import workers.reddit_import_worker as w
        db = FakeDB(live_cars=[{"id": "car-9", "source_external_id": "t3_live"}])
        session = MagicMock()
        # /api/info confirms it still exists and is not removed → keep published.
        still_live = {"t3_live": complete_post("live")}
        with patch.object(w, "supabase_request", db), \
                patch("workers.reddit_import_worker.fetch_submissions_by_ids", return_value=still_live):
            result = w.sync_removed_imports(
                session, "tok", live_source_ids=set(), user_agent="ua", now=NOW,
                owner_id=OWNER_ID,
            )
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
        # The full post prose is retained, but contact details are scrubbed.
        self.assertNotIn("+971", blob)
        self.assertNotIn("501234567", blob)
        self.assertNotIn("example.com", blob)
        self.assertIn("Original Reddit post:", blob)
        self.assertIn("Clean car", blob)
        # Active car imports intentionally persist only the compact contract:
        # photos, year/make/model, price, and odometer. Older rich fields are
        # explicitly cleared so the backfill also normalizes existing rows.
        self.assertIsNone(car.get("service_history"))
        self.assertEqual(car.get("kilometer_driven"), 88000)
        self.assertEqual(car.get("regional_spec"), "GCC")
        self.assertIsNone(car.get("vin_number"))
        self.assertIsNone(car.get("color"))
        self.assertIsNone(car.get("engine_capacity"))
        self.assertIsNone(car.get("cylinders"))
        self.assertIsNone(car.get("doors"))
        self.assertNotIn("import_field_sources", car)
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
