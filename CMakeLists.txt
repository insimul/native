# insimul-native — the shared native Prolog core (libinsimul).
#
# Builds a static + shared library `insimul` from src/, embedding a REAL
# ISO-conforming Prolog engine: Trealla Prolog (pure C, MIT — see
# docs/TREALLA_LICENSE_FINDING.md), whose source is COMMITTED under
# vendor/trealla/ at a pinned commit (see THIRD_PARTY.md). The build performs
# NO network fetch. US-LI1 delivers the skeleton + a ctest smoke test that
# consults a KB and runs one query through Trealla's C API; the stable insimul
# C ABI lands in US-LI2 (include/insimul.h).
cmake_minimum_required(VERSION 3.24)

# Single source of truth for the library's semver: the tracked VERSION file.
# scripts/package.sh reads the same file, and insimul_version() embeds it (below)
# so the C ABI, the packaged VERSION stamp, and CMake never drift.
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/VERSION INSIMUL_SEMVER LIMIT_COUNT 1)
string(STRIP "${INSIMUL_SEMVER}" INSIMUL_SEMVER)

project(insimul VERSION ${INSIMUL_SEMVER} LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# Short git sha of the source tree, resolved at configure time. "unknown" when
# git is absent or this is not a checkout (a tarball build) — insimul_version()
# still returns a well-formed stamp in that case.
set(INSIMUL_GIT_SHA "unknown")
find_package(Git QUIET)
if(GIT_FOUND)
  execute_process(
    COMMAND ${GIT_EXECUTABLE} -C ${CMAKE_CURRENT_SOURCE_DIR} rev-parse --short HEAD
    OUTPUT_VARIABLE _git_sha
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
    RESULT_VARIABLE _git_rc)
  if(_git_rc EQUAL 0 AND _git_sha)
    set(INSIMUL_GIT_SHA "${_git_sha}")
  endif()
endif()

# ---------------------------------------------------------------------------
# Threading profile. Native builds are threaded (one KB per thread is part of
# the ABI's contract). The Emscripten/wasm build is deliberately SINGLE-threaded:
# -pthread in wasm means SharedArrayBuffer, which means every embedding page has
# to serve COOP/COEP headers. That is a cost we will not push onto browser
# consumers, and it matches upstream Trealla's own wasm profile (its Makefile
# sets NOTHREADS=1 for the WASI target). Trealla's USE_THREADS defaults to 0
# (src/internal.h), and Emscripten's libc supplies the pthread stubs the few
# unconditional call sites need.
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
  set(INSIMUL_THREAD_LIBS "")
  set(INSIMUL_TREALLA_THREAD_DEFS "")
else()
  find_package(Threads REQUIRED)
  set(INSIMUL_THREAD_LIBS Threads::Threads)
  set(INSIMUL_TREALLA_THREAD_DEFS USE_THREADS=1)
endif()

# ---------------------------------------------------------------------------
# WHICH ENGINE (tasklist 250 — the D20 spike).
#
# Two engines build from ONE source tree, behind ONE ABI, chosen at configure
# time. That is the whole point: `trealla` vs `swipl` compares two ENGINES at a
# fixed 12-function interface, not two vendors' APIs against each other. Only
# src/engine_<name>.c changes; src/insimul.c, src/insimul_boot.pl, the tests and
# the packaging are shared, so a difference in the numbers is a difference in the
# engine.
#
# trealla — vendored, the default, what ships today.
# swipl   — LOCATED, not vendored: pass -DINSIMUL_SWIPL_ROOT=<prefix> from
#           scripts/build_swipl.sh. See cmake/swipl.cmake and docs/SWIPL_SPIKE.md.
# ---------------------------------------------------------------------------
set(INSIMUL_ENGINE "trealla" CACHE STRING "Prolog engine to embed: trealla | swipl")
set_property(CACHE INSIMUL_ENGINE PROPERTY STRINGS trealla swipl)
if(NOT INSIMUL_ENGINE STREQUAL "trealla" AND NOT INSIMUL_ENGINE STREQUAL "swipl")
  message(FATAL_ERROR "INSIMUL_ENGINE must be 'trealla' or 'swipl', got '${INSIMUL_ENGINE}'")
endif()
message(STATUS "insimul: embedding engine '${INSIMUL_ENGINE}'")

# ---------------------------------------------------------------------------
# Vendored Trealla Prolog (MIT — docs/TREALLA_LICENSE_FINDING.md records how
# that was resolved from the license TEXT, not from a classifier).
#
# The source is COMMITTED under vendor/trealla/, not fetched: libinsimul is
# layer zero for four engine runtimes, the Rust server and every save file, and
# a build of it must not depend on an upstream single-maintainer repository
# staying reachable or unchanged. There is no FetchContent here on purpose —
# `trealla_vendor` (tests/run_trealla_vendor.sh) fails if one comes back.
#
# THE PIN LIVES WITH THE DROP: vendor/trealla/VENDORED.json is the one
# authoritative location, exactly as QuickJS's VERSION and the core bundle's
# coreCommit are, and the build READS it from there — so the version stamp can
# never name a commit other than the bytes that were compiled.
# ---------------------------------------------------------------------------
set(TREALLA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/vendor/trealla)
if(NOT EXISTS ${TREALLA_DIR}/VENDORED.json)
  message(FATAL_ERROR
    "Vendored Trealla source is missing: ${TREALLA_DIR}/VENDORED.json not found.\n"
    "It is committed to this repository; a clean checkout has it.")
endif()
file(READ ${TREALLA_DIR}/VENDORED.json INSIMUL_TREALLA_VENDORED)
string(JSON TREALLA_GIT_COMMIT GET "${INSIMUL_TREALLA_VENDORED}" commit)
string(JSON TREALLA_GIT_TAG    GET "${INSIMUL_TREALLA_VENDORED}" tag)
message(STATUS "Trealla: vendored ${TREALLA_GIT_TAG} (${TREALLA_GIT_COMMIT}) from ${TREALLA_DIR}")

# ---------------------------------------------------------------------------
# Embed Trealla's Prolog standard library (library/*.pl) as C byte arrays.
# Trealla's Makefile compiles a host tool `bin2c` and, for each library/x.pl,
# writes "#include <stddef.h>" followed by bin2c's output into library/x.c.
# bin2c derives the C symbol name from its PATH ARGUMENT, so it MUST be run as
# `bin2c library/<name>.pl` from the Trealla root or the symbols won't match
# the externs in src/library.c. cmake/gen_embed.cmake handles that.
# ---------------------------------------------------------------------------
#
# Everything from here to the bootstrap embedding is Trealla's build; the swipl
# selection skips it entirely and links a library it did not build.
if(INSIMUL_ENGINE STREQUAL "trealla")

# bin2c is a BUILD-time tool — it has to run on the machine doing the build. In
# a cross build (wasm) an `add_executable` would be compiled by emcc and could
# not be exec'd, so compile it at configure time with the HOST compiler instead.
# `cc` is found on the host because Emscripten.cmake sets
# CMAKE_FIND_ROOT_PATH_MODE_PROGRAM to BOTH.
if(CMAKE_CROSSCOMPILING)
  find_program(INSIMUL_HOST_CC NAMES cc clang gcc REQUIRED
               DOC "Host C compiler used to build the bin2c build-tool")
  set(INSIMUL_BIN2C ${CMAKE_CURRENT_BINARY_DIR}/host-bin2c)
  execute_process(
    COMMAND ${INSIMUL_HOST_CC} -O2 -o ${INSIMUL_BIN2C} ${TREALLA_DIR}/util/bin2c.c
    RESULT_VARIABLE _bin2c_rc
    ERROR_VARIABLE  _bin2c_err)
  if(NOT _bin2c_rc EQUAL 0)
    message(FATAL_ERROR "failed to build host bin2c with ${INSIMUL_HOST_CC}:\n${_bin2c_err}")
  endif()
  set(INSIMUL_BIN2C_DEP "")
else()
  add_executable(insimul_bin2c ${TREALLA_DIR}/util/bin2c.c)
  set(INSIMUL_BIN2C $<TARGET_FILE:insimul_bin2c>)
  set(INSIMUL_BIN2C_DEP insimul_bin2c)
endif()

file(GLOB TREALLA_LIB_PL CONFIGURE_DEPENDS ${TREALLA_DIR}/library/*.pl)
set(TREALLA_EMBED_DIR ${CMAKE_CURRENT_BINARY_DIR}/trealla_embed)
file(MAKE_DIRECTORY ${TREALLA_EMBED_DIR})

set(TREALLA_EMBED_SRC "")
foreach(pl ${TREALLA_LIB_PL})
  get_filename_component(name ${pl} NAME_WE)
  set(out ${TREALLA_EMBED_DIR}/${name}.c)
  add_custom_command(
    OUTPUT ${out}
    COMMAND ${CMAKE_COMMAND}
      -DBIN2C=${INSIMUL_BIN2C}
      -DTREALLA_DIR=${TREALLA_DIR}
      -DPL_NAME=${name}
      -DOUT=${out}
      -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_embed.cmake
    DEPENDS ${INSIMUL_BIN2C_DEP} ${pl}
    COMMENT "Embedding Trealla library: ${name}.pl"
    VERBATIM
  )
  list(APPEND TREALLA_EMBED_SRC ${out})
endforeach()

# ---------------------------------------------------------------------------
# Trealla sources compiled into an OBJECT library. Feature flags mirror a
# minimal, dependency-light build validated on this machine:
#   EMBED=1        embed the stdlib (no on-disk library path needed)
#   USE_ISOCLINE=1 use Trealla's bundled line editor (no system libedit dep)
#   USE_THREADS=1  required — src/bif_os.c uses pthread unconditionally
#   (NO USE_FFI / USE_OPENSSL — those need libffi / openssl headers)
# isocline builds as a single translation unit (isocline.c #includes the rest).
# ---------------------------------------------------------------------------
file(GLOB TREALLA_CORE_SRC CONFIGURE_DEPENDS ${TREALLA_DIR}/src/*.c)
set(TREALLA_SRC
  ${TREALLA_CORE_SRC}
  ${TREALLA_DIR}/src/imath/imath.c
  ${TREALLA_DIR}/src/imath/imrat.c
  ${TREALLA_DIR}/src/sre/re.c
  ${TREALLA_DIR}/src/isocline/src/isocline.c
  ${TREALLA_EMBED_SRC}
)

add_library(trealla_objs OBJECT ${TREALLA_SRC})
set_target_properties(trealla_objs PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(trealla_objs PUBLIC ${TREALLA_DIR}/src)
target_compile_definitions(trealla_objs PRIVATE
  EMBED=1
  USE_ISOCLINE=1
  ${INSIMUL_TREALLA_THREAD_DEFS}
  _GNU_SOURCE
  VERSION="${TREALLA_GIT_TAG}"
  DEFAULT_LIBRARY_PATH="${CMAKE_INSTALL_PREFIX}/share/trealla/library"
)
# Vendored code: silence its warnings so the insimul build log stays readable.
target_compile_options(trealla_objs PRIVATE -w)
target_link_libraries(trealla_objs PUBLIC m ${INSIMUL_THREAD_LIBS})

set(INSIMUL_ENGINE_SRC     ${CMAKE_CURRENT_SOURCE_DIR}/src/engine_trealla.c)
set(INSIMUL_ENGINE_INCLUDE ${TREALLA_DIR}/src)
set(INSIMUL_ENGINE_LINK    trealla_objs)
set(INSIMUL_ENGINE_DEFS    "")
set(INSIMUL_ENGINE_VERSION_VALUE "${TREALLA_GIT_TAG}")
set(INSIMUL_ENGINE_COMMIT_VALUE  "${TREALLA_GIT_COMMIT}")

else()
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/swipl.cmake)
endif()

# ---------------------------------------------------------------------------
# Embed the bootstrap Prolog (src/insimul_boot.pl) as a C byte array so the ABI
# has no on-disk runtime dependency. cmake/gen_boot.cmake writes a .c defining
# insimul_boot_pl[] + insimul_boot_pl_len, which src/insimul.c fmemopen()s into
# every KB at creation.
# ---------------------------------------------------------------------------
set(INSIMUL_BOOT_PL ${CMAKE_CURRENT_SOURCE_DIR}/src/insimul_boot.pl)
set(INSIMUL_BOOT_C  ${CMAKE_CURRENT_BINARY_DIR}/insimul_boot.c)
add_custom_command(
  OUTPUT ${INSIMUL_BOOT_C}
  COMMAND ${CMAKE_COMMAND}
    -DIN=${INSIMUL_BOOT_PL}
    -DOUT=${INSIMUL_BOOT_C}
    -DVAR=insimul_boot_pl
    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_boot.cmake
  DEPENDS ${INSIMUL_BOOT_PL} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_boot.cmake
  COMMENT "Embedding bootstrap Prolog: insimul_boot.pl"
  VERBATIM
)

# ---------------------------------------------------------------------------
# The insimul libraries. Both embed the Trealla objects (linking an OBJECT
# library adds its objects to the archive/shared lib). Linking trealla_objs
# PRIVATE keeps Trealla's internal include dir OUT of insimul's public interface
# — consumers see only include/insimul.h. Consumers still need libm + pthread,
# so those are re-exported as INTERFACE requirements.
# ---------------------------------------------------------------------------
add_library(insimul STATIC src/insimul.c ${INSIMUL_ENGINE_SRC} ${INSIMUL_BOOT_C})
target_link_libraries(insimul PRIVATE ${INSIMUL_ENGINE_LINK})
target_link_libraries(insimul INTERFACE m ${INSIMUL_THREAD_LIBS})
target_include_directories(insimul PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
# Only src/engine_<name>.c needs the engine's own C API header; it stays PRIVATE
# so it never leaks into insimul's public include interface.
target_include_directories(insimul PRIVATE ${INSIMUL_ENGINE_INCLUDE})
if(INSIMUL_ENGINE_DEFS)
  target_compile_definitions(insimul PRIVATE ${INSIMUL_ENGINE_DEFS})
endif()

# A SHARED library is a native-host concept — under Emscripten it would emit a
# dynamic-linking SIDE_MODULE, which is not what a browser consumer wants (that
# is the wasm module below). Skip it in the cross build.
if(NOT EMSCRIPTEN)
  add_library(insimul_shared SHARED src/insimul.c ${INSIMUL_ENGINE_SRC} ${INSIMUL_BOOT_C})
  target_link_libraries(insimul_shared PRIVATE ${INSIMUL_ENGINE_LINK})
  set_target_properties(insimul_shared PROPERTIES OUTPUT_NAME insimul)
  target_include_directories(insimul_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
  target_include_directories(insimul_shared PRIVATE ${INSIMUL_ENGINE_INCLUDE})
  if(INSIMUL_ENGINE_DEFS)
    target_compile_definitions(insimul_shared PRIVATE ${INSIMUL_ENGINE_DEFS})
  endif()
endif()

# Version stamp (US-LI5). src/insimul.c bakes these into insimul_version(): the
# library semver, the git sha, and the embedded engine's identity. Applied to
# both libraries so a static- or shared-linked host reports the same stamp.
#
# The engine is passed as name/version/commit — three VALUES (US-2, leak L-02).
# The vendor's name appears here, where the pin lives, and never in the ABI's
# schema: swapping the engine changes what these say and nothing a consumer
# parses. All three are DERIVED from the INSIMUL_ENGINE selection above, so the
# stamp cannot name an engine other than the one that was compiled — the same
# rule vendor/trealla/VENDORED.json and INSIMUL_SWIPL_PIN enforce for the commit.
# FORCE, because a build directory reconfigured onto the other engine must not
# keep the previous selection's name in its cache.
set(INSIMUL_ENGINE_NAME "${INSIMUL_ENGINE}" CACHE STRING "Embedded Prolog engine name" FORCE)
set(INSIMUL_VERSION_DEFS
  INSIMUL_VERSION="${INSIMUL_SEMVER}"
  INSIMUL_GIT_SHA="${INSIMUL_GIT_SHA}"
  INSIMUL_ENGINE_NAME="${INSIMUL_ENGINE_NAME}"
  INSIMUL_ENGINE_VERSION="${INSIMUL_ENGINE_VERSION_VALUE}"
  INSIMUL_ENGINE_COMMIT="${INSIMUL_ENGINE_COMMIT_VALUE}")
target_compile_definitions(insimul PRIVATE ${INSIMUL_VERSION_DEFS})
if(NOT EMSCRIPTEN)
  target_compile_definitions(insimul_shared PRIVATE ${INSIMUL_VERSION_DEFS})
endif()

# ---------------------------------------------------------------------------
# How a NON-CMAKE consumer links this build tree: build/insimul-link.txt.
#
# `libinsimul.a` is self-contained for one engine selection and not for the
# other: the vendored engine is compiled INTO the archive, while a located
# engine is a separate shared library the archive only references (gap G-02).
# rust/insimul-sys/build.rs links `libinsimul.a` directly and cannot see CMake's
# link interface, so the build WRITES that interface down and build.rs replays
# it. The file names the engine as a VALUE on one line and is otherwise a list
# of link directives — build.rs itself stays engine-neutral (leak L-02).
#
#   engine=<name>      which selection produced this tree
#   search=<dir>       add to the library search path
#   lib=<name>         link this library
#   rpath=<dir>        the shared engine's install name is @rpath-relative
#   runtime=<dir>      a tree the engine READS at run time and a host must
#                      therefore ship (gap G-02). An engine that compiles its
#                      Prolog library in emits no such line — which is itself
#                      the finding scripts/measure.sh reports as size.
# ---------------------------------------------------------------------------
set(INSIMUL_LINK_MANIFEST "engine=${INSIMUL_ENGINE}\n")
foreach(_link_item IN LISTS INSIMUL_ENGINE_LINK)
  # A CMake target (the vendored engine's object library) needs nothing here:
  # its objects are already inside libinsimul.a. A PATH is a real file a
  # consumer has to find at link and load time.
  if(EXISTS "${_link_item}" AND NOT IS_DIRECTORY "${_link_item}")
    get_filename_component(_link_dir  "${_link_item}" DIRECTORY)
    get_filename_component(_link_name "${_link_item}" NAME_WE)
    string(REGEX REPLACE "^lib" "" _link_name "${_link_name}")
    string(APPEND INSIMUL_LINK_MANIFEST
           "search=${_link_dir}\nlib=${_link_name}\nrpath=${_link_dir}\n")
  endif()
endforeach()
if(INSIMUL_ENGINE_RUNTIME_DIR)
  string(APPEND INSIMUL_LINK_MANIFEST "runtime=${INSIMUL_ENGINE_RUNTIME_DIR}\n")
endif()
file(WRITE ${CMAKE_BINARY_DIR}/insimul-link.txt "${INSIMUL_LINK_MANIFEST}")

# ---------------------------------------------------------------------------
# libinsimulcore — the SECOND library in this repo (tasklist 104). `@insimul/
# core`'s TypeScript in an embedded QuickJS behind corebridge/include/
# insimulcore.h, so Godot, Unity and Unreal bind one bridge instead of three.
# Separate ABI, separate artifacts; it consumes libinsimul's public ABI exactly
# as an engine plugin does. Everything about it lives in corebridge/.
#
# Skipped under Emscripten (the wasm target is libinsimul only — a browser host
# runs core as the TypeScript it already is). Deliberately placed ABOVE the
# EMSCRIPTEN `return()` below anyway, so the guard is stated here rather than
# depending on statement order.
# ---------------------------------------------------------------------------
if(NOT EMSCRIPTEN)
  add_subdirectory(corebridge)
endif()

# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
enable_testing()

# Corpus location for every conformance leg (C, Rust, wasm). Resolved BEFORE the
# EMSCRIPTEN branch below because the wasm leg needs it too: the default is the
# vendored mirror in conformance/prolog (so a fresh standalone checkout has a
# corpus at all), else the sibling insimul-runtime submodule for a monorepo
# layout. INSIMUL_CONFORMANCE_DIR overrides it at run time (so CI can point
# anywhere); rust/insimul/tests/conformance.rs resolves it the same way.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/conformance/prolog")
  get_filename_component(INSIMUL_CONFORMANCE_DEFAULT_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/conformance/prolog" ABSOLUTE)
else()
  get_filename_component(INSIMUL_CONFORMANCE_DEFAULT_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../insimul-runtime/packages/core/conformance/prolog"
    ABSOLUTE)
endif()

# The wasm (Emscripten) build has its own link target and its own node-driven
# tests — see cmake/wasm.cmake and scripts/build_wasm.sh. Everything below this
# point builds host executables, which a cross build cannot run, so the wasm
# configuration stops here.
if(EMSCRIPTEN)
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/wasm.cmake)
  return()
endif()

# smoke drives the VENDORED ENGINE's own C API (not the insimul ABI), so it is
# the one test that is engine-specific by construction. Under INSIMUL_ENGINE=swipl
# it is not built; the engine-neutral gates below cover that selection, and
# docs/SWIPL_SPIKE.md records this as the one gate the second engine does not run.
if(INSIMUL_ENGINE STREQUAL "trealla")
  add_executable(insimul_smoke tests/smoke.c)
  target_link_libraries(insimul_smoke PRIVATE insimul)
  target_include_directories(insimul_smoke PRIVATE ${TREALLA_DIR}/src)
  add_test(NAME smoke COMMAND insimul_smoke)
endif()

# The ABI test is a pure consumer of include/insimul.h (no trealla.h): it both
# exercises US-LI2 and proves the opaque boundary compiles/links cleanly.
add_executable(insimul_abi tests/abi.c)
target_link_libraries(insimul_abi PRIVATE insimul)
add_test(NAME abi COMMAND insimul_abi)

# ABI neutrality (US-2), in two halves.
#
# abi_neutral_runtime — the behaviours US-2 moved off the engine's defaults and
# onto this ABI's promises: classified errors, pinned flags, RFC 8259 escaping,
# lossless big integers, a normalised cons functor, refused reserved names,
# specified directive failure, and the create/destroy cycle that used to spin.
# TIMEOUT is not decoration: a regression of the internal keepalive (leak L-01)
# does not crash, it burns CPU forever, so the gate has to be a clock.
# The "ENGINE rows" — the behaviours insimul.h lists as NOT PROMISED — are
# declared HERE, beside the engine selection that decides them, and read by the
# test as plain properties. The vendor's name stays in this file (where the pin
# already lives) and out of the test (leak L-02). Getting one wrong is a red
# test, which is the whole point of those rows.
if(INSIMUL_ENGINE STREQUAL "trealla")
  set(INSIMUL_ENGINE_ROWS
    INSIMUL_ENGINE_TYPE_FIRST_ORDER=1        # sorts every float before every integer
    INSIMUL_ENGINE_ARITH_NAMES_ARE_STATIC=1) # log/1 etc. are builtin predicates too
else()
  set(INSIMUL_ENGINE_ROWS
    INSIMUL_ENGINE_TYPE_FIRST_ORDER=0        # ISO 7.2.1 by-value numeric ordering
    INSIMUL_ENGINE_ARITH_NAMES_ARE_STATIC=0) # log/1 may be an ordinary predicate
endif()
add_executable(insimul_neutrality tests/neutrality.c)
target_link_libraries(insimul_neutrality PRIVATE insimul)
target_compile_definitions(insimul_neutrality PRIVATE ${INSIMUL_ENGINE_ROWS})
add_test(NAME abi_neutral_runtime COMMAND insimul_neutrality)
set_tests_properties(abi_neutral_runtime PROPERTIES TIMEOUT 120)

# abi_neutrality — the source half: the header names no vendor and a
# vendor-shaped consumer does not compile. It runs each check against a
# deliberately broken fixture too, so the gate is proven able to fail.
add_test(NAME abi_neutrality COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_abi_neutrality.sh
       ${CMAKE_CURRENT_SOURCE_DIR}
       ${CMAKE_C_COMPILER})

# trealla_vendor — the engine source under vendor/trealla/ IS upstream's source
# at the pinned commit (recomputed git object ids, offline), the pin the build
# used is the pin in VENDORED.json, and no network fetch of the engine has crept
# back in. Runs against tampered fixtures too, so the gate is proven able to fail.
add_test(NAME trealla_vendor COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_trealla_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}
       ${TREALLA_GIT_COMMIT}
       ${TREALLA_GIT_TAG})

# Conformance harness (US-LI3): drives the ABI over every golden corpus case.
# INSIMUL_CONFORMANCE_DEFAULT_DIR is resolved above (shared with the wasm leg).
# Also a pure consumer of insimul.h.
add_executable(insimul_conformance tests/conformance.c)
target_link_libraries(insimul_conformance PRIVATE insimul)
target_compile_definitions(insimul_conformance PRIVATE
  INSIMUL_CONFORMANCE_DEFAULT_DIR="${INSIMUL_CONFORMANCE_DEFAULT_DIR}")
add_test(NAME conformance COMMAND insimul_conformance)

# Snapshot/restore (US-LI4). The `snapshot` ctest is a pure consumer of insimul.h;
# its golden fixture (an exact snapshot image) is baked as an absolute path so the
# test finds it regardless of the ctest working directory.
set(INSIMUL_SNAPSHOT_FIXTURE
  "${CMAKE_CURRENT_SOURCE_DIR}/conformance/snapshots/basic.snapshot.pl")
add_executable(insimul_snapshot tests/snapshot.c)
target_link_libraries(insimul_snapshot PRIVATE insimul)
target_compile_definitions(insimul_snapshot PRIVATE
  INSIMUL_SNAPSHOT_FIXTURE="${INSIMUL_SNAPSHOT_FIXTURE}")
add_test(NAME snapshot COMMAND insimul_snapshot)
# The test reads/updates the fixture by relative path when INSIMUL_SNAPSHOT_UPDATE
# is set; run it from the source dir so that path resolves.
set_tests_properties(snapshot PROPERTIES
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})

# snapshot_parse: cross-check the committed snapshot fixture against
# insimul-runtime's real prolog-fact-parser.ts (the wrappers' parser), via node.
# The shell driver degrades to a loud [SKIP] if node or the submodule parser is
# absent (see tests/run_snapshot_parse.sh).
get_filename_component(INSIMUL_FACT_PARSER_TS
  "${CMAKE_CURRENT_SOURCE_DIR}/../insimul-runtime/packages/core/src/prolog/prolog-fact-parser.ts"
  ABSOLUTE)
add_test(NAME snapshot_parse COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_snapshot_parse.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/tests/verify_snapshot_ts.mjs
       ${INSIMUL_SNAPSHOT_FIXTURE}
       ${CMAKE_CURRENT_SOURCE_DIR}/conformance/snapshots/basic.snapshot.expected.json
       ${INSIMUL_FACT_PARSER_TS})

# Version stamp (US-LI5). A pure consumer of insimul.h: it asserts the semver
# CMake read from the VERSION file is embedded in insimul_version() and that the
# stamp is well-formed (git sha + engine field present). The expected semver is
# passed as a compile def so the test tracks the VERSION file with no edits.
add_executable(insimul_version_test tests/version.c)
target_link_libraries(insimul_version_test PRIVATE insimul)
target_compile_definitions(insimul_version_test PRIVATE
  EXPECT_SEMVER="${INSIMUL_SEMVER}")
add_test(NAME version COMMAND insimul_version_test)

# ---------------------------------------------------------------------------
# The measurement harness (tasklist 250 US-3) — NOT a ctest.
#
# insimul_bench produces the figures docs/SWIPL_MEASUREMENT.md publishes; it is
# driven by scripts/measure.sh, which runs it once per process (a cold engine
# start is measurable only once per process) and against the committed world in
# bench/world/. It is deliberately not registered with ctest: a benchmark's
# wall clock is not a pass/fail gate, and making `ctest` time depend on the host
# is how gates get muted. It IS built by the default build, so it cannot rot.
# Like every test here it is a pure consumer of include/insimul.h, which is what
# makes the same binary measure both engine selections.
# ---------------------------------------------------------------------------
add_executable(insimul_bench tests/bench.c)
target_link_libraries(insimul_bench PRIVATE insimul)

# ---------------------------------------------------------------------------
# libinsimulcore tests (tasklist 104). corebridge/ is added above, native-only.
# ---------------------------------------------------------------------------

# The vendored core bundle's provenance, read straight out of the manifest the
# vendoring tool writes — so the expectation tracks a re-vendor with no edits
# here, and a bundle swapped in without its manifest fails the smoke test.
file(READ ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/VENDORED.json
     INSIMULCORE_VENDORED_JSON)
string(REGEX MATCH "\"coreCommit\"[ \t]*:[ \t]*\"([^\"]*)\""
       _ "${INSIMULCORE_VENDORED_JSON}")
set(INSIMULCORE_BUNDLE_COMMIT "${CMAKE_MATCH_1}")
if(NOT INSIMULCORE_BUNDLE_COMMIT)
  message(FATAL_ERROR
    "corebridge/vendor/core/VENDORED.json records no coreCommit — the bundle has no provenance")
endif()

# corebridge_smoke: a pure consumer of insimulcore.h (no quickjs.h, no insimul.h).
# Boots the bridge, asserts the adopted surface, and cross-checks the version
# stamp against the two pins CMake read out of the vendored tree.
add_executable(insimulcore_smoke tests/corebridge_smoke.c)
target_link_libraries(insimulcore_smoke PRIVATE insimulcore)
target_compile_definitions(insimulcore_smoke PRIVATE
  EXPECT_QUICKJS="${QUICKJS_VERSION}"
  EXPECT_CORE_COMMIT="${INSIMULCORE_BUNDLE_COMMIT}")
add_test(NAME corebridge_smoke COMMAND insimulcore_smoke)

# ---------------------------------------------------------------------------
# corebridge_radiant (US-2): the evidence that moved with the bridge.
#
# insimul-godot's adoption proved libinsimulcore end to end by driving the shared
# radiant conformance corpus through core's REAL TypeScript. That claim has to
# stay true from here, so the gate itself was promoted alongside the library:
# tests/radiant/radiant_bridge.cpp is a byte-for-byte copy of
# insimul-godot/gdextension/test/test_radiant_bridge.cpp, and the three support
# units beside it are byte-for-byte copies of that repo's std-only JSON/canonical/
# sha256 helpers. Same comparison rules, same corpus, same MIN_CASES/REQUIRED_AREAS
# floor — so "no behaviour difference" is a diff, not an argument
# (conformance/RADIANT_PARITY.md).
#
# It is the only C++ in this repo; CXX is enabled here rather than in project()
# so libinsimul itself keeps a pure-C toolchain requirement.
# ---------------------------------------------------------------------------
enable_language(CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Same resolution order the prolog corpus uses (env is applied by the driver
# below): vendored mirror → the monorepo sibling. Empty is a CONFIGURE-time
# error, so a checkout whose parity gate has nothing to run cannot be generated —
# the rule cmake/wasm.cmake already applies to the prolog corpus.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/conformance/radiant")
  get_filename_component(INSIMUL_RADIANT_DEFAULT_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/conformance/radiant" ABSOLUTE)
else()
  get_filename_component(INSIMUL_RADIANT_DEFAULT_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../insimul-runtime/packages/core/conformance/radiant"
    ABSOLUTE)
endif()
file(GLOB INSIMUL_RADIANT_CASES CONFIGURE_DEPENDS "${INSIMUL_RADIANT_DEFAULT_DIR}/*.json")
if(NOT INSIMUL_RADIANT_CASES)
  message(FATAL_ERROR
    "no radiant conformance corpus under ${INSIMUL_RADIANT_DEFAULT_DIR} — the "
    "corebridge_radiant gate would execute nothing. Restore conformance/radiant/ "
    "(see conformance/VENDORED.md).")
endif()

add_executable(insimulcore_radiant
  tests/radiant/radiant_bridge.cpp
  tests/radiant/json_value.cpp
  tests/radiant/canonical_json.cpp
  tests/radiant/sha256.cpp)
# A pure consumer of insimulcore.h — no quickjs.h, no insimul.h, no trealla.h.
# Linking insimulcore pulls libinsimul in as an INTERFACE requirement, which is
# the point: core's radiant algorithm is Prolog-driven and runs on the native
# engine this repo builds, not on a wasm copy of it.
target_link_libraries(insimulcore_radiant PRIVATE insimulcore)

# `core` — the adopted implementation. Must match the corpus exactly.
add_test(NAME corebridge_radiant COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_radiant.sh
       $<TARGET_FILE:insimulcore_radiant> ${INSIMUL_RADIANT_DEFAULT_DIR} core)
# `none` — the leg that emits nothing, kept because the gate file is byte-for-byte
# godot's. Here it asserts a property of the CORPUS rather than of an engine: that
# at least one case expects quests (`gain > 0`) and that every executed case is
# classified. A corpus that expected nothing anywhere would make the `core` leg
# above pass while proving nothing, and this is what catches that.
add_test(NAME corebridge_radiant_none COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_radiant.sh
       $<TARGET_FILE:insimulcore_radiant> ${INSIMUL_RADIANT_DEFAULT_DIR} none)

# core_vendor: the sha256 drift guard over the vendored @insimul/core bundle —
# the same discipline conformance/VENDORED.md applies to the corpus. It hashes
# every vendored/adapter file against VENDORED.json, so a hand-edited bundle, a
# stale generated C array, or a js/ edit that was never re-bundled all fail here.
# Needs node; run_core_vendor.sh degrades to a loud [SKIP] without it (read the
# output — a check that prints [SKIP] asserted nothing).
add_test(NAME core_vendor COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs)

# history_scan: the PRE-OPEN history audit (US-1, tasklist 242-pre-open-native).
# Every other gate in this file reads the working tree; this one reads the 32
# commits behind it, because `git clone` publishes all of them and deleting a
# secret in a later commit hides it from exactly nobody. It falsifies the scanner
# against a synthetic positive per rule FIRST, then audits this repository, then
# runs the whole thing against a throwaway repository with a planted secret — and
# fails if that one passes. Needs node; run_history_scan.sh degrades to a loud
# [SKIP] without it (read the output — a check that prints [SKIP] asserted
# nothing, and this is the one standing between us and a permanent public
# history).
add_test(NAME history_scan COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_history_scan.sh
       ${CMAKE_CURRENT_SOURCE_DIR})

# open_boundary: the PRE-OPEN CONTENT + DEPENDENCY audits (US-2, tasklist
# 242-pre-open-native). `history_scan` above audits the 30-odd commits behind
# this tree, once, because history is written once. These two audits are
# properties of the TREE — no closed genre/language pack or generation heuristic
# is vendored, and nothing from the closed insimul-backend / insimul-web is
# imported or reachable — so they must hold at every future commit, and the
# commit that breaks one will not be the commit that is thinking about
# open-sourcing. run_open_boundary.sh falsifies the gate against a synthetic
# positive per rule, audits this tree, and then injects five real violations into
# a copy of it and fails if the gate does not catch every one. Needs node;
# degrades to a loud [SKIP] without it (read the output).
add_test(NAME open_boundary COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_open_boundary.sh
       ${CMAKE_CURRENT_SOURCE_DIR})
