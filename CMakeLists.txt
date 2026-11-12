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

# corebridge_cases (Features Round C0): every method of libinsimulcore's table,
# called from C through insimulcore.h, over two case directories — the corpus
# vendor-core-bundle.mjs transcribes from core's own conformance files at the
# pinned commit (corebridge/vendor/core/cases/, generated) and the hand-written
# cases for behaviour no core corpus pins yet (corebridge/tests/cases/). Case
# format and matcher rules: corebridge/tests/README.md. A pure consumer of
# insimulcore.h, like corebridge_smoke. Never skips: both directories are in-repo.
add_executable(insimulcore_cases tests/corebridge_cases.c)
target_link_libraries(insimulcore_cases PRIVATE insimulcore m)
add_test(NAME corebridge_cases COMMAND insimulcore_cases
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/cases
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tests/cases)

# The JS leg: the same generated bundle evaluated in Node (V8, Node's crypto)
# over the same cases; and the parity leg, which diffs the RAW result string of
# every step between QuickJS-through-C and V8. Need node; a loud [SKIP] without.
add_test(NAME corebridge_cases_js COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_corebridge_cases.sh js ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME corebridge_cases_parity COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_corebridge_cases.sh parity ${CMAKE_CURRENT_SOURCE_DIR}
       $<TARGET_FILE:insimulcore_cases> ${CMAKE_CURRENT_BINARY_DIR})

# layout_corpus (L.native-layout, ruling U36): core's village-layout rules as
# libinsimulcore's `layout.*` rows, held to core's own layout corpora —
# conformance/layout/ and conformance/layout-composition/, COPIED byte for byte
# into corebridge/vendor/core/conformance/ at the pin (sha256s in VENDORED.json,
# checked by core_vendor; byte-compared with core by `--check --core`). The
# runner resolves fixtures, calls `layout.<op>` through insimulcore.h and
# compares by the corpus's rule; it also fails on a row no case names, an op
# core declares that is not a row, and a comparator that cannot fail
# (tests/layout_corpus.cpp). A pure consumer of insimulcore.h; the JSON reader is
# tests/radiant/json_value.cpp, used unchanged. Never skips: the corpus is in-repo.
add_executable(insimulcore_layout tests/layout_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_layout PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_layout PRIVATE insimulcore)
add_test(NAME layout_corpus COMMAND insimulcore_layout
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance/layout
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance/layout-composition)
# The negative control: the same runner over a one-case corpus whose expectation
# is deliberately wrong (tests/layout-negative/). It passes only when the runner
# reports THAT case as differing and the run as failed — not on any non-zero exit,
# which a missing directory or a crash would also give.
add_test(NAME layout_corpus_negative COMMAND insimulcore_layout --only wrong-answer
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/layout-negative)
set_tests_properties(layout_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "expected WRONGLY to hold a door [^\n]*boolean differs.*layout_corpus: FAIL")

# packs_corpus (SP.composer-native, rulings U62(1) and U79(4)): core's composer
# as libinsimulcore's `packs.compose` row, held to core's own pack-composition
# corpus — conformance/packs/composition.json and the packs/ catalog its
# `catalog` names, COPIED byte for byte into corebridge/vendor/core/ at the pin
# (sha256s in VENDORED.json, checked by core_vendor; byte-compared with core by
# `--check --core`). The runner sends each case's `input` with the catalog beside
# it through insimulcore.h and compares by core's replay rule: an exact answer,
# or core's `[<code>]` refusal in last_error (tests/packs_corpus.cpp). It also
# fails when the table has no packs.compose row and when its comparator cannot
# fail. A pure consumer of insimulcore.h; the JSON reader is
# tests/radiant/json_value.cpp, used unchanged. Never skips: the corpus is in-repo.
add_executable(insimulcore_packs tests/packs_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_packs PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_packs PRIVATE insimulcore)
add_test(NAME packs_corpus COMMAND insimulcore_packs
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance/packs/composition.json)
# The negative control: the same runner over two deliberately wrong cases
# (tests/packs-negative/), one wrong answer and one wrong refusal code. It passes
# only when the runner reports BOTH as failing and the run as failed.
add_test(NAME packs_corpus_negative COMMAND insimulcore_packs
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/packs-negative/wrong-answer.json)
set_tests_properties(packs_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "expected WRONGLY to compose to an empty object [^\n]*unexpected key.*refused WRONGLY as an unknown recipe [^\n]*CompositionError: \\[unknown-engine\\].*packs_corpus: FAIL")

# p9a corpora (P9a.native, rulings U84 and U79(4)): core's genre HUD, world rules
# panel and mechanic runtime as libinsimulcore's `ui.genreHud`, `ui.rulesPanel`
# and `mechanics.run` rows, held to core's own corpora —
# conformance/ui/genre-hud-cases.json, conformance/ui/rules-panel-cases.json and
# conformance/modules/mechanic-runtime.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/ at the pin (sha256s in VENDORED.json,
# checked by core_vendor; byte-compared with core by `--check --core`). The
# runner sends every case through insimulcore.h and compares exactly
# (tests/p9a_corpus.cpp); it also fails when a row is missing from the table, when
# a UI corpus declares an op no case exercises, and when its comparator cannot
# fail. One ctest per row, so removing a row turns its own test red. A pure
# consumer of insimulcore.h; the JSON reader is tests/radiant/json_value.cpp, used
# unchanged. Never skips: the corpora are in-repo.
add_executable(insimulcore_p9a tests/p9a_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_p9a PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_p9a PRIVATE insimulcore)
set(INSIMUL_P9A_CORPUS ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance)
add_test(NAME genre_hud_corpus COMMAND insimulcore_p9a
  genre-hud=${INSIMUL_P9A_CORPUS}/ui/genre-hud-cases.json)
add_test(NAME rules_panel_corpus COMMAND insimulcore_p9a
  rules-panel=${INSIMUL_P9A_CORPUS}/ui/rules-panel-cases.json)
add_test(NAME mechanic_runtime_corpus COMMAND insimulcore_p9a
  mechanics=${INSIMUL_P9A_CORPUS}/modules/mechanic-runtime.json)
# The negative control: the same runner over three deliberately wrong files
# (tests/p9a-negative/), one per row; the genre HUD one also holds a wrong
# config_of projection and a case it cannot drive, counted undriven
# (PL.native-genre-hud-config). It passes only when the runner reports EVERY wrong
# case as differing or undriven, in order, and the run as failed —
# not on any non-zero exit, which a missing file or a crash would also give.
add_test(NAME p9a_corpus_negative COMMAND insimulcore_p9a
  genre-hud=${CMAKE_CURRENT_SOURCE_DIR}/tests/p9a-negative/genre-hud-wrong.json
  rules-panel=${CMAKE_CURRENT_SOURCE_DIR}/tests/p9a-negative/rules-panel-wrong.json
  mechanics=${CMAKE_CURRENT_SOURCE_DIR}/tests/p9a-negative/mechanics-wrong.json)
set_tests_properties(p9a_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "expected WRONGLY without a compass [^\n]*showCompass: boolean differs.*expected WRONGLY as its uiLayout [^\n]*value[.]layout: \"action_rpg\" != \"fighting\".*WRONGLY undriven [^\n]*needs an input object.*genre-hud-wrong[.]json [^\n]*1 case[(]s[)] undriven.*genre-hud-wrong[.]json via ui[.]genreHud: 3 case[(]s[)], driven 2 [(]config 1, config_of 1[)], 1 undriven.*expected WRONGLY inactive [^\n]*\\$: boolean differs.*expected WRONGLY to deal 7 [^\n]*damage: 7 != 6.*p9a_corpus: FAIL")

# saves_slots_corpus (PL.native-catchup, rulings U83(1), U84 and U87): core's
# SaveSlotsSession (save slots, Continue, autosave, quick save / load) as
# libinsimulcore's `saves.slots.create` / `saves.slots.apply` session rows, held
# to core's own corpus — conformance/saves/slots.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/saves/ at the pin (sha256 in VENDORED.json,
# checked by core_vendor; byte-compared with core by `--check --core`). The
# runner drives every config, continue, rows and run case through a session
# (one apply per run step) and compares by the corpus's rule; the indicator cases,
# which show a bare indicator no session step can, are reported with a measured
# reason each (tests/saves_slots_corpus.cpp). It fails when a row is missing,
# when any other case cannot be driven, when a declared op goes undriven, when a
# session is left open, and when its comparator cannot fail. A pure consumer of
# insimulcore.h; the JSON reader is tests/radiant/json_value.cpp, used unchanged.
# Never skips: the corpus is in-repo.
add_executable(insimulcore_saves_slots tests/saves_slots_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_saves_slots PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_saves_slots PRIVATE insimulcore)
add_test(NAME saves_slots_corpus COMMAND insimulcore_saves_slots
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance/saves/slots.json)
# The negative control: the same runner over two deliberately wrong cases
# (tests/saves-negative/), one config and one run. It passes only when the runner
# reports BOTH as differing and the run as failed.
add_test(NAME saves_slots_corpus_negative COMMAND insimulcore_saves_slots
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/saves-negative/slots-wrong.json)
set_tests_properties(saves_slots_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "expected WRONGLY to resolve no config to four slots [^\n]*slotCount: 4 != 3.*expected WRONGLY to delete an empty slot [^\n]*unexpected key 'refusal'.*saves_slots_corpus: FAIL")

# props_corpus (PL.native-props-rows, rulings U89(2) and U36): core's P6 logic —
# containers, documents and the reader, doors, the notice board and the notices a
# settlement posts, and the inventory panel's view-model — as libinsimulcore's
# `props.*` and `inventory.*` rows, held to core's own corpora:
# conformance/props/{containers,documents,doors,notice-board}.json and
# conformance/ui/inventory-cases.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/ at the pin (sha256 in VENDORED.json, checked
# by core_vendor; byte-compared with core by `--check --core`). One ctest per file;
# every case is driven through the rows (the stateful ops one apply per step) and
# compared by the corpora's rule, and each file's contract tables are held to
# `props.contract` (tests/props_corpus.cpp). A run fails on a missing row, an op
# no case drives, a session left open, and a comparator that cannot fail. A pure
# consumer of insimulcore.h; the JSON reader is tests/radiant/json_value.cpp,
# used unchanged. Never skips: the corpora are in-repo.
add_executable(insimulcore_props_corpus tests/props_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_props_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_props_corpus PRIVATE insimulcore)
set(INSIMUL_PROPS_CORPUS ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance)
add_test(NAME props_containers_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/containers.json)
add_test(NAME props_documents_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/documents.json)
add_test(NAME props_doors_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/doors.json)
add_test(NAME props_notice_board_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/notice-board.json)
add_test(NAME inventory_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/ui/inventory-cases.json)
# PL.native-pickup-settle (U91(2)): core's pick-up placement corpus (PL.pickup-placement)
# through the props.pickups.* rows, by the same runner: every case driven, the
# contract's data tables (frames and the constants' values among them) held to
# props.contract, the file's `numerics` required to name double precision.
add_test(NAME props_pickup_placement_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/pickup-placement.json)
# PL.native-interact-target (U94(3)): core's interact rule (PL.examine-props, core
# 2158b08: each stated prop's one meaning, what reading and examining say, where
# the notice board is posted, and the one thing a press of E acts on) through the
# props.interactables.* rows, by the same runner: every case driven (the runner
# walks a case's props and stands as core's does, one row call each), the
# contract's data tables held to props.contract.
add_test(NAME props_interactables_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/props/interactables.json)
# The negative control: the same runner over five deliberately wrong files
# (tests/props-negative/), one per corpus file, one wrong case each (two through
# a stateless row, two through a session, one through the door session), plus a
# wrong contract table and four container ops with no case. It passes only when
# the runner reports the table, the undriven op, every wrong case and the run as
# failed, in that order.
add_test(NAME props_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/containers-wrong.json
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/documents-wrong.json
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/doors-wrong.json
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/notice-board-wrong.json
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/inventory-wrong.json)
set_tests_properties(props_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.defaultCapacity: 12 != 10.*expected WRONGLY a capacity of 12 [^\n]*capacity: 12 != 10.*op unlock of area props-containers: no case of it was driven.*expected WRONGLY page 2 after next [^\n]*page: 2 != 1.*expected WRONGLY to enter a locked door without its key [^\n]*boolean differs.*expected WRONGLY two notices for one NPC [^\n]*length 2 != 1.*expected WRONGLY four loaves [^\n]*quantity: 4 != 5.*props_corpus: FAIL")

# Its negative control (tests/props-negative/pickup-placement-wrong.json): a
# `numerics` that names float32, a wrong frame and a wrong constant in the contract, a
# `ring` op with no case, and four wrong cases — a clearance whose `ok` is wrong,
# a settle expected with a turned building's axis MIRRORED (z negated, the way a
# binding that flipped its forward would read it), a sequence placement off by
# more than the tolerance, and a `bad-spot` refusal expected where core settles.
# It passes only when the runner reports each of them and the run as failed, in
# that order. No two wildcards stand side by side in the regex (PL.native-camera-movement,
# from pl-native-interact-target's m3): `[^\n]*.*` makes CMake's matcher backtrack for
# minutes on a red run, so each `[^\n]*` is followed by a literal from that line's report.
add_test(NAME props_pickup_placement_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/pickup-placement-wrong.json)
set_tests_properties(props_pickup_placement_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "numerics: the file states \"[^\"]*float32[^\"]*\", not double precision.*contract.frames.unreal: .*contract.constants.spacingM: 2.5 != 3.*expected WRONGLY a clearance with ok false [^\n]*ok: boolean differs.*expected WRONGLY with the building's axis mirrored [^\n]*at.x: 0.2576.*expected WRONGLY the second pick-up 0.01 m further out [^\n]*placements.*expected WRONGLY bad-spot for a settled spot [^\n]*unexpected key 'at'.*op ring of area props-pickup-placement: no case of it was driven.*props_corpus: FAIL")

# Its negative control (tests/props-negative/interactables-wrong.json): a wrong
# range in the contract, a `noun` op with no case, and five wrong cases, each the
# answer an engine keeping one of Unreal's interim rules would give (the
# deviations core records): the board's host sign also read as a sign, a fence
# offered, a pick-up passed over for a nearer barrel, a tie kept by the LAST prop,
# and a text that ends in its own full stop given a second one; and two runner
# controls core's corpus cannot be (no core case changes its answer with them): a
# target whose `ranges` reach a prop the defaults do not, and an interact case that
# states one `prop` alone. It passes only when the runner reports each of them and
# the run as failed, in that order.
add_test(NAME props_interactables_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/interactables-wrong.json)
set_tests_properties(props_interactables_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.rangesM.talk: 3 != 3.5.*expected WRONGLY the board's host sign read as a sign.*expected WRONGLY a fence offered.*expected WRONGLY the nearer barrel examined before the pick-up.*expected WRONGLY the last listed prop on a tie.*expected WRONGLY a second full stop.*expected WRONGLY nothing in reach where the host's own ranges reach the crate.*expected WRONGLY no result for a lone prop.*op noun of area props-interactables: no case of it was driven.*props_corpus: FAIL")

# PL.native-camera-movement (U95(5)): core's movement contract (PL.movement-contract,
# core 89dd9ed, and PL.movement-followups, 431c95b: what each camera mode's lens
# hides, what blocks a side view's strip, a building's solid from the IR, how the
# move input maps per mode, the run, and the slope and step limits) through the
# camera.movement.* rows, by the same runner: every case driven (the case's input
# as the row's args), every case driven again with its solids and exclude reversed
# (the file's order rule, as core's runner checks it), the contract's data tables
# held to camera.movement.contract. Unreal's P7 cell binds these rows.
add_test(NAME camera_movement_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/camera/movement.json)
# The order run must have happened, and nothing may be left undriven: with no
# order-dependent row there is no wrong answer for the reversed run to catch, so
# the ctest asserts that the run reports it (a regex replaces the exit code, and
# "props_corpus: PASS" is printed only when nothing failed). No ';' in it: CMake
# would split the property into a list of regexes, any one of which passes.
set_tests_properties(camera_movement_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "camera-movement: [0-9]+ case[(]s[)], driven [^\n]*, step [0-9]+. 0 undriven\n  order: [1-9][0-9]* case[(]s[)] driven again with solids and exclude reversed, the same answer\n.*props_corpus: PASS")
# Its negative control (tests/props-negative/movement-wrong.json, made from the
# vendored file): Unreal's 45 cm step in the contract, a slopeAtRest op with no
# case, and six wrong cases, each the answer an engine keeping one of its interim
# rules would give (the P7 cell's round-2 m4, m5 and m6, and the follow-ups): the
# Smithy drawn in the side view (no occlusion), a third-person sight line read at
# yaw 0 where no view yaw was given (core's answer before PL.movement-followups),
# the isometric right mirrored onto the IR's -X, Unreal's 7.5/4.2 run, a 50 degree
# slope walked (Unreal's villagers' floor) and a 0.75 m rise refused (Unreal's
# 45 cm step). It passes only when the runner reports each of them and the run as
# failed, in that order. No two wildcards stand side by side in the regex.
add_test(NAME camera_movement_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/movement-wrong.json)
set_tests_properties(camera_movement_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.ground.stepUpM: 0.45 != 0.75.*expected WRONGLY the Smithy drawn in the side view [^\n]*hidden: length 0 != 1.*expected WRONGLY a third-person sight line read at yaw 0 [^\n]*unexpected key .error.*expected WRONGLY the isometric right mirrored [^\n]*velocity.x: -4.5 != 4.5.*expected WRONGLY Unreal.s 7.5/4.2 run [^\n]*velocity.z: 8.03.*expected WRONGLY a 50 degree slope walked [^\n]*response: .walk. != .slide.*expected WRONGLY a 0.75 m rise refused [^\n]*response: .blocked. != .step.*op slopeAtRest of area camera-movement: no case of it was driven.*props_corpus: FAIL")

# PL.native-ground-row (U97(3)): core's ground reading (PL.ground-from-ir, core
# 91a180d, U94(5): where the host's listener is, settlement or wilderness, and what
# is under the foot, read from the World IR's settlements, roads and ground
# surfaces, and the step that makes) through the audio.ground.* rows, by the same
# runner: every case driven (the case's input as the row's args), every case
# driven again with its world's settlements, groundSurfaces and roads reversed
# (the file's order rule, as core's runner checks it), the contract's data keys
# held to audio.ground.contract. Unreal's P5.unreal.ground-from-ir cell binds
# these rows in place of its interim Portable/InsimulAudioPlace reading. As
# camera_movement_corpus's, the regex demands the order run and 0 undriven, and
# holds no ';'.
add_test(NAME audio_ground_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/audio/ground.json)
set_tests_properties(audio_ground_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "contract: 2 table[(]s[)] are audio.ground.contract's\n.*audio-ground: [0-9]+ case[(]s[)], driven placeAt [0-9]+, groundSurfaceAt [0-9]+, footstepAt [0-9]+. 0 undriven\n  order: [1-9][0-9]* case[(]s[)] driven again with the world's settlements, groundSurfaces and roads reversed, the same answer\n.*props_corpus: PASS")
# Its negative control (tests/props-negative/ground-wrong.json, made from the
# vendored file): Unreal's sidewalk for a footpath with no archetype in the
# contract, a footstepAt op with no case, and six wrong cases, each the answer an
# engine keeping one of its interim readings would give (core's sources line names
# four, pl-ground-from-ir's m1 the fifth): a non-finite position read as the
# wilderness, the open ground refused, a stated road id ignored for
# road.<fromId>.<toId>, a footpath with no archetype read as sidewalk, the first
# listed road taken on a tie, and a road of width 0 read. It passes only when the
# runner reports each of them and the run as failed, in that order. No two
# wildcards stand side by side in the regex.
add_test(NAME audio_ground_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/ground-wrong.json)
set_tests_properties(audio_ground_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.ground.kindDefaults.footpath: .terrain.texture.sidewalk. != .terrain.texture.path.*expected WRONGLY the wilderness for a position that is not finite [^\n]*reading: expected a object, got a null.*expected WRONGLY no reading where the world states no ground [^\n]*reading: expected a null, got a object.*expected WRONGLY a stated road id ignored [^\n]*shapeId: .road.a.b. != .road.map.lane-7.*expected WRONGLY a footpath with no archetype read as sidewalk [^\n]*surface: .terrain.texture.sidewalk. != .terrain.texture.path.*expected WRONGLY the first listed road on a tie [^\n]*surface: .terrain.texture.road. != .terrain.texture.gravel.*expected WRONGLY the road of width 0 read [^\n]*surface: .terrain.texture.road. != .terrain.texture.ground.*op footstepAt of area audio-ground: no case of it was driven.*props_corpus: FAIL")

# survival_corpus (PL.native-survival-rows, rulings U106(1) and U36): core's P9c
# logic (P9c.core and PL.core-survival-rules: src/survival/needs.ts,
# survival-hud.ts, survival-systems.ts, src/stamina/stamina.ts and
# game-engine/logic/StaminaPool.ts) as libinsimulcore's `survival.*` rows, held to
# core's own corpora: conformance/survival/{needs,hud,stamina}.json, COPIED byte for
# byte into corebridge/vendor/core/conformance/survival/ at the pin
# (vendor-core-bundle.mjs SURVIVAL_CORPUS_FILES; hashed, and byte-compared under
# --check --core). tests/survival_corpus.cpp drives EVERY case through the rows: an
# op whose case input is a row's args as is, a run one row per step over the state
# the last answer carried, a pool one survival.stamina.pool.apply per step. The
# first argument is the vendored core root, whose composition.json names the pack
# catalog hud.json's systems cases compose over. Unreal's Portable/InsimulSurvival
# is the interim copy these rows retire (P9c.unreal.retire-survival-copy). The regex
# demands each file's driven line with 0 undriven, in file order, and holds no ';'.
set(INSIMUL_CORE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core)
add_executable(insimulcore_survival_corpus tests/survival_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_survival_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_survival_corpus PRIVATE insimulcore)
add_test(NAME survival_corpus COMMAND insimulcore_survival_corpus ${INSIMUL_CORE_ROOT}
  ${INSIMUL_PROPS_CORPUS}/survival/needs.json ${INSIMUL_PROPS_CORPUS}/survival/hud.json
  ${INSIMUL_PROPS_CORPUS}/survival/stamina.json)
set_tests_properties(survival_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "survival-needs: [0-9]+ case[(]s[)], driven tuning [1-9][0-9]*, initial [1-9][0-9]*, run [1-9][0-9]*, save [1-9][0-9]*, load [1-9][0-9]*. 0 undriven\n.*survival-hud: [0-9]+ case[(]s[)], driven view [1-9][0-9]*, run [1-9][0-9]*, systems [1-9][0-9]*. 0 undriven\n.*survival-stamina: [0-9]+ case[(]s[)], driven tuning [1-9][0-9]*, bands [1-9][0-9]*, spend [1-9][0-9]*, regen [1-9][0-9]*, pool [1-9][0-9]*, clock [1-9][0-9]*. 0 undriven\n.*survival_corpus: PASS")
# Its negative pass, as Unreal's survival_corpus_negative: every case's expectation
# perturbed (its value's last leaf, or its refusal's) must be refused, each file's
# count and the total stated; the runner prints PASS only when every case of every
# file was refused (refused == cases, none accepted, no case undriven).
add_test(NAME survival_corpus_negative COMMAND insimulcore_survival_corpus --negative ${INSIMUL_CORE_ROOT}
  ${INSIMUL_PROPS_CORPUS}/survival/needs.json ${INSIMUL_PROPS_CORPUS}/survival/hud.json
  ${INSIMUL_PROPS_CORPUS}/survival/stamina.json)
set_tests_properties(survival_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*survival_corpus --negative: [1-9][0-9]* of [0-9]+ perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)].*survival_corpus --negative: PASS")

# title_corpus (PL.native-title-rows, rulings U92(1) and U36): core's P8 logic —
# the title menu over the save slots (src/ui/title-flow.ts), the tutorial quest
# (TutorialQuestSystem) and the onboarding flow on it (OnboardingManager) — as
# libinsimulcore's `ui.titleFlow.*`, `ui.tutorial.*` and `ui.onboarding.*` rows,
# held to core's own corpora: conformance/ui/title-flow.json and
# conformance/quests/tutorial.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/ at the pin (sha256s in VENDORED.json, checked
# by core_vendor; byte-compared with core by `--check --core`). The runner drives
# EVERY case through the rows (a title `session` case through a `saves.slots`
# session the title menu links; tutorial and onboarding sessions on a host clock
# at the file's `contract.t0`), compares by the corpus's rule, prints the driven
# count per op and the undriven count, and holds each file's contract tables to
# `ui.titleFlow.contract` / `ui.tutorial.contract` (tests/title_corpus.cpp). A run
# fails on a missing row, an undriven case, an op no case drives, a session left
# open, and a comparator that cannot fail. One ctest per file; never skips.
add_executable(insimulcore_title_corpus tests/title_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_title_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_title_corpus PRIVATE insimulcore)
set(INSIMUL_TITLE_CORPUS ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance)
add_test(NAME title_flow_corpus COMMAND insimulcore_title_corpus ${INSIMUL_TITLE_CORPUS}/ui/title-flow.json)
add_test(NAME tutorial_corpus COMMAND insimulcore_title_corpus ${INSIMUL_TITLE_CORPUS}/quests/tutorial.json)
# The tutorial progress corpus (PL.native-tutorial-save, U99(1); core's
# PL.tutorial-progress-save, U97(4)): conformance/saves/tutorial-progress.json,
# copied with the save corpora, driven by the same runner through
# `ui.tutorial.readProgress`, the create rows' `progress` and the apply rows'
# `save` op, on a host clock at the file's `contract.clockStart`.
add_test(NAME tutorial_progress_corpus COMMAND insimulcore_title_corpus ${INSIMUL_TITLE_CORPUS}/saves/tutorial-progress.json)
# The negative controls (tests/title-negative/), one per file: each holds a wrong
# contract table, wrong cases and a case the runner cannot drive. They pass only
# when the runner reports each of them, the undriven count and the run as failed,
# in that order — not on any non-zero exit, which a missing file or a crash would
# also give.
add_test(NAME title_flow_corpus_negative COMMAND insimulcore_title_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/title-negative/title-flow-wrong.json)
set_tests_properties(title_flow_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.defaultTitle: \"Untitled\" != \"Insimul\".*expected WRONGLY with Load Game refused [^\n]*entries.2.[.]enabled: boolean differs.*expected WRONGLY to open New Game into the empty dedicated quick slot [^\n]*newGame[.]slot: expected a number, got a null.*expected WRONGLY with the menu not busy [^\n]*menu[.]busy: boolean differs.*WRONGLY undriven, a step no row takes [^\n]*not driven.*title-flow-wrong[.]json [^\n]*1 case[(]s[)] undriven.*ui-title-flow: 4 case[(]s[)], driven 3 [(]menu 1, choose 1, session 1[)], 1 undriven, 5 failed.*title_corpus: FAIL")
add_test(NAME tutorial_corpus_negative COMMAND insimulcore_title_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/title-negative/tutorial-wrong.json)
set_tests_properties(tutorial_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.flows: length 1 != 2.*expected WRONGLY with the unbound quest log lesson kept [^\n]*objectives: length 6 != 5.*expected WRONGLY with the first lesson 1 ms longer [^\n]*durationMs: 4001 != 4000.*expected WRONGLY with one more step [^\n]*totalSteps: 7 != 6.*expected WRONGLY with no onCompleted [^\n]*calls: length 0 != 1.*WRONGLY undriven, a step no row takes [^\n]*not driven.*tutorial-wrong[.]json [^\n]*1 case[(]s[)] undriven.*quests-tutorial: 5 case[(]s[)], driven 4 [(]objectives 1, run 1, onboarding 2[)], 1 undriven, 6 failed.*title_corpus: FAIL")
add_test(NAME tutorial_progress_corpus_negative COMMAND insimulcore_title_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/title-negative/tutorial-progress-wrong.json)
set_tests_properties(tutorial_progress_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.blockMembers: length 3 != 4.*contract.tutorialSteps: length 6 != 7 [(]the runner maps .*expected WRONGLY with the saved current lesson kept [^\n]*state.current: .tut_menu. != .tut_inventory.*expected WRONGLY with endedBySkip readable [^\n]*read.keys: length 2 != 3.*expected WRONGLY with an old save resuming at the second lesson [^\n]*state.current: .tut_camera. != .tut_movement.*expected WRONGLY with a new game saved before start reporting a block [^\n]*result: expected a object, got a null.*WRONGLY undriven, a step no row takes [^\n]*not driven: a tutorial progress step this runner does not know: completeById.*tutorial-progress-wrong[.]json [^\n]*1 case[(]s[)] undriven.*saves-tutorial-progress: 5 case[(]s[)], driven 4 [(]tutorial 3, onboarding 1[)], 1 undriven, 7 failed.*title_corpus: FAIL")

# corebridge_sha256: the SHA-256 the C host gives core's save envelope
# (corebridge/src/insimulcore_sha256.c), against the NIST vectors, at every
# split point. Compiled straight from the source: the function is internal to
# libinsimulcore and deliberately not exported.
add_executable(insimulcore_sha256_test tests/corebridge_sha256.c corebridge/src/insimulcore_sha256.c)
target_include_directories(insimulcore_sha256_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/src)
add_test(NAME corebridge_sha256 COMMAND insimulcore_sha256_test)

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

# attribution: the PRE-OPEN LICENSING + POLICY gate (US-3, tasklist
# 242-pre-open-native). The two checklist items the content/dependency audit does
# not answer — Apache-2.0 LICENSE + a NOTICE carrying every third-party
# attribution (Trealla included, resolved from its own license text rather than
# from a classifier), CONTRIBUTING with the CLA/DCO decision MADE, and the
# trademark/conformance policy LINKED from the contract repo rather than forked
# into a divergent copy here. They read like paperwork, which is exactly why they
# are a gate: a NOTICE is only true on the day it is written unless something
# keeps it true, and the things that falsify it — a re-vendor, a lock bump, a
# tasklist marking an irreversible step done — all look like ordinary commits.
# Each NOTICE stanza's pin is checked against the ONE location the BUILD reads
# that pin from. run_attribution.sh falsifies the gate rule by rule first, then
# audits this tree, then injects five real violations into a copy of it and fails
# if the gate does not name every one. Needs node; degrades to a loud [SKIP]
# without it (read the output).
add_test(NAME attribution COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_attribution.sh
       ${CMAKE_CURRENT_SOURCE_DIR})
