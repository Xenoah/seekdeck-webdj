"""Package the runnable application and its source without hosting credentials."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / "package.json").read_text())["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
    raise ValueError("Invalid release version")
prefix = f"seekdeck-webdj-v{version}"
output = ROOT / "release-artifacts"
output.mkdir(exist_ok=True)
archive = output / f"{prefix}.zip"
paths = []
for name in ("README.md", "package.json", "index.html", ".nojekyll", "dist", "tests", "tools", "releases"):
    source = ROOT / name
    paths.extend([source] if source.is_file() else source.rglob("*"))
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for source in sorted(paths):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        info = zipfile.ZipInfo(f"{prefix}/{source.relative_to(ROOT).as_posix()}")
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        bundle.writestr(info, source.read_bytes())
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise RuntimeError("Release archive failed validation")
    for name in ("dist/index.html", "dist/audio/processor.js", "dist/demos/demo-0.wav",
                 "dist/demos/demo-1.wav", "dist/demos/demo-2.wav", "dist/demos/demo-3.wav"):
        bundle.getinfo(f"{prefix}/{name}")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n")
print(f"Packaged {archive.name}: {archive.stat().st_size} bytes")
print(f"SHA-256: {digest}")
