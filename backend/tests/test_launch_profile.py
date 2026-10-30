import unittest

from app.launch_profile import build_start_url, parse_launch_profile


class LaunchProfileTests(unittest.TestCase):
    def test_default_profile_keeps_the_current_desktop_url(self):
        profile = parse_launch_profile(None)
        self.assertEqual(profile, "default")
        self.assertEqual(build_start_url("http://127.0.0.1:8000", profile), "http://127.0.0.1:8000")

    def test_iss_profile_opens_the_frontend_profile_route(self):
        profile = parse_launch_profile("steam-deck-iss")
        self.assertEqual(profile, "steam-deck-iss")
        self.assertEqual(
            build_start_url("http://127.0.0.1:8000", profile),
            "http://127.0.0.1:8000/?profile=steam-deck-iss",
        )

    def test_unknown_profile_uses_the_default(self):
        self.assertEqual(parse_launch_profile("unknown"), "default")


if __name__ == "__main__":
    unittest.main()
