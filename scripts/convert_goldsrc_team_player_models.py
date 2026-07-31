"""Bake GoldSrc player colormap textures into team-specific classic GLBs."""

from convert_goldsrc_player_models import PLAYER_ROOT, convert


TEAM_COLORS = {
    "blue": (77, 163, 255),
    "red": (255, 93, 108),
    "yellow": (250, 204, 21),
    "green": (74, 222, 128),
}


def main() -> None:
    sources = sorted(PLAYER_ROOT.glob("*/*2.mdl"))
    civilian = PLAYER_ROOT / "civilian" / "civilian.mdl"
    if civilian.is_file():
        sources.insert(0, civilian)
    if not sources:
        raise SystemExit(f"No classic player MDLs found under {PLAYER_ROOT}")

    for source in sources:
        for team, color in TEAM_COLORS.items():
            convert(
                source,
                target=source.with_name(f"{source.stem}_{team}.glb"),
                team_color=color,
                generator="NoName GoldSrc team player converter",
            )
            convert(
                source,
                target=source.with_name(f"{source.stem}_{team}_crouch.glb"),
                team_color=color,
                sequence_name="crouch_idle",
                generator="NoName GoldSrc crouched team player converter",
            )


if __name__ == "__main__":
    main()
