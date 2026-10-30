from typing import Literal, Optional

LaunchProfile = Literal["default", "steam-deck-iss"]


def parse_launch_profile(value: Optional[str]) -> LaunchProfile:
    if value == "steam-deck-iss":
        return value
    return "default"


def build_start_url(base_url: str, profile: LaunchProfile) -> str:
    if profile == "steam-deck-iss":
        return f"{base_url.rstrip('/')}/?profile={profile}"
    return base_url
