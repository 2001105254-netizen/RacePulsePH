"""Bake the recorded running frames into a transparent 8x4 WebP atlas.

Optional authoring tool: Python 3.10+ and Pillow. No app/runtime dependencies.
Each 120x160 motion frame becomes a 240x320 sprite; the atlas is 1920x1280.
Drawing is performed at 3x output resolution and downsampled with Lanczos.
The flat illustration is reduced to 64 RGBA colors before lossless WebP encoding.
"""

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCALE = 6  # Three supersamples per output pixel, two output pixels per unit.
NEAR = (239, 232, 220, 255)
FAR = (125, 120, 115, 255)
RED = (244, 61, 48, 255)
FAR_RED = (165, 44, 36, 255)
SHORTS = (48, 48, 54, 255)
FAR_SHORTS = (39, 39, 44, 255)


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def mul(a, s):
    return (a[0] * s, a[1] * s)


def mix(a, b, t):
    return add(mul(a, 1 - t), mul(b, t))


def direction(a, b):
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    return ((b[0] - a[0]) / length, (b[1] - a[1]) / length)


def render(frame):
    canvas = Image.new("RGBA", (120 * SCALE, 160 * SCALE))
    draw = ImageDraw.Draw(canvas)

    def polygon(points, color):
        draw.polygon([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color)

    def circle(p, r, color):
        x, y = p
        draw.ellipse(tuple(round(v * SCALE) for v in (x - r, y - r, x + r, y + r)), fill=color)

    def capsule(a, b, width_a, width_b, color):
        # Explicit circles retain round endpoints at every angle and length.
        u = direction(a, b)
        n = (-u[1], u[0])
        ra, rb = width_a / 2, width_b / 2
        polygon([add(a, mul(n, ra)), add(b, mul(n, rb)), add(b, mul(n, -rb)), add(a, mul(n, -ra))], color)
        circle(a, ra, color)
        circle(b, rb, color)

    def leg(hip, knee, ankle, toe, skin, shoe, shorts):
        h, k, a, t = [frame[i] for i in (hip, knee, ankle, toe)]
        capsule(h, k, 8.0, 5.6, skin)
        calf = mix(k, a, .38)
        capsule(k, calf, 5.6, 6.0, skin)
        capsule(calf, a, 6.0, 3.4, skin)
        # Shorts follow the measured thigh angle without moving either joint.
        capsule(h, mix(h, k, .26), 9.8, 8.7, shorts)
        # Fitted shoe follows the observed ankle-to-toe direction, with a
        # shallow toe and a slight rear heel rather than a round blob.
        u = direction(a, t)
        n = (-u[1], u[0])
        heel = add(a, mul(u, -.7))
        toe_end = add(t, mul(u, .3))
        capsule(heel, mix(a, t, .55), 5.0, 4.6, shoe)
        capsule(mix(a, t, .55), toe_end, 4.6, 3.2, shoe)
        capsule(add(heel, mul(n, 1.5)), add(toe_end, mul(n, 1.1)), .7, .7, (201, 196, 187, 255))

    def arm(shoulder, elbow, wrist, skin):
        s, e, w = [frame[i] for i in (shoulder, elbow, wrist)]
        capsule(s, mix(s, e, .5), 6.3, 5.6, skin)
        capsule(mix(s, e, .5), e, 5.6, 4.1, skin)
        capsule(e, mix(e, w, .35), 4.3, 4.7, skin)
        capsule(mix(e, w, .35), w, 4.7, 3.0, skin)
        circle(add(w, mul(direction(e, w), .6)), 1.9, skin)

    # Measured right limbs are visually behind the trunk in this projection.
    leg(14, 15, 16, 17, FAR, FAR_RED, FAR_SHORTS)
    arm(7, 8, 9, FAR)
    # Hips and near leg are below the singlet in the drawing stack.
    hip_center = mix(frame[10], frame[14], .5)
    capsule(frame[3], hip_center, 13.4, 13.0, SHORTS)
    leg(10, 11, 12, 13, NEAR, RED, SHORTS)

    shoulder_center = mix(frame[4], frame[7], .5)
    trunk_u = direction(shoulder_center, frame[3])
    trunk_n = (-trunk_u[1], trunk_u[0])
    # Compact neck and a fitted, tapering singlet. Side contour has several
    # samples so the waist reads as garment structure rather than a thick bar.
    capsule(frame[1], shoulder_center, 5.0, 6.2, NEAR)
    trunk_length = math.hypot(frame[3][0] - shoulder_center[0], frame[3][1] - shoulder_center[1])
    sections = [(0, 5.4), (.13, 7.6), (.34, 8.0), (.69, 6.2), (1.05, 7.0)]
    left = [add(add(shoulder_center, mul(trunk_u, t * trunk_length)), mul(trunk_n, r)) for t, r in sections]
    right = [add(add(shoulder_center, mul(trunk_u, t * trunk_length)), mul(trunk_n, -r)) for t, r in reversed(sections)]
    polygon(left + right, RED)
    circle(shoulder_center, 5.4, RED)
    # Restrained seam provides a readable fabric edge, with no lighting effects.
    capsule(mix(left[1], left[2], .2), left[3], .6, .6, (211, 47, 38, 255))

    # Small white race-bib panel integrated with the red singlet. At normal
    # loading-screen size it reads as a bib, without illegible tiny lettering.
    bib_center = mix(shoulder_center, frame[3], .60)
    polygon([
        add(add(bib_center, mul(trunk_u, -3.0)), mul(trunk_n, -4.0)),
        add(add(bib_center, mul(trunk_u, -3.0)), mul(trunk_n, 4.0)),
        add(add(bib_center, mul(trunk_u, 3.0)), mul(trunk_n, 4.0)),
        add(add(bib_center, mul(trunk_u, 3.0)), mul(trunk_n, -4.0)),
    ], (244, 237, 225, 255))
    capsule(add(bib_center, mul(trunk_n, -2.3)), add(bib_center, mul(trunk_n, 2.3)), .8, .8, SHORTS)

    arm(4, 5, 6, NEAR)
    # Shoulder strap lies over the top edge of the near arm.
    capsule(add(frame[4], mul(trunk_u, -.2)), add(frame[4], mul(trunk_u, 2)), 5.4, 4.8, RED)

    # Side-profile head, not a pictogram circle. Crown/neck midpoint comes from
    # recorded joints; the contour is original illustrative character styling.
    center = mix(frame[0], frame[1], .5)
    center = (center[0], center[1] - 1.7)
    head_u = direction(frame[1], frame[0])
    head_right = (-head_u[1], head_u[0])
    def headpoint(x, y):
        return add(add(center, mul(head_right, x)), mul(head_u, -y))
    # The back cranium is sampled as an arc and the face as a discrete profile.
    contour = [(-3.0, 5.8), (-4.8, 3.6), (-5.5, .5), (-5.0, -3.8), (-3.2, -6.6),
               (0.0, -7.2), (3.0, -6.1), (4.8, -3.9), (4.7, -1.4), (6.6, .5),
               (5.1, 1.3), (5.0, 3.3), (3.4, 5.4), (1.5, 6.3), (-1.1, 6.0)]
    polygon([headpoint(x, y) for x, y in contour], NEAR)
    # A clean short hair shape lends a human profile without facial animation.
    hair = [(-4.8, 2.0), (-5.6, -.3), (-5.2, -4.0), (-3.1, -6.9), (.2, -7.6),
            (3.2, -6.4), (4.8, -4.4), (2.6, -3.5), (.0, -4.2), (-2.2, -2.6), (-3.7, .8)]
    polygon([headpoint(x, y) for x, y in hair], (47, 45, 44, 255))
    return canvas.resize((240, 320), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "src/assets/runner-sprite.webp")
    parser.add_argument("--preview", type=Path, help="Optional contact-sheet preview outside the app assets")
    args = parser.parse_args()
    source = (ROOT / "src/assets/runner-motion.ts").read_text(encoding="utf-8")
    motion = json.loads(source.split("export const runnerMotion = ", 1)[1].rsplit(" as const;", 1)[0])
    if len(motion["frames"]) != 32:
        raise ValueError("Expected 32 recorded frames")
    frames = [render(frame) for frame in motion["frames"]]
    atlas = Image.new("RGBA", (1920, 1280))
    for i, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((i % 8) * 240, (i // 8) * 320))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Palette reduction retains transparent antialiased edges while removing
    # thousands of nearly identical edge colors. This preserves 2x frames at
    # less than one third of the unrestricted-color lossless file size.
    atlas = atlas.quantize(
        colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE,
    ).convert("RGBA")
    atlas.save(args.output, "WEBP", lossless=True, method=4)
    with Image.open(args.output) as verified:
        if verified.size != (1920, 1280) or verified.mode != "RGBA":
            raise ValueError("Unexpected atlas dimensions or missing transparency")
        if verified.getpixel((0, 0))[3] != 0:
            raise ValueError("Background is not transparent")
    print(f"Wrote {args.output}: {args.output.stat().st_size:,} bytes; 8x4, 240x320 per frame; transparent 64-color WebP")
    if args.preview:
        preview = Image.new("RGB", (960, 640), (10, 10, 10))
        for i, index in enumerate(range(0, 32, 4)):
            x, y = (index % 8) * 240, (index // 8) * 320
            frame = atlas.crop((x, y, x + 240, y + 320))
            preview.paste(frame, ((i % 4) * 240, (i // 4) * 320), frame)
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        preview.save(args.preview)
        print(f"Preview: {args.preview}")


if __name__ == "__main__":
    main()
