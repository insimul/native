# `tests/radiant/` — the promoted radiant gate

Every `.cpp`/`.h` in this directory is a **byte-for-byte copy** of a file in
`insimul-godot`. Do not reformat, re-namespace, or "fix" anything in them —
including the `INSIMUL_GODOT_*` include guards and the comments that still say
"the Godot twin of …". The copies are only useful while they are still copies:
identity is what lets `conformance/RADIANT_PARITY.md` claim the promotion changed
no behaviour with a `diff` instead of an argument.

| here                       | insimul-godot                                  |
| -------------------------- | ---------------------------------------------- |
| `radiant_bridge.cpp`       | `gdextension/test/test_radiant_bridge.cpp`     |
| `json_value.{h,cpp}`       | `gdextension/src/json_value.{h,cpp}`           |
| `canonical_json.{h,cpp}`   | `gdextension/src/canonical_json.{h,cpp}`       |
| `sha256.{h,cpp}`           | `gdextension/src/sha256.{h,cpp}`               |

```sh
diff tests/radiant/radiant_bridge.cpp ../insimul-godot/gdextension/test/test_radiant_bridge.cpp
for f in json_value canonical_json sha256; do
  for e in h cpp; do diff tests/radiant/$f.$e ../insimul-godot/gdextension/src/$f.$e; done
done
```

These are test-support utilities, **not** a contract — unlike
`corebridge/include/insimulcore.h`, which three engines bind and which must never
fork. Nothing links against them. The only rule is that the copy stays a copy: if
either side changes, re-diff and re-run both legs, then update
`conformance/RADIANT_PARITY.md`.

The corpus these drive lives in `conformance/radiant/` (see
`conformance/VENDORED.md`); the wiring lives at the bottom of the root
`CMakeLists.txt` and in `tests/run_radiant.sh`.
