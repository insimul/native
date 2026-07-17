# Consuming libinsimul from the engine plugins

`scripts/package.sh` produces `dist/<platform>/` with three files — the shared
library, the public header, and a `VERSION` stamp:

```
dist/macos-arm64/
  libinsimul.dylib      # or libinsimul.so (Linux), insimul.dll (Windows)
  insimul.h             # the stable C ABI (extern "C")
  VERSION               # semver + platform + git sha + Trealla pin
```

`<platform>` is one of `macos-arm64`, `macos-x64`, `linux-x64`, `windows-x64`
(iOS/Android come later — see the platform matrix in the README).

The ABI is the entire contract: `insimul.h` leaks no engine types, everything is
`extern "C"`, one KB is owned by one thread, and returned strings are owned by the
object they came from (see the header for the ownership rules). A wrapper calls
`insimul_version()` at load time and can cross-check it against the shipped
`VERSION` file — both carry the same semver / git sha / Trealla pin.

> This document specifies the **file layout** each engine expects. The actual
> managed/native wrappers (marshalling, lifetime, JSON parsing of the binding
> sets) are the per-engine PRDs' work, not this one.

---

## Unity — P/Invoke

Unity loads native code from a `Plugins/` folder, one native lib per platform
target. A C# `[DllImport("insimul")]` static class wraps the ABI.

```
Assets/Insimul/
  Plugins/
    macOS/libinsimul.dylib        # set Editor + Standalone; CPU per import
    Linux/libinsimul.so
    Windows/insimul.dll
  Runtime/
    InsimulNative.cs              # [DllImport("insimul")] extern declarations
    PrologEngine.cs               # replaces the fake substring store
  VERSION                          # copied from dist/<platform>/VERSION
```

- `[DllImport("insimul", CallingConvention = CallingConvention.Cdecl)]` — the lib
  base name is `insimul` (Unity strips the `lib` prefix / extension per platform).
- Marshal returned `const char*` as `IntPtr` + `Marshal.PtrToStringUTF8` (do **not**
  let the marshaler free it — the ABI owns the pointer).
- In the plugin importer, set each `.dylib`/`.so`/`.dll` to its OS + CPU so the
  right binary is selected per build target.
- Parse the binding-set JSON (README "Binding-set JSON format") with any C# JSON
  reader; the shape is stable across all three engines.

## Unreal — ThirdParty module

Unreal consumes prebuilt native libs through a `ThirdParty` module whose
`*.Build.cs` publishes the include path and the platform library, and stages the
runtime dylib/dll.

```
Source/ThirdParty/InsimulLibrary/
  InsimulLibrary.Build.cs         # PublicIncludePaths + per-platform lib/runtime
  include/insimul.h
  lib/
    Mac/libinsimul.dylib
    Linux/libinsimul.so
    Win64/insimul.dll  insimul.lib   # import lib if built with MSVC
  VERSION
```

- `Build.cs`: `PublicIncludePaths.Add(".../include")`; per `Target.Platform` add
  the library to `PublicAdditionalLibraries` and stage the shared lib with
  `RuntimeDependencies.Add(...)` (Mac/Linux) / `PublicDelayLoadDLLs` +
  `RuntimeDependencies` (Win64).
- A separate runtime module `#include "insimul.h"` and calls the ABI, replacing
  the fake `PrologEngine.cpp`.
- `extern "C"` in the header means no name-mangling work on the Unreal side.

## Godot — GDExtension

Godot 4 loads native code as a GDExtension: a shared lib plus a `.gdextension`
descriptor listing the per-platform binaries. The extension code links `insimul.h`
and registers a class the GDScript side uses in place of `prolog_engine.gd`.

```
addons/insimul/
  insimul.gdextension             # [libraries] entry per platform
  bin/
    macos/libinsimul.dylib
    linux/libinsimul.so
    windows/insimul.dll
  include/insimul.h               # for the extension's own C/C++ glue
  VERSION
```

- `insimul.gdextension` `[libraries]` maps `macos.arm64`, `linux.x86_64`,
  `windows.x86_64`, … to the matching file under `bin/`.
- The GDExtension glue (`godot-cpp` or a thin C shim) `#include`s `insimul.h` and
  exposes `consult`/`query`/`assert`/`snapshot` to GDScript; the binding-set JSON
  is parsed with Godot's `JSON` class.

---

## Version / provenance

Every package carries `VERSION`, e.g.:

```
insimul 0.1.0
platform macos-arm64
git 3c347ec
trealla_tag v2.106.1
trealla_commit 07de013677af760a8bca0594ae4b2bef158a3cde
```

The first line matches the semver embedded in `insimul_version()` (the C ABI),
and the Trealla fields match the pin in `CMakeLists.txt` / `THIRD_PARTY.md`. A
wrapper that logs `insimul_version()` on startup gives support a single string
identifying the exact engine build a save file was produced against.
