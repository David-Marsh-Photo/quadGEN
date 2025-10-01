#!/usr/bin/env python3
"""Compare two screenshots and assert that they differ by at least a minimum delta."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageChops, ImageStat


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path, help="Path to the pre-change screenshot")
    parser.add_argument("after", type=Path, help="Path to the post-change screenshot")
    parser.add_argument(
        "--min-delta",
        type=float,
        default=0.01,
        help="Minimum normalized mean absolute difference (0-1) required for success",
    )
    parser.add_argument(
        "--crop",
        type=int,
        nargs=4,
        metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"),
        help="Optional crop box to narrow the comparison region",
    )
    return parser.parse_args()


def load_image(path: Path) -> Image.Image:
    try:
        return Image.open(path).convert("RGB")
    except Exception as exc:  # pragma: no cover - defensive logging
        raise SystemExit(f"Unable to load image {path}: {exc}")


def normalized_mean_diff(diff_image: Image.Image) -> float:
    stat = ImageStat.Stat(diff_image)
    mean_per_channel = stat.mean  # 0-255 per channel
    # Average the RGB channel means and normalize to [0,1]
    return sum(mean_per_channel) / (len(mean_per_channel) * 255.0)


def compare(before: Path, after: Path, min_delta: float, crop: Tuple[int, int, int, int] | None) -> float:
    img_before = load_image(before)
    img_after = load_image(after)

    if img_before.size != img_after.size:
        raise SystemExit(
            f"Image dimensions differ: {img_before.size} vs {img_after.size}. Cannot compare."
        )

    if crop is not None:
        img_before = img_before.crop(crop)
        img_after = img_after.crop(crop)

    diff = ImageChops.difference(img_before, img_after)
    delta = normalized_mean_diff(diff)

    if delta < min_delta:
        raise SystemExit(
            f"Images too similar: normalized delta {delta:.6f} < required {min_delta:.6f}"
        )

    return delta


def main() -> None:
    args = parse_args()
    delta = compare(args.before, args.after, args.min_delta, tuple(args.crop) if args.crop else None)
    print(f"delta={delta:.6f}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exit_exc:
        # Propagate exit codes but ensure message is written to stderr for failing cases
        if exit_exc.code not in (0, None):
            message = str(exit_exc)
            if message:
                sys.stderr.write(message + "\n")
        raise
