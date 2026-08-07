#!/usr/bin/env python3
"""
import_new_pages.py — automates the mechanical half of adding new coloring
pages (copy file, write the data/coloring-pages.json entry, rebuild masks).

The one thing it deliberately does NOT automate is picking id/title for each
picture — that still requires actually looking at the artwork, so this tool
expects a small mapping you (or an assistant that can see the images) supply.

Usage
-----
1) See which images in a source folder haven't been imported yet:

     python tools/import_new_pages.py list ../Dino

   Compares by file content hash (not filename), so it's safe even if the
   source folder's UUID-named files get reshuffled or renamed.

2) Import a batch, after deciding id/title for each new file:

     python tools/import_new_pages.py import ../Dino dinosaurs mapping.json

   mapping.json:
     {
       "bae15ab2-....png": { "id": "mosasaurus", "title": "Mosasaurus" },
       "some-other.png":   { "id": "megalodon",  "title": "Megalodon" }
     }

   This copies each file into assets/coloring-pages/<category>/<id>.png,
   appends a data/coloring-pages.json entry (order = current max + 1),
   records the file's hash so future `list` runs won't show it again, and
   finally runs tools/build_masks.py to generate masks for everything.

State
-----
tools/import_manifest.json tracks {sha256: {id, category, source}} for every
picture ever imported through this tool, so re-running `list` against a
folder that mixes old + new files only reports the genuinely new ones.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "data" / "coloring-pages.json"
MANIFEST_PATH = Path(__file__).resolve().parent / "import_manifest.json"
PAGES_DIR = ROOT / "assets" / "coloring-pages"
BUILD_MASKS = Path(__file__).resolve().parent / "build_masks.py"


def sha256_of(path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def load_manifest():
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {}


def save_manifest(manifest):
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def cmd_list(source_dir):
    source_dir = Path(source_dir).resolve()
    manifest = load_manifest()
    known_hashes = set(manifest.keys())

    new_files = []
    for f in sorted(source_dir.glob("*.png")):
        if sha256_of(f) not in known_hashes:
            new_files.append(f)

    if not new_files:
        print("No new images - everything in this folder has already been imported.")
        return

    print(f"{len(new_files)} new image(s) not yet imported:")
    for f in new_files:
        print(f"  {f.name}")
    print("\nView these, decide id/title/category, then run the `import` command"
          " with a mapping.json covering them.")


def cmd_import(source_dir, category, mapping_path):
    source_dir = Path(source_dir).resolve()
    mapping = json.loads(Path(mapping_path).read_text(encoding="utf-8"))
    manifest = load_manifest()
    pages = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    existing_ids = {p["id"] for p in pages}
    next_order = max((p["order"] for p in pages), default=0) + 1

    out_dir = PAGES_DIR / category
    out_dir.mkdir(parents=True, exist_ok=True)

    added = []
    for filename, info in mapping.items():
        src = source_dir / filename
        if not src.exists():
            print(f"SKIP {filename}: file not found in {source_dir}")
            continue

        file_hash = sha256_of(src)
        if file_hash in manifest:
            print(f"SKIP {filename}: already imported as '{manifest[file_hash]['id']}'")
            continue

        page_id = info["id"]
        title = info["title"]
        if page_id in existing_ids:
            print(f"SKIP {filename}: id '{page_id}' already exists in data/coloring-pages.json")
            continue

        dest = out_dir / f"{page_id}.png"
        shutil.copyfile(src, dest)

        rel_image = str(dest.relative_to(ROOT)).replace("\\", "/")
        pages.append({
            "id": page_id,
            "title": title,
            "category": category,
            "difficulty": info.get("difficulty", "easy"),
            "thumbnail": rel_image,
            "image": rel_image,
            "order": next_order,
            "mask": f"assets/coloring-masks/{category}/{page_id}-mask.png",
            "regionMap": f"assets/coloring-masks/{category}/{page_id}-regions.png"
        })
        manifest[file_hash] = {"id": page_id, "category": category, "source": filename}
        existing_ids.add(page_id)
        added.append(page_id)
        next_order += 1

    if not added:
        print("Nothing imported.")
        return

    DATA_JSON.write_text(json.dumps(pages, indent=2), encoding="utf-8")
    save_manifest(manifest)
    print(f"Imported {len(added)} page(s): {', '.join(added)}")

    print("\nRebuilding masks...")
    import subprocess
    subprocess.run([sys.executable, str(BUILD_MASKS)], cwd=ROOT, check=True)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    action = sys.argv[1]
    if action == "list" and len(sys.argv) == 3:
        cmd_list(sys.argv[2])
    elif action == "import" and len(sys.argv) == 5:
        cmd_import(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
