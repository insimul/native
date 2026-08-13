# wasm.cmake — the Emscripten/WebAssembly link target for libinsimul.
#
# Included from CMakeLists.txt only when CMAKE_SYSTEM_NAME is Emscripten (i.e.
# the build was configured through `emcmake cmake`, which scripts/build_wasm.sh
# does for you). It links the SAME src/insimul.c + Trealla objects the native
# static library uses — this is a build target, not a port — and emits an ES
# module plus a .wasm binary.
#
# Everything the browser side needs to know about ownership across the JS
# boundary lives in wasm/insimul.mjs and README.md ("WebAssembly target").

# --------------------------------------------------------------- export surface
#
# The twelve entry points of include/insimul.h, in header order. Emscripten's
# linker garbage-collects anything not named here, so this list IS the wasm ABI:
# adding a function to insimul.h means adding it here too.
#
# malloc/free ride along because a JS caller that wants to hand a long-lived
# heap string to the ABI (rather than a stack-allocated `ccall` argument) needs
# them; `stringToNewUTF8` allocates with malloc and the caller must free.
set(INSIMUL_WASM_EXPORTS
  _insimul_kb_create
  _insimul_kb_destroy
  _insimul_kb_consult
  _insimul_kb_assert
  _insimul_kb_retract
  _insimul_query_start
  _insimul_query_next
  _insimul_query_stop
  _insimul_kb_snapshot
  _insimul_kb_restore
  _insimul_last_error
  _insimul_last_error_class
  _insimul_version
  _malloc
  _free)
list(JOIN INSIMUL_WASM_EXPORTS "," INSIMUL_WASM_EXPORTS_CSV)

# Runtime helpers the wrapper in wasm/insimul.mjs calls. `ccall`/`cwrap` marshal
# arguments; `UTF8ToString` reads a `const char *` the ABI still owns (we copy it
# into a JS string immediately, which is exactly the "callers copy anything they
# need to keep" rule from insimul.h).
set(INSIMUL_WASM_RUNTIME_METHODS "ccall,cwrap,UTF8ToString,stringToNewUTF8,lengthBytesUTF8")

# ------------------------------------------------------------------- the target
# INSIMUL_ENGINE_SRC is the selected engine's port (src/engine_<name>.c) — the
# same one the native libraries compile, and the only file that differs between
# the two engine selections. BOTH engines build for wasm (tasklist 250 US-2):
# the default vendored one, and the spike's second engine located through
# cmake/swipl.cmake. Nothing below names either of them; what an engine needs
# beyond its objects arrives as INSIMUL_ENGINE_WASM_* variables that its own
# cmake module set.
add_executable(insimul_wasm
  src/insimul.c
  ${INSIMUL_ENGINE_SRC}
  src/insimul_wasm_stubs.c   # posix_spawnp — see the file header
  ${INSIMUL_BOOT_C})
target_link_libraries(insimul_wasm PRIVATE ${INSIMUL_ENGINE_LINK})
target_include_directories(insimul_wasm PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${INSIMUL_ENGINE_INCLUDE})
target_compile_definitions(insimul_wasm PRIVATE ${INSIMUL_VERSION_DEFS})
# What the engine's port needs to know about the engine (the native library
# targets in CMakeLists.txt apply the same list). The default engine sets none,
# which is why this was missing until a second one needed it.
if(INSIMUL_ENGINE_DEFS)
  target_compile_definitions(insimul_wasm PRIVATE ${INSIMUL_ENGINE_DEFS})
endif()

# `insimul.mjs` (the glue) + `insimul.wasm` (the binary), side by side.
set_target_properties(insimul_wasm PROPERTIES
  OUTPUT_NAME insimul
  SUFFIX ".mjs")

target_link_options(insimul_wasm PRIVATE
  # A factory-function ES module: `import createInsimul from './insimul.mjs'`.
  # Bundler-friendly, and several independent instances can coexist on a page.
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createInsimul"
  "-sENVIRONMENT=web,worker,node"
  # The ABI is a library: main() returns but the runtime must stay alive.
  "-sEXIT_RUNTIME=0"
  "-sINVOKE_RUN=0"
  # src/insimul.c's C<->Prolog channel is a temp file under /tmp (make_temp),
  # so MEMFS must be present even though we never touch a real disk.
  "-sFORCE_FILESYSTEM=1"
  # Trealla's term/goal machinery recurses deeply; the 64KB Emscripten default
  # stack overflows on ordinary conformance goals. 8MB matches the stack size
  # upstream Trealla's own WASI target links with.
  "-sSTACK_SIZE=8388608"
  "-sINITIAL_MEMORY=67108864"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sEXPORTED_FUNCTIONS=${INSIMUL_WASM_EXPORTS_CSV}"
  "-sEXPORTED_RUNTIME_METHODS=${INSIMUL_WASM_RUNTIME_METHODS}"
)

# Engine-supplied link options (e.g. an Emscripten port the engine's core needs).
if(INSIMUL_ENGINE_WASM_LINK_OPTIONS)
  target_link_options(insimul_wasm PRIVATE ${INSIMUL_ENGINE_WASM_LINK_OPTIONS})
endif()

# An engine whose Prolog library is NOT compiled into its objects has to ship it
# as file-system bytes: --preload-file bakes the tree into a sibling .data file
# that the glue fetches and mounts at ${_mount} before main() runs. The default
# engine embeds its library in the binary and sets nothing here; the second one
# (US-2) mounts boot.prc + library/ — the browser form of the "not
# self-contained" gap, and a payload US-3 counts in the transferred bytes.
if(INSIMUL_ENGINE_WASM_PRELOAD_DIR)
  set(_mount "${INSIMUL_ENGINE_WASM_PRELOAD_MOUNT}")
  if(NOT _mount)
    set(_mount "/engine")
  endif()
  message(STATUS "wasm: preloading engine home ${INSIMUL_ENGINE_WASM_PRELOAD_DIR} at ${_mount}")
  target_link_options(insimul_wasm PRIVATE
    "SHELL:--preload-file ${INSIMUL_ENGINE_WASM_PRELOAD_DIR}@${_mount}")
  # The .data image is a build INPUT, not a by-product: re-link when it changes.
  set_property(TARGET insimul_wasm APPEND PROPERTY
               LINK_DEPENDS ${INSIMUL_ENGINE_WASM_PRELOAD_DIR})
endif()

# ---------------------------------------------------------------------- tests
#
# The wasm smoke test mirrors tests/smoke.c (consult a KB, run one query that
# only unification + backtracking through a rule can answer, plus one that must
# fail) and additionally calls all twelve ABI entry points across the JS
# boundary. It runs under the node that ships with the active emsdk.
find_program(INSIMUL_NODE NAMES node nodejs REQUIRED
             DOC "node used to run the wasm tests")

add_test(NAME wasm_smoke
  COMMAND ${INSIMUL_NODE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/wasm_smoke.mjs
          $<TARGET_FILE:insimul_wasm>)

# The wasm conformance leg (US-2): the SAME golden corpus the native `conformance`
# ctest and the Rust gate drive, run through wasm/insimul-api.mjs — every file,
# every case, no subset. It hard-fails on a missing/empty corpus or on executing
# fewer cases than the corpus declares, so it cannot pass vacuously; the configure
# -time check below refuses even to generate a build whose gate has no corpus.
#
# INSIMUL_CONFORMANCE_DEFAULT_DIR comes from CMakeLists.txt, so both legs resolve
# the corpus identically; INSIMUL_CONFORMANCE_DIR still overrides at run time.
file(GLOB INSIMUL_CORPUS_FILES "${INSIMUL_CONFORMANCE_DEFAULT_DIR}/*.json")
list(LENGTH INSIMUL_CORPUS_FILES INSIMUL_CORPUS_FILE_COUNT)
if(INSIMUL_CORPUS_FILE_COUNT EQUAL 0)
  message(FATAL_ERROR
    "wasm: no conformance corpus at ${INSIMUL_CONFORMANCE_DEFAULT_DIR}.\n"
    "  The wasm build gates on the golden corpus; refusing to configure a build "
    "whose parity test would have nothing to run.")
endif()
message(STATUS "wasm: conformance corpus ${INSIMUL_CONFORMANCE_DEFAULT_DIR} "
               "(${INSIMUL_CORPUS_FILE_COUNT} files)")

add_test(NAME wasm_conformance
  COMMAND ${INSIMUL_NODE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/wasm_conformance.mjs
          $<TARGET_FILE:insimul_wasm>
          --corpus ${INSIMUL_CONFORMANCE_DEFAULT_DIR})
