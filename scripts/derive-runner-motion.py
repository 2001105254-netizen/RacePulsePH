"""Reproduce the recorded running cycle; authoring tool, never app runtime.

Requires Python 3.10+ and NumPy. By default downloads the two pinned CMU source
files into a temporary directory and verifies their SHA-256 hashes. Use
--source-dir for an offline run and --check to verify without changing output.
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.request import urlopen

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "09.asf": (
        "https://mocap.cs.cmu.edu/subjects/09/09.asf",
        "be10dbce393fd60a2d322410032d618757afcc5bb2f7a508d887c5b0213f1897",
    ),
    "09_01.amc": (
        "https://mocap.cs.cmu.edu/subjects/09/09_01.amc",
        "02c94e8c2d4d2ff05f9a784f06403700c2c9d7caedd9bd92b50284d1a05f2bee",
    ),
}
NAMES = [
    "head", "neck", "chest", "pelvis",
    "leftShoulder", "leftElbow", "leftWrist",
    "rightShoulder", "rightElbow", "rightWrist",
    "leftHip", "leftKnee", "leftAnkle", "leftToe",
    "rightHip", "rightKnee", "rightAnkle", "rightToe",
]
SOURCE_NAMES = [
    "head", "upperneck", "thorax", "root",
    "lclavicle", "lhumerus", "lradius",
    "rclavicle", "rhumerus", "rradius",
    "lhipjoint", "lfemur", "ltibia", "ltoes",
    "rhipjoint", "rfemur", "rtibia", "rtoes",
]
EDGES = [
    [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [2, 7], [7, 8], [8, 9],
    [3, 10], [10, 11], [11, 12], [12, 13], [3, 14], [14, 15], [15, 16], [16, 17],
]


def rotation(angles):
    x, y, z = np.radians(angles)
    rx = np.array([[1, 0, 0], [0, np.cos(x), -np.sin(x)], [0, np.sin(x), np.cos(x)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rz = np.array([[np.cos(z), -np.sin(z), 0], [np.sin(z), np.cos(z), 0], [0, 0, 1]])
    return rz @ ry @ rx


def parse_asf(path):
    bones, hierarchy = {}, {}
    state, bone = None, None
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0].startswith(":"):
            state = parts[0]
            continue
        if state == ":bonedata":
            key = parts[0]
            if key == "begin":
                bone = {}
            elif key == "end":
                bone["C"] = rotation(bone["axis"])
                bones[bone["name"]] = bone
            elif key == "name":
                bone["name"] = parts[1]
            elif key in ("direction", "axis"):
                bone[key] = np.array(list(map(float, parts[1:4])))
            elif key == "length":
                bone["length"] = float(parts[1])
            elif key == "dof":
                bone["dof"] = parts[1:]
        elif state == ":hierarchy" and parts[0] not in ("begin", "end"):
            hierarchy[parts[0]] = parts[1:]
    return bones, hierarchy


def parse_amc(path):
    frames, frame = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts or parts[0][0] in "#:":
            continue
        if parts[0].isdigit():
            frame = {}
            frames.append(frame)
        else:
            frame[parts[0]] = np.array(list(map(float, parts[1:])))
    return frames


def derive(source_dir):
    bones, hierarchy = parse_asf(source_dir / "09.asf")
    frames = parse_amc(source_dir / "09_01.amc")
    poses = []
    for frame in frames:
        positions = {"root": frame["root"][:3]}
        matrices = {"root": rotation(frame["root"][3:])}

        def visit(parent):
            for name in hierarchy.get(parent, []):
                bone = bones[name]
                angles = np.zeros(3)
                for dof, value in zip(bone.get("dof", []), frame.get(name, [])):
                    angles["xyz".index(dof[1])] = value
                matrices[name] = matrices[parent] @ bone["C"] @ rotation(angles) @ bone["C"].T
                positions[name] = positions[parent] + matrices[name] @ (bone["direction"] * bone["length"])
                visit(name)

        visit("root")
        # Fixed sagittal camera: +Z is forward, -Y is down. Remove horizontal
        # travel while retaining the actual vertical bounce and articulation.
        poses.append([
            [positions[name][2] - positions["root"][2], -positions[name][1]]
            for name in SOURCE_NAMES
        ])
    poses = np.array(poses)

    candidates = []
    for period in range(60, 101):
        for start in range(3, len(poses) - period - 3):
            end = start + period
            distance = np.mean((poses[start] - poses[end]) ** 2)
            velocity = np.mean((
                (poses[start + 1] - poses[start - 1]) - (poses[end + 1] - poses[end - 1])
            ) ** 2)
            candidates.append((distance + 4 * velocity, start, end))
    _, start, end = min(candidates)
    if (start, end) != (3, 91):
        raise ValueError(f"Unexpected stride boundary: {start + 1}, {end + 1}")
    times = np.linspace(start, end, 33)
    samples = np.array([
        poses[int(t)] * (1 - (t % 1)) + poses[min(int(t) + 1, len(poses) - 1)] * (t % 1)
        for t in times
    ])
    # Distribute the small observed seam mismatch, then omit duplicate endpoint.
    delta = samples[-1] - samples[0]
    t = np.linspace(0, 1, 33)
    samples -= ((t * t * (3 - 2 * t))[:, None, None]) * delta
    samples = samples[:-1]
    low, high = samples.min(axis=(0, 1)), samples.max(axis=(0, 1))
    scale = min(94 / (high[0] - low[0]), 132 / (high[1] - low[1]))
    samples[:, :, 0] = samples[:, :, 0] * scale + 60
    samples[:, :, 1] = (samples[:, :, 1] - high[1]) * scale + 148
    samples = np.round(samples, 2)
    if samples.shape != (32, 18, 2) or not np.isfinite(samples).all():
        raise ValueError("Invalid sampled motion")
    return {
        "source": "CMU Graphics Lab 09_01 run",
        "sourceUrl": "https://mocap.cs.cmu.edu/search.php?subjectnumber=09",
        "sourceFps": 120,
        "sourceFrames": [start + 1, end + 1],
        "durationMs": round((end - start) / 120 * 1000, 3),
        "viewBox": [0, 0, 120, 160],
        "joints": NAMES,
        "edges": EDGES,
        "frames": samples.tolist(),
    }


def load_sources(source_dir, download):
    for filename, (url, expected_hash) in SOURCES.items():
        path = source_dir / filename
        if download:
            print(f"Downloading {url}")
            with urlopen(url, timeout=30) as response:
                data = response.read()
            path.write_bytes(data)
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(f"Source checksum mismatch: {filename}; expected {expected_hash}, got {actual_hash}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Use existing 09.asf and 09_01.amc files without network access")
    parser.add_argument("--output", type=Path, default=ROOT / "src/assets/runner-motion.ts")
    parser.add_argument("--check", action="store_true", help="Compare the derived payload with output; do not write anything")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="racepulse-cmu-motion-") as temporary:
        source_dir = args.source_dir if args.source_dir else Path(temporary)
        load_sources(source_dir, download=args.source_dir is None)
        payload = derive(source_dir)
    raw = json.dumps(payload, separators=(",", ":"))
    if args.check:
        current = args.output.read_text(encoding="utf-8")
        marker = "export const runnerMotion = "
        current_payload = json.loads(current.split(marker, 1)[1].rsplit(" as const;", 1)[0])
        if current_payload != payload:
            raise SystemExit("Recorded motion differs from the committed payload")
        print(f"Verified {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            "// Derived from recorded CMU Graphics Lab motion 09_01. See RUNNER-MOTION.md.\n"
            f"export const runnerMotion = {raw} as const;\n",
            encoding="utf-8", newline="\n",
        )
        print(f"Wrote {args.output}")
    print(f"32 frames / 18 joints / {payload['durationMs']} ms; JSON {len(raw.encode())} bytes, gzip {len(gzip.compress(raw.encode(), mtime=0))} bytes")


if __name__ == "__main__":
    main()
