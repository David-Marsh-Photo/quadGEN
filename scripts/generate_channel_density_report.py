#!/usr/bin/env python3
"""
Generate visual artifacts and a scientific-style PDF report for the channel density solver.

Outputs
-------
- artifacts/channel-density/triforce_v4_density_figures.png
- artifacts/channel-density/triforce_v4_density_figures.svg
- docs/features/channel-density-solver-report.pdf
- artifacts/channel-density/triforce_v4_density_metrics.json
"""

import csv
import json
from pathlib import Path
from typing import Dict, List, Tuple

import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

DOMINANCE_THRESHOLD = 0.9
SUPPORT_THRESHOLD = 0.2
MIN_SHARE_THRESHOLD = 0.01
EPSILON = 1e-6
DENSITY_MAX_ITERATIONS = 8


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
ARTIFACT_DIR = REPO_ROOT / "artifacts" / "channel-density"
DOCS_DIR = REPO_ROOT / "docs" / "features"

QUAD_PATH = DATA_DIR / "TRIFORCE_V4.quad"
LAB_PATH = DATA_DIR / "TRIFORCE_V4.txt"

FIG_PNG_PATH = ARTIFACT_DIR / "triforce_v4_density_figures.png"
FIG_SVG_PATH = ARTIFACT_DIR / "triforce_v4_density_figures.svg"
METRICS_PATH = ARTIFACT_DIR / "triforce_v4_density_metrics.json"
PDF_PATH = DOCS_DIR / "channel-density-solver-report.pdf"


def ensure_dependencies() -> None:
    """Surface helpful guidance if required files are missing."""
    missing = [path for path in (QUAD_PATH, LAB_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(p) for p in missing)
        raise FileNotFoundError(f"Required dataset files missing: {joined}")


def load_quad_curves(path: Path) -> Dict[str, List[float]]:
    """Parse .quad file into channel->draw list mapping."""
    channels: Dict[str, List[float]] = {}
    current_channel = None
    buffer: List[float] = []

    with path.open() as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                token = line.lstrip("#").strip()
                if token.endswith("curve"):
                    if current_channel and buffer:
                        channels[current_channel] = buffer
                    current_channel = token[:-5].strip()
                    buffer = []
                continue
            try:
                value = float(line)
            except ValueError:
                continue
            buffer.append(value)

    if current_channel and buffer and current_channel not in channels:
        channels[current_channel] = buffer
    return channels


def load_lab_measurements(path: Path) -> List[Dict[str, float]]:
    """Read LAB .txt rows into sorted list of dicts."""
    rows: List[Dict[str, float]] = []
    with path.open() as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            rows.append({key: float(value) for key, value in row.items()})
    rows.sort(key=lambda r: r["GRAY"])
    return rows


def sample_draw(draws: List[float], input_percent: float) -> float:
    """Return draw value for a channel at the given input using nearest sample."""
    if not draws:
        return 0.0
    idx = round(input_percent / 100 * (len(draws) - 1))
    return draws[idx]


def compute_density_metrics(
    quad_curves: Dict[str, List[float]],
    lab_rows: List[Dict[str, float]],
) -> Dict[str, object]:
    """Compute channel share, incremental deltas, and cumulative contributions."""
    inputs = [row["GRAY"] for row in lab_rows]
    l_values = [row["LAB_L"] for row in lab_rows]

    delta_l: List[float] = []
    prev_l = None
    for l_star in l_values:
        if prev_l is None:
            delta_l.append(0.0)
        else:
            delta_l.append(max(prev_l - l_star, 0.0))
        prev_l = l_star

    channel_shares: Dict[str, List[float]] = {name: [] for name in quad_curves}
    active_channels = [
        name for name, values in quad_curves.items() if any(value > EPSILON for value in values)
    ]
    if not active_channels:
        active_channels = list(quad_curves.keys())

    for idx, input_percent in enumerate(inputs):
        draws = {
            name: sample_draw(values, input_percent)
            for name, values in quad_curves.items()
        }
        total_draw = sum(draws.values())
        for name in quad_curves:
            share = draws[name] / total_draw if total_draw > 0 else 0.0
            channel_shares[name].append(share)

    key_channels = [name for name in ["LK", "C", "K"] if name in quad_curves]
    highlight_idx = inputs.index(7.5) if 7.5 in inputs else 0
    mid_idx = inputs.index(35.0) if 35.0 in inputs else len(inputs) // 2
    shadow_idx = inputs.index(90.0) if 90.0 in inputs else len(inputs) - 1

    snapshots = [
        ("Highlight", inputs[highlight_idx], delta_l[highlight_idx]),
        ("Midtone", inputs[mid_idx], delta_l[mid_idx]),
        ("Shadow", inputs[shadow_idx], delta_l[shadow_idx]),
    ]

    snapshot_rows: List[Dict[str, object]] = []
    for label, gray, delta in snapshots:
        row_index = inputs.index(gray)
        row = {
            "region": label,
            "input": gray,
            "delta": delta,
            "shares": {
                name: channel_shares[name][row_index]
                for name in key_channels
            },
        }
        snapshot_rows.append(row)

    # Derive density constants through dominance scanning
    order_info: List[Tuple[int, str]] = []
    for name in active_channels:
        shares = channel_shares[name]
        first_idx = None
        for idx, share in enumerate(shares):
            if delta_l[idx] <= EPSILON:
                continue
            if share >= DOMINANCE_THRESHOLD:
                first_idx = idx
                break
        if first_idx is None:
            for idx, share in enumerate(shares):
                if delta_l[idx] <= EPSILON:
                    continue
                if share >= SUPPORT_THRESHOLD:
                    first_idx = idx
                    break
        if first_idx is None:
            for idx, share in enumerate(shares):
                if share > MIN_SHARE_THRESHOLD:
                    first_idx = idx
                    break
        order_info.append((first_idx if first_idx is not None else len(delta_l) + 1, name))

    order_info.sort()
    density_constants: Dict[str, float] = {name: 0.0 for name in active_channels}
    calibrated: List[str] = []
    total_density = sum(delta_l) or 1.0

    for _, name in order_info:
        shares = channel_shares[name]
        residual_sum = 0.0
        share_sum = 0.0
        for idx, delta in enumerate(delta_l):
            if delta <= EPSILON:
                continue
            share = shares[idx]
            if share <= MIN_SHARE_THRESHOLD:
                continue
            residual = delta
            for prev in calibrated:
                residual -= density_constants[prev] * channel_shares[prev][idx]
            if residual <= EPSILON:
                continue
            residual_sum += residual
            share_sum += share
        constant = residual_sum / share_sum if share_sum > EPSILON else 0.0
        remaining = max(0.0, total_density - sum(density_constants.values()))
        if constant > remaining:
            constant = remaining
        density_constants[name] = max(0.0, constant)
        calibrated.append(name)

    leftover = max(0.0, total_density - sum(density_constants.values()))
    if leftover > EPSILON and calibrated:
        density_constants[calibrated[-1]] += leftover

    # Allocate density contributions per index using waterfilling
    remaining = {name: density_constants.get(name, 0.0) for name in active_channels}
    density_profiles: List[Dict[str, object]] = []
    cumulative = {name: 0.0 for name in active_channels}

    for idx, delta in enumerate(delta_l):
        if delta <= EPSILON:
            density_profiles.append({"density": delta, "shares": {}})
            continue

        contributions = {name: 0.0 for name in active_channels}
        candidate_names = [
            name for name in active_channels
            if channel_shares[name][idx] > MIN_SHARE_THRESHOLD and remaining[name] > EPSILON
        ]
        weights = {
            name: density_constants[name] * channel_shares[name][idx]
            for name in candidate_names
        }
        delta_remaining = delta
        iteration = 0

        while delta_remaining > EPSILON and candidate_names and iteration < DENSITY_MAX_ITERATIONS:
            iteration += 1
            total_weight = sum(weights[name] for name in candidate_names)
            if total_weight <= EPSILON:
                equal_share = delta_remaining / len(candidate_names)
                consumed = 0.0
                for name in candidate_names:
                    amount = min(equal_share, remaining[name])
                    if amount > EPSILON:
                        contributions[name] += amount
                        remaining[name] -= amount
                        consumed += amount
                if consumed <= EPSILON:
                    break
                delta_remaining -= consumed
            else:
                consumed = 0.0
                for name in candidate_names:
                    portion = (weights[name] / total_weight) * delta_remaining
                    amount = min(portion, remaining[name])
                    if amount > EPSILON:
                        contributions[name] += amount
                        remaining[name] -= amount
                        consumed += amount
                if consumed <= EPSILON:
                    break
                delta_remaining -= consumed

            candidate_names = [
                name for name in candidate_names
                if remaining[name] > EPSILON and channel_shares[name][idx] > MIN_SHARE_THRESHOLD
            ]
            weights = {
                name: density_constants[name] * channel_shares[name][idx]
                for name in candidate_names
            }

        if delta_remaining > EPSILON:
            fallback_name = max(
                active_channels,
                key=lambda ch: remaining[ch] * channel_shares[ch][idx]
            )
            if remaining[fallback_name] > EPSILON:
                amount = min(delta_remaining, remaining[fallback_name])
                contributions[fallback_name] += amount
                remaining[fallback_name] -= amount
                delta_remaining -= amount

        shares_entry = {}
        for name, amount in contributions.items():
            if amount > EPSILON:
                shares_entry[name] = amount / delta
                cumulative[name] += amount
        density_profiles.append({
            "density": delta,
            "shares": shares_entry
        })

    total_delta = sum(delta_l) or 1.0
    contribution_pct = {
        name: (cumulative[name] / total_delta) * 100 for name in cumulative
    }

    normalized_constants = {
        name: (density_constants[name] / total_delta) if total_delta > EPSILON else 0.0
        for name in density_constants
    }

    return {
        "inputs": inputs,
        "l_values": l_values,
        "delta_l": delta_l,
        "channel_shares": channel_shares,
        "cumulative": cumulative,
        "contribution_pct": contribution_pct,
        "snapshots": snapshot_rows,
        "density_constants": normalized_constants,
        "density_profiles": density_profiles,
        "active_channels": active_channels,
    }


def render_figures(metrics: Dict[str, object]) -> None:
    """Render composite figure illustrating L* curve, channel shares, and cumulative density."""
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    inputs: List[float] = metrics["inputs"]  # type: ignore[assignment]
    l_values: List[float] = metrics["l_values"]  # type: ignore[assignment]
    delta_l: List[float] = metrics["delta_l"]  # type: ignore[assignment]
    shares: Dict[str, List[float]] = metrics["channel_shares"]  # type: ignore[assignment]
    density_profiles: List[Dict[str, object]] = metrics["density_profiles"]  # type: ignore[assignment]

    key_channels = ["LK", "C", "K"]
    colors_map = {"LK": "#1f77b4", "C": "#ff7f0e", "K": "#2ca02c"}

    plt.style.use("seaborn-v0_8-darkgrid")  # Modern but readable
    fig, axes = plt.subplots(3, 1, figsize=(8.5, 11), constrained_layout=True)

    # Panel A: L* curve with incremental delta markers
    ax0 = axes[0]
    ax0.plot(inputs, l_values, color="#222222", linewidth=2, label="Measured L*")
    ax0.set_title("Panel A — Measured L* Ramp (TRIFORCE_V4)", loc="left", fontweight="bold")
    ax0.set_xlabel("Input Level (%)")
    ax0.set_ylabel("L* (lower is darker)")
    ax0.invert_yaxis()
    ax0.legend(loc="upper right")

    # Annotate positive deltas
    for x, l_val, delta in zip(inputs[1:], l_values[1:], delta_l[1:]):
        if delta > 0.8:
            ax0.annotate(
                f"-{delta:.1f}",
                xy=(x, l_val),
                xytext=(0, 12),
                textcoords="offset points",
                ha="center",
                fontsize=8,
                color="#555555",
            )

    # Panel B: Channel share stackplot (LK, C, K)
    ax1 = axes[1]
    stack_values = [shares[name] for name in key_channels]
    ax1.stackplot(
        inputs,
        *stack_values,
        labels=[f"{name} share" for name in key_channels],
        colors=[colors_map[name] for name in key_channels],
        alpha=0.85,
    )
    ax1.set_ylim(0, 1)
    ax1.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax1.set_title("Panel B — Channel Share Across the Ramp", loc="left", fontweight="bold")
    ax1.set_xlabel("Input Level (%)")
    ax1.set_ylabel("Ink Share (%)")
    ax1.legend(loc="upper right")

    # Panel C: Cumulative density attribution
    ax2 = axes[2]
    total_density = sum(profile.get("density", 0.0) for profile in density_profiles) or 1.0
    running_totals = {name: [] for name in key_channels}
    partial = {name: 0.0 for name in key_channels}
    for idx, profile in enumerate(density_profiles):
        density_value = profile.get("density", 0.0)
        share_entry = profile.get("shares", {}) or {}
        for name in key_channels:
            partial[name] += density_value * share_entry.get(name, 0.0)
            running_totals[name].append(partial[name] / total_density * 100)

    for name in key_channels:
        ax2.plot(inputs, running_totals[name], label=f"{name}", color=colors_map[name], linewidth=2)

    ax2.set_title("Panel C — Cumulative Density Attribution", loc="left", fontweight="bold")
    ax2.set_xlabel("Input Level (%)")
    ax2.set_ylabel("Cumulative Contribution (%)")
    ax2.set_ylim(0, 100)
    ax2.legend(loc="upper left")

    fig.suptitle(
        "Channel Density Analysis — TRIFORCE_V4 Dataset",
        fontsize=14,
        fontweight="bold",
    )

    fig.savefig(FIG_PNG_PATH, dpi=300)
    fig.savefig(FIG_SVG_PATH)
    plt.close(fig)


def build_pdf(metrics: Dict[str, object]) -> None:
    """Compose a scientific-style PDF integrating narrative and figures."""
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="SectionHeading",
            parent=styles["Heading2"],
            spaceAfter=12,
            spaceBefore=18,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyTextCustom",
            parent=styles["BodyText"],
            leading=14,
            spaceAfter=12,
        )
    )

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=letter,
        leftMargin=0.85 * inch,
        rightMargin=0.85 * inch,
        topMargin=0.9 * inch,
        bottomMargin=0.9 * inch,
        title="Channel Density Solver — TRIFORCE Case Study",
        author="quadGEN Lab",
        subject="Density attribution using multichannel measurement data",
    )

    story = []
    story.append(Paragraph("Channel Density Solver — TRIFORCE Case Study", styles["Title"]))
    story.append(Spacer(1, 12))

    abstract = (
        "This report documents the composite density attribution method applied to the "
        "TRIFORCE_V4 calibration set. We fuse the measured L* ramp with the corresponding "
        ".quad ink draws to estimate the effective density each channel contributes across the "
        "tone scale. The resulting weights inform the composite redistribution solver so that "
        "highlight inks are not over-credited and the shadow anchor retains control of maximum density."
    )
    story.append(Paragraph("<b>Abstract.</b> " + abstract, styles["BodyTextCustom"]))

    story.append(Paragraph("1. Introduction", styles["SectionHeading"]))
    intro = (
        "Multichannel linearization requires reconciling per-channel ink usage with a single measured "
        "tone response. The channel density solver addresses this by pairing the LAB measurement "
        "ladder with the source .quad file. By inspecting which channel dominates each input step, "
        "we bound the density each ink can plausibly deliver and prevent weak highlight channels "
        "from inflating the composite correction when they reappear alongside stronger inks."
    )
    story.append(Paragraph(intro, styles["BodyTextCustom"]))

    story.append(Paragraph("2. Materials and Methods", styles["SectionHeading"]))
    methods = (
        "The TRIFORCE_V4 dataset comprises 25 LAB samples spanning 0–100% input and a multi-channel "
        ".quad describing the draw ratios for K, C, and LK (all other channels disabled). "
        "For each step we calculate the L* decrement relative to the previous sample (ΔL*) and "
        "the fractional ink contribution per channel. Highlight intervals where a single channel exceeds "
        "a 90% share are treated as dominance windows that establish the channel's solo density ceiling. "
        "Subsequent mixed intervals distribute ΔL* in proportion to the measured shares while respecting "
        "the established ceilings."
    )
    story.append(Paragraph(methods, styles["BodyTextCustom"]))

    story.append(Paragraph("3. Results", styles["SectionHeading"]))

    snapshots = metrics["snapshots"]  # type: ignore[assignment]
    table_data = [["Region", "Input (%)", "ΔL*", "LK Share", "C Share", "K Share"]]
    for snapshot in snapshots:
        shares = snapshot["shares"]  # type: ignore[index]
        table_data.append(
            [
                snapshot["region"],  # type: ignore[index]
                f"{snapshot['input']:.1f}",  # type: ignore[index]
                f"{snapshot['delta']:.2f}",  # type: ignore[index]
                f"{shares.get('LK', 0.0)*100:5.1f}%",
                f"{shares.get('C', 0.0)*100:5.1f}%",
                f"{shares.get('K', 0.0)*100:5.1f}%",
            ]
        )

    table = Table(table_data, hAlign="LEFT")
    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
            ("ALIGN", (1, 1), (-1, -1), "CENTER"),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ]
    )
    table.setStyle(table_style)
    story.append(table)
    story.append(Spacer(1, 12))

    contribution_pct = metrics["contribution_pct"]  # type: ignore[assignment]
    lk_pct = contribution_pct.get("LK", 0.0)
    k_pct = contribution_pct.get("K", 0.0)
    c_pct = contribution_pct.get("C", 0.0)
    interpreted = (
        f"Integrated across the tone scale, the solver attributes {lk_pct:.1f}% of the darkening to LK, "
        f"{k_pct:.1f}% to K, and {c_pct:.1f}% to C. These weights align with the visual plot: LK alone "
        "drives the highlights, K assumes control past 70% input, and C acts as a midtone supporting ink."
    )
    story.append(Paragraph(interpreted, styles["BodyTextCustom"]))

    story.append(Paragraph("4. Density Constant Calibration Concept", styles["SectionHeading"]))
    density_constants = metrics["density_constants"]  # type: ignore[assignment]
    lk_const = density_constants.get("LK", 0.0) * 100
    c_const = density_constants.get("C", 0.0) * 100
    k_const = density_constants.get("K", 0.0) * 100
    concept = (
        "To tighten attribution we calibrate a density constant for each ink: the fraction of the total "
        "darkening it can produce when acting alone. For TRIFORCE, LK demonstrates roughly "
        f"{lk_const:.1f}% of the total density on its own; subtracting that ceiling leaves about "
        f"{c_const:.1f}% for C in the midtones. The remainder (≈{k_const:.1f}%) is credited to K, which "
        "anchors the shadows. At runtime the app exposes `getCompositeDensityProfile(inputPercent)` so operators "
        "can inspect the per-channel shares baked into each input step."
    )
    story.append(Paragraph(concept, styles["BodyTextCustom"]))

    const_rows = [["Channel", "Estimated Density Constant"]]
    for name in ["LK", "C", "K"]:
        const_rows.append([name, f"{density_constants.get(name, 0.0):.3f}"])
    const_table = Table(const_rows, hAlign="LEFT")
    const_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (1, 1), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ]
        )
    )
    story.append(const_table)
    story.append(Spacer(1, 12))

    story.append(Paragraph("5. Discussion", styles["SectionHeading"]))
    discussion = (
        "The TRIFORCE case study demonstrates why equal weighting distorts multichannel redistribution. "
        "When the solver honours dominance windows, the composite curve preserves the legacy amplitude "
        "while preventing highlight inks from saturating the headroom. Future work will evaluate adaptive "
        "thresholds for dominance detection and extend the analysis to datasets where more than three channels "
        "are active simultaneously."
    )
    story.append(Paragraph(discussion, styles["BodyTextCustom"]))

    story.append(Paragraph("Figure 1", styles["SectionHeading"]))
    story.append(
        Paragraph(
            "Composite visualisation of the TRIFORCE_V4 density analysis. Panel A shows the measured L* "
            "curve with annotated ΔL*. Panel B stackplots the fractional ink share for LK, C, and K. "
            "Panel C integrates the contributions to yield cumulative density weights.",
            styles["BodyTextCustom"],
        )
    )

    story.append(Image(str(FIG_PNG_PATH), width=6.5 * inch, height=8.0 * inch))

    story.append(PageBreak())
    story.append(Paragraph("Appendix A — Numerical Summary", styles["SectionHeading"]))
    appendix_rows = [["Channel", "Cumulative ΔL*", "Contribution (%)"]]
    cumulative = metrics["cumulative"]  # type: ignore[assignment]
    for name in ["LK", "C", "K"]:
        appendix_rows.append(
            [
                name,
                f"{cumulative.get(name, 0.0):.2f}",
                f"{contribution_pct.get(name, 0.0):.1f}%",
            ]
        )
    appendix_table = Table(appendix_rows, hAlign="LEFT")
    appendix_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (1, 1), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ]
        )
    )
    story.append(appendix_table)

    doc.build(story)


def main() -> None:
    ensure_dependencies()

    quad_curves = load_quad_curves(QUAD_PATH)
    lab_rows = load_lab_measurements(LAB_PATH)
    metrics = compute_density_metrics(quad_curves, lab_rows)

    render_figures(metrics)

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with METRICS_PATH.open("w") as fh:
        json.dump(metrics, fh, indent=2)

    build_pdf(metrics)
    print(f"Saved figure to {FIG_PNG_PATH}")
    print(f"Saved metrics to {METRICS_PATH}")
    print(f"Saved PDF report to {PDF_PATH}")


if __name__ == "__main__":
    main()
