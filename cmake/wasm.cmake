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
add_executable(insimul_wasm
  src/insimul.c
  src/insimul_wasm_stubs.c   # posix_spawnp — see the file header
  ${INSIMUL_BOOT_C})
target_link_libraries(insimul_wasm PRIVATE trealla_objs)
target_include_directories(insimul_wasm PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${TREALLA_DIR}/src)
target_compile_definitions(insimul_wasm PRIVATE ${INSIMUL_VERSION_DEFS})

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
