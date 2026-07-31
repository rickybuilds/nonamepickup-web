"""Convert the TFC flag model's team skin families into static GLB assets."""

from pathlib import Path

from convert_goldsrc_player_models import ROOT, convert


OBJECTIVE_ROOT = ROOT / "assets" / "models" / "objectives"
TEAM_SKINS = (
    ("blue", 1),
    ("red", 2),
    ("yellow", 3),
    ("green", 4),
)


def main() -> None:
    source = OBJECTIVE_ROOT / "flag.mdl"
    if not source.is_file():
        raise SystemExit(f"Missing objective model: {source}")

    for team, skin_family in TEAM_SKINS:
        convert(
            source,
            target=OBJECTIVE_ROOT / f"flag_{team}.glb",
            skin_family=skin_family,
            filter_player_team_meshes=False,
            generator="NoName GoldSrc objective converter",
        )


if __name__ == "__main__":
    main()
