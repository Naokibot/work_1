from pathlib import Path
import sys
import tempfile

from anki.collection import Collection


def build_fixture(target: Path) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        collection_path = Path(temp_dir) / "official.anki2"
        col = Collection(str(collection_path))
        try:
            notetype = col.models.by_name("Basic") or col.models.current()
            if notetype is None:
                raise RuntimeError("Anki Basic notetype is unavailable")
            deck_id = col.decks.id("Interop::Official 26.5")
            note = col.new_note(notetype)
            note["Front"] = "Official Anki 26.5 fixture"
            note["Back"] = "Imported by work_1"
            note.tags = ["official-anki", "interop"]
            col.add_note(note, deck_id)
            col.export_collection_package(
                str(target),
                include_media=True,
                legacy=False,
            )
        finally:
            # export_collection_package() closes the collection for full sync.
            try:
                col.close()
            except Exception:
                pass


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate-official-anki-fixture.py OUTPUT.colpkg")
    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    build_fixture(output)
    if not output.exists() or output.stat().st_size < 1000:
        raise RuntimeError("official Anki fixture was not generated")
    print(output)
