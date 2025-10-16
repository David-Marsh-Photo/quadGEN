#!/usr/bin/env python3
"""Generate SVG plots for TRIFORCE_V4 measurement data and its inverse correction."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple


DATA_PATH = Path("data/TRIFORCE_V4.txt")
OUTPUT_DIR = Path("artifacts")

SVG_WIDTH = 800
SVG_HEIGHT = 480
MARGIN_LEFT = 70
MARGIN_RIGHT = 24
MARGIN_TOP = 40
MARGIN_BOTTOM = 60


@dataclass(frozen=True)
class Sample:
    input_percent: float
    lab_l: float
    ink_percent: float


def read_measurements(path: Path) -> List[Sample]:
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        rows = list(reader)

    if not rows:
        raise ValueError(f"No measurement rows found in {path}")

    max_l = max(float(row["LAB_L"]) for row in rows)
    min_l = min(float(row["LAB_L"]) for row in rows)
    if max_l == min_l:
        raise ValueError("All LAB_L values are identical; cannot normalize to ink range.")

    samples: List[Sample] = []
    for row in rows:
        gray = float(row["GRAY"])
        lab_l = float(row["LAB_L"])
        ink = (max_l - lab_l) / (max_l - min_l)
        samples.append(Sample(input_percent=gray, lab_l=lab_l, ink_percent=ink * 100.0))
    samples.sort(key=lambda s: s.input_percent)
    return samples


def project_points(
    points: Sequence[Tuple[float, float]],
    x_range: Tuple[float, float] = (0.0, 100.0),
    y_range: Tuple[float, float] = (0.0, 100.0),
) -> List[Tuple[float, float]]:
    x_min, x_max = x_range
    y_min, y_max = y_range
    chart_width = SVG_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
    chart_height = SVG_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

    projected: List[Tuple[float, float]] = []
    for x, y in points:
        x_norm = (x - x_min) / (x_max - x_min) if x_max != x_min else 0.0
        y_norm = (y - y_min) / (y_max - y_min) if y_max != y_min else 0.0
        x_px = MARGIN_LEFT + x_norm * chart_width
        y_px = SVG_HEIGHT - MARGIN_BOTTOM - y_norm * chart_height
        projected.append((x_px, y_px))
    return projected


def svg_polyline(
    points: Sequence[Tuple[float, float]],
    *,
    stroke: str,
    stroke_width: float,
    fill: str = "none",
    dasharray: str | None = None,
) -> str:
    coords = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    dash_attr = f' stroke-dasharray="{dasharray}"' if dasharray else ""
    return f'<polyline points="{coords}" fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}"{dash_attr}/>\n'


def svg_circles(points: Sequence[Tuple[float, float]], *, radius: float, fill: str, stroke: str | None = None) -> str:
    parts = []
    for x, y in points:
        attrs = [f'cx="{x:.2f}"', f'cy="{y:.2f}"', f'r="{radius:.2f}"', f'fill="{fill}"']
        if stroke:
            attrs.append(f'stroke="{stroke}"')
            attrs.append('stroke-width="1"')
        parts.append(f"<circle {' '.join(attrs)}/>\n")
    return "".join(parts)


def svg_axes(x_label: str, y_label: str, *, x_ticks: Iterable[float] = (), y_ticks: Iterable[float] = ()) -> str:
    chart_width = SVG_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
    chart_height = SVG_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    x_axis_y = SVG_HEIGHT - MARGIN_BOTTOM
    y_axis_x = MARGIN_LEFT

    axes = [
        f'<line x1="{MARGIN_LEFT}" y1="{x_axis_y}" x2="{MARGIN_LEFT + chart_width}" y2="{x_axis_y}" stroke="#333" stroke-width="1.5"/>',
        f'<line x1="{y_axis_x}" y1="{MARGIN_TOP}" x2="{y_axis_x}" y2="{x_axis_y}" stroke="#333" stroke-width="1.5"/>',
        f'<text x="{MARGIN_LEFT + chart_width/2:.2f}" y="{SVG_HEIGHT - 15:.2f}" text-anchor="middle" font-family="Inter, sans-serif" font-size="16">{x_label}</text>',
        f'<text x="20" y="{MARGIN_TOP + chart_height/2:.2f}" text-anchor="middle" font-family="Inter, sans-serif" font-size="16" transform="rotate(-90 20,{MARGIN_TOP + chart_height/2:.2f})">{y_label}</text>',
    ]

    for tick in x_ticks:
        x = project_points([(tick, 0)], y_range=(0, 1))[0][0]
        axes.append(f'<line x1="{x:.2f}" y1="{x_axis_y}" x2="{x:.2f}" y2="{x_axis_y + 6}" stroke="#333" stroke-width="1"/>')
        axes.append(f'<text x="{x:.2f}" y="{x_axis_y + 22:.2f}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12">{tick:g}</text>')

    for tick in y_ticks:
        y = project_points([(0, tick)], x_range=(0, 1))[0][1]
        axes.append(f'<line x1="{y_axis_x - 6}" y1="{y:.2f}" x2="{y_axis_x}" y2="{y:.2f}" stroke="#333" stroke-width="1"/>')
        axes.append(f'<text x="{y_axis_x - 10:.2f}" y="{y + 4:.2f}" text-anchor="end" font-family="Inter, sans-serif" font-size="12">{tick:g}</text>')

    return "\n".join(axes) + "\n"


def svg_title(title: str) -> str:
    return f'<text x="{SVG_WIDTH/2:.2f}" y="{MARGIN_TOP - 12:.2f}" text-anchor="middle" font-family="Inter, sans-serif" font-size="18" font-weight="600">{title}</text>\n'


def invert_mapping(samples: Sequence[Sample], *, sample_count: int = 256) -> List[Tuple[float, float]]:
    ink_values = [s.ink_percent for s in samples]
    input_values = [s.input_percent for s in samples]

    pairs = sorted(zip(ink_values, input_values))
    xs, ys = zip(*pairs)

    result: List[Tuple[float, float]] = []
    targets = [i * 100.0 / (sample_count - 1) for i in range(sample_count)]
    for target in targets:
        if target <= xs[0]:
            if xs[1] == xs[0]:
                inv = ys[0]
            else:
                t = (target - xs[0]) / (xs[1] - xs[0])
                inv = ys[0] + t * (ys[1] - ys[0])
        elif target >= xs[-1]:
            if xs[-1] == xs[-2]:
                inv = ys[-1]
            else:
                t = (target - xs[-2]) / (xs[-1] - xs[-2])
                inv = ys[-2] + t * (ys[-1] - ys[-2])
        else:
            for i in range(len(xs) - 1):
                if xs[i] <= target <= xs[i + 1]:
                    span = xs[i + 1] - xs[i]
                    t = 0.0 if span == 0 else (target - xs[i]) / span
                    inv = ys[i] + t * (ys[i + 1] - ys[i])
                    break
            else:
                inv = ys[-1]
        result.append((target, inv))
    return result


def build_measurement_svg(samples: Sequence[Sample]) -> str:
    measurement_points = [(s.input_percent, s.lab_l) for s in samples]
    projected_line = project_points(measurement_points, x_range=(0, 100), y_range=(0, 100))
    measurement_circles = svg_circles(projected_line, radius=3.0, fill="#1f78b4")
    line = svg_polyline(projected_line, stroke="#1f78b4", stroke_width=2.0)
    axes = svg_axes("Input Gray (%)", "Measured L*", x_ticks=range(0, 101, 20), y_ticks=range(0, 101, 20))
    title = svg_title("TRIFORCE V4 — Measured L* Response")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">\n'
        f"{title}"
        f"{axes}"
        f"{line}"
        f"{measurement_circles}"
        "</svg>\n"
    )


def build_correction_svg(samples: Sequence[Sample]) -> str:
    inverse_curve = invert_mapping(samples, sample_count=256)
    projected_curve = project_points(inverse_curve, x_range=(0, 100), y_range=(0, 100))
    line = svg_polyline(projected_curve, stroke="#33a02c", stroke_width=2.5)

    # Plot original measured points in correction space for reference
    correction_samples = [(s.ink_percent, s.input_percent) for s in samples]
    projected_samples = project_points(correction_samples, x_range=(0, 100), y_range=(0, 100))
    measurement_line = svg_polyline(projected_samples, stroke="#1f78b4", stroke_width=1.8, dasharray="6 4")
    circles = svg_circles(projected_samples, radius=3.0, fill="#33a02c", stroke="#0f4214")

    axes = svg_axes("Target Tone (%)", "Required Input (%)", x_ticks=range(0, 101, 20), y_ticks=range(0, 101, 20))
    title = svg_title("TRIFORCE V4 — Linearization Correction (Inverse Mapping)")
    diagonal = svg_polyline(project_points([(0, 0), (100, 100)], x_range=(0, 100), y_range=(0, 100)), stroke="#888", stroke_width=1.5, fill="none")
    diagonal_label = (
        '<text x="{x:.2f}" y="{y:.2f}" font-family="Inter, sans-serif" font-size="12" fill="#555" transform="rotate(-38 {x:.2f},{y:.2f})">'
        "Ideal Response</text>\n"
    )
    diag_point = project_points([(70, 70)], x_range=(0, 100), y_range=(0, 100))[0]
    diagonal_label = diagonal_label.format(x=diag_point[0], y=diag_point[1])

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">\n'
        f"{title}"
        f"{axes}"
        f"{diagonal}"
        f"{diagonal_label}"
        f"{measurement_line}"
        f"{line}"
        f"{circles}"
        '<text x="620" y="90" font-family="Inter, sans-serif" font-size="12" fill="#1f78b4">Measured response (Input → Output)</text>\n'
        '<text x="620" y="110" font-family="Inter, sans-serif" font-size="12" fill="#33a02c">Correction curve (Target → Required input)</text>\n'
        "</svg>\n"
    )


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Cannot locate measurement file at {DATA_PATH}")

    OUTPUT_DIR.mkdir(exist_ok=True)

    samples = read_measurements(DATA_PATH)
    measurement_svg = build_measurement_svg(samples)
    correction_svg = build_correction_svg(samples)

    measurement_path = OUTPUT_DIR / "triforce_v4_measurement.svg"
    correction_path = OUTPUT_DIR / "triforce_v4_correction.svg"

    measurement_path.write_text(measurement_svg, encoding="utf-8")
    correction_path.write_text(correction_svg, encoding="utf-8")

    print(f"Wrote {measurement_path}")
    print(f"Wrote {correction_path}")


if __name__ == "__main__":
    main()
