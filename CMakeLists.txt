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

# prolog_mirror_digest (PL.native-prolog-mirror-full, U120(9)): the vendored
# corpus's BYTES, which no leg grades (a stale pack-agreement.json whose answers
# had not changed stayed green on all three, self-sweep M22). It holds
# conformance/prolog/ to conformance/PROLOG_MIRROR.json — the sha256 of core's
# bytes at corebridge/core-pin.json's coreCommit for every mirrored file, and every
# core file not mirrored (none since slice 5) — and refuses an extra, missing,
# renamed or changed file, a record taken at another commit than the pin, and any
# name listed as not mirrored (the mirror holds all of core's files). With a git checkout of
# @insimul/core (INSIMUL_CORE_DIR, else by default the monorepo's sibling core when
# it holds the pin's commit; the script resolves it) it also holds the record itself
# to core's git objects at the pin. Plain cmake -P: no node, no skip. Its negative
# control perturbs a copy seven ways (nine with a core checkout) and passes only when
# every perturbation is refused for its own named reason.
set(INSIMUL_PROLOG_MIRROR_ARGS
  -DMIRROR_DIR=${CMAKE_CURRENT_SOURCE_DIR}/conformance/prolog
  -DMANIFEST=${CMAKE_CURRENT_SOURCE_DIR}/conformance/PROLOG_MIRROR.json
  -DPIN=${CMAKE_CURRENT_SOURCE_DIR}/corebridge/core-pin.json
  -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/prolog-mirror-digest)
#
# The tests also look for the monorepo's sibling core here, at configure time and
# independently of the script (slice 3, settling slice 2's m1): when a sibling that
# holds the pin's commit is present, the script must find it by default, so the
# digest must say it held the record to core's git objects and the negative must
# refuse all 9 perturbations. Without that, a script that lost its default lookup
# would fall back to manifest-only and 7 of 7 and stay green. Re-run cmake if the
# sibling goes away (the script then says so, from -DEXPECT_SIBLING); the pin is a
# configure dependency, so a pin move re-checks.
set(INSIMUL_PROLOG_MIRROR_SIBLING "")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/core-pin.json)
file(READ ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/core-pin.json _insimul_pin_json)
string(JSON _insimul_pin ERROR_VARIABLE _insimul_pin_err GET "${_insimul_pin_json}" coreCommit)
if(_insimul_pin_err)
  set(_insimul_pin "")
endif()
# The lookup and its candidate list are the script's own, from one shared file
# (slice 4, settling slice 3's m1): a location added there is required here too.
include(${CMAKE_CURRENT_SOURCE_DIR}/tests/prolog_mirror_sibling.cmake)
insimul_prolog_mirror_sibling(${CMAKE_CURRENT_SOURCE_DIR} "${_insimul_pin}"
  _insimul_sibling _insimul_sibling_holds)
if(_insimul_sibling AND _insimul_sibling_holds)
  set(INSIMUL_PROLOG_MIRROR_SIBLING "${_insimul_sibling}")
endif()
if(INSIMUL_PROLOG_MIRROR_SIBLING)
  message(STATUS "prolog_mirror_digest: the sibling core ${INSIMUL_PROLOG_MIRROR_SIBLING} holds the pin; the digest pair must use it (9 of 9)")
  set(_insimul_digest_against "core's git objects at [0-9a-f]+ in [^\n]* [(]from (the monorepo's sibling core|INSIMUL_CORE_DIR)[)]")
  set(_insimul_negative_count "9 of 9")
  set(_insimul_expect_sibling -DEXPECT_SIBLING=${INSIMUL_PROLOG_MIRROR_SIBLING})
else()
  set(_insimul_expect_sibling "")
  set(_insimul_digest_against "[^\n]*")
  set(_insimul_negative_count "[79] of [79]")
endif()
add_test(NAME prolog_mirror_digest COMMAND ${CMAKE_COMMAND} ${INSIMUL_PROLOG_MIRROR_ARGS}
  ${_insimul_expect_sibling} -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/prolog_mirror_digest.cmake)
set_tests_properties(prolog_mirror_digest PROPERTIES
  PASS_REGULAR_EXPRESSION "prolog_mirror_digest: [1-9][0-9]* mirrored file[(]s[)] [^\n]*, held to ${_insimul_digest_against}\nprolog_mirror_digest: PASS")
add_test(NAME prolog_mirror_digest_negative COMMAND ${CMAKE_COMMAND} ${INSIMUL_PROLOG_MIRROR_ARGS}
  ${_insimul_expect_sibling} -DMODE=negative -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/prolog_mirror_digest.cmake)
set_tests_properties(prolog_mirror_digest_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "prolog_mirror_digest --negative: ${_insimul_negative_count} perturbation[(]s[)] refused for their named reason\nprolog_mirror_digest --negative: PASS")
# An empty -DCORE_DIR= turns the record checks off; the PASS line must say so rather
# than blame a missing sibling (slice 3, settling slice 2's m2).
add_test(NAME prolog_mirror_digest_optout COMMAND ${CMAKE_COMMAND} ${INSIMUL_PROLOG_MIRROR_ARGS}
  -DCORE_DIR= -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/prolog_mirror_digest.cmake)
set_tests_properties(prolog_mirror_digest_optout PROPERTIES
  PASS_REGULAR_EXPRESSION "held to the manifest as recorded [(]the record checks against core's git objects were turned off by an empty -DCORE_DIR=[)]\nprolog_mirror_digest: PASS")

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
# core_vendor also holds save.rules' extensionKeys (PL.native-save-extension-keys,
# U110): every save.rules case under corebridge/tests/cases/ must state exactly the
# sorted keys of the vendored bundle's extensionRegistry (22 at core 45409ed, as at d88b6f0 and 6cd4b4e), so a
# core pin that registers a new extension is red until the cases change on purpose.
# Its negative control runs that check alone over tests/save-extension-keys-negative/
# (a dropped key, a reordered list, an unregistered key, a list loosened to any array,
# a dropped key inside $subset) and passes only when all five are named and the run
# fails — not on any non-zero exit. The [SKIP] alternative is node's absence, as above.
add_test(NAME core_vendor_extension_keys_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-extension-keys ${CMAKE_CURRENT_SOURCE_DIR}/tests/save-extension-keys-negative)
set_tests_properties(core_vendor_extension_keys_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "extensionKeys drift \\(5 problem\\(s\\)\\)[^\n]*\n[^\n]*case 1 [^\n]*missing from the case: strategy\n[^\n]*case 2 [^\n]*not in sorted order\n[^\n]*case 3 [^\n]*not registered: questLog\n[^\n]*case 4 [^\n]*not the literal list of names\n[^\n]*case 5 [^\n]*missing from the case: puzzle\n|\\[SKIP\\] core_vendor_extension_keys_negative")

# Its sibling for the language transcriptions (PL.native-language-rows): the guard that
# holds cases/core-language-*.json to the vendored corpora (by name, by the calls core's
# runner makes, row for row, and with every answer stated) is given twenty perturbations of
# those files in memory (a dropped case, a dropped call, a first call changed, an answer
# expected nowhere, a call that is no language row; slice 2: an answer weakened to a subset,
# an NPC's mode at one band dropped; slice 3: an identification answer dropped, an examine
# weakened to a subset, a collection run's first call changed, a knowledge world's collected
# words expected nowhere, a listening chat dropped, a listening chat's quests not expected,
# a submitted composition weakened; slice 4: a quest feedback run's locks dropped, a lifecycle
# sync's pronunciation objectives expected nowhere, a run's recent ids not expected, a quest
# type table's categories not expected, a template's parameters not expected, every world's
# quest types weakened) and passes only when all twenty are named.
add_test(NAME core_vendor_language_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-language-transcription-negative)
set_tests_properties(core_vendor_language_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "language transcription negative [^ ]* 20 of 20 perturbed transcription[(]s[)] named|\\[SKIP\\] core_vendor_language_negative")

# And for the genre systems transcriptions (PL.native-genre-rows slice 1, the puzzle): the guard
# that holds cases/core-genre-puzzle-*.json to the vendored conformance/puzzle/ corpora (by name,
# by the calls core's runner makes in order, C-only exactly where a case reaches the KB, and
# with every answer stated) is given nine perturbations in memory (a dropped case, a case no
# corpus case names, a run's answer dropped, a read's first call changed, a riddle's choices
# dropped, an answer key expected nowhere, an unlock outcome weakened to a subset, a restored
# run's states expected nowhere, a KB run put on both legs); slice 2 (the platformer) adds
# cases/core-genre-platformer-*.json and eight more (a step call dropped, a step's movement
# weakened, its probed links changed, its outcome weakened to a subset, its host orders stated
# non-empty, two runs' stars swapped, a course case put on the C leg only, a restored run put on
# both legs); slice 3 (the strategy game) adds cases/core-genre-strategy-*.json and ten more (a
# run's endTurn call dropped, a turn report's orders stated empty, a turn report weakened to a
# subset, a victory answer flipped, a stockpile and a controls answer stated under another key,
# two businesses' prices swapped, a controlled call asked for another faction, a campaign case
# put on the C leg only, a restored run put on both legs); slice 4 (the genre pieces) adds
# cases/core-genre-genre-pieces-{kinds,build-plan}.json and seven more (a key call asked without
# its variant, a binding walk weakened to a subset, a pieces case put on the C leg only, a
# build-plan fixture named at another path, a write's ground call dropped, a settle offset stated
# under another key, a written world's ground stated empty). It passes only when all thirty-four
# are named.
add_test(NAME core_vendor_genre_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-genre-transcription-negative)
set_tests_properties(core_vendor_genre_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "genre transcription negative [^ ]* 34 of 34 perturbed transcription[(]s[)] named|\\[SKIP\\] core_vendor_genre_negative")

# And for the pass-by transcription (PL.native-pass-by-rows): the guard that holds
# cases/core-villagers-pass-by.json to the vendored conformance/villagers/pass-by.json (one
# case per corpus case by name, one call of its op's row with the case's whole input and
# answer, on both legs, and the contract case holding passBy.contract to the corpus's
# constants, side frames and measured window) is given ten perturbations in memory (a
# dropped case, a case no corpus case names, a call changed, an argument dropped, an answer
# weakened to a subset, an answer number changed, a refusal reason changed, a case put on one
# leg, a contract constant dropped, the side frames weakened) and passes only when all ten
# are named.
add_test(NAME core_vendor_pass_by_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-pass-by-transcription-negative)
set_tests_properties(core_vendor_pass_by_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "pass-by transcription negative [^ ]* 10 of 10 perturbed transcription[(]s[)] named|\\[SKIP\\] core_vendor_pass_by_negative")
# PL.native-vehicle-rows: the same for the world-vehicle parking transcription. The guard holding
# cases/core-props-vehicle-placement.json to the vendored conformance/props/vehicle-placement.json
# (one case per corpus case by name, one call of its op's row with the case's whole input and
# answer, on both legs, and the contract case holding props.vehicle.contract to the corpus's
# constants, refusals, tiers and deviations) is given thirteen perturbations in memory (a dropped
# case, a case no corpus case names, a call changed, an argument dropped, an answer weakened to a
# subset, an answer number changed, a refusal code changed, a case put on one leg, a contract
# constant dropped, the deviations weakened, a tier reworded, a declared library-version answer outside the
# corpus's tolerance, a declaration whose V8 answer is not the corpus's) and passes only when all thirteen are named.
add_test(NAME core_vendor_vehicle_placement_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-vehicle-placement-transcription-negative)
set_tests_properties(core_vendor_vehicle_placement_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "vehicle-placement transcription negative [^ ]* 13 of 13 perturbed transcription[(]s[)] named|\\[SKIP\\] core_vendor_vehicle_placement_negative")
# The HUD transcriptions' guard (PL.native-hud-rows: cases/core-ui-{notifications,compass,minimap}.json
# carrying every case of the vendored conformance/ui/{notifications,compass,minimap}-cases.json by name,
# each the calls core's runner makes through the rows with every answer stated, and each contract case
# holding its contract row to the keys it states; derived independently of the emitter) is given seventeen
# perturbations in memory (a dropped case, a case no corpus case names, a call changed, an argument
# dropped, a refusal's message no longer held, an answer number changed, a minimap view weakened to a
# subset, a placed list dropped, a toast op dropped, a history clock dropped, history ids weakened to a
# type, a case put on one leg, a contract key dropped, a contract value changed, a declared library-version
# answer moved past the tolerance, a declaration's V8 answer not the corpus's, a declaration on a minimap
# case) and passes only when all seventeen are named.
add_test(NAME core_vendor_hud_negative COMMAND
  bash ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_core_vendor.sh
       ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tools/vendor-core-bundle.mjs
       --check-hud-transcription-negative)
set_tests_properties(core_vendor_hud_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "HUD transcription negative [^ ]* 17 of 17 perturbed transcription[(]s[)] named|\\[SKIP\\] core_vendor_hud_negative")

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

# prolog_engine_cases (PL.native-consult-floor-leak): corebridge/js/host-prolog-engine.js,
# the adapter behind core's PrologEngine seam, replayed over the cases and the seeded
# differential in corebridge/tests/prolog-engine/ inside a REAL libinsimulcore runtime
# (real __insimul_prolog_* globals, real native engine). Every step is compared with
# the same file's rebuild-only oracle; `cost` pins that a fact write in a held KB
# creates no KB and consults only its own text, and `kbSlots` that the bridge's KB
# table reuses its holes. Uses corebridge/src/insimulcore_testing.h (test-only).
# A case file during which the library wrote anything to stdout fails
# (tests/stdout_guard.h; frame-bindings.json is PL.native-kb-instantiation-error's).
file(GLOB INSIMUL_PROLOG_ENGINE_CASES CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tests/prolog-engine/*.json")
if(NOT INSIMUL_PROLOG_ENGINE_CASES)
  message(FATAL_ERROR "no corebridge/tests/prolog-engine/*.json — prolog_engine_cases would run nothing")
endif()
add_executable(insimulcore_prolog_engine tests/prolog_engine_cases.c)
target_include_directories(insimulcore_prolog_engine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/src
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/quickjs)
target_link_libraries(insimulcore_prolog_engine PRIVATE insimulcore m)
add_test(NAME prolog_engine_cases COMMAND insimulcore_prolog_engine
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/js/host-prolog-engine.js
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/tests/prolog-engine/driver.js
  ${INSIMUL_PROLOG_ENGINE_CASES})

# kb_floor (PL.native-consult-floor-leak): libinsimul's per-KB floor, as data —
# tests/kb-floor/cases.json states, per case, N create/consult[/query]/destroy cycles
# (or N ops on one held KB) and the heap bytes per cycle they may leave behind,
# measured after a warm-up that opens the deliberate L-01 engine keepalive outside
# the window. Its DECLARED cases are the engine's (upstream): the process-wide atom
# table, and the reader's reference-counted cells for quoted atoms of 15+ characters
# and double-quoted strings, each stated per unit with a floor, so a declaration goes
# red when it stops being true.
# Registered only where the allocator reports bytes in use (macOS, glibc ≥ 2.33).
include(CheckSymbolExists)
check_symbol_exists(mallinfo2 "malloc.h" INSIMUL_HAVE_MALLINFO2)
if(APPLE OR INSIMUL_HAVE_MALLINFO2)
  add_executable(insimul_kb_floor tests/kb_floor.cpp tests/radiant/json_value.cpp)
  target_include_directories(insimul_kb_floor PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
  target_link_libraries(insimul_kb_floor PRIVATE insimul)
  add_test(NAME kb_floor COMMAND insimul_kb_floor ${CMAKE_CURRENT_SOURCE_DIR}/tests/kb-floor/cases.json)
else()
  message(WARNING "kb_floor is not registered: this allocator reports no bytes in use (needs macOS or glibc's mallinfo2)")
endif()

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
# (one apply per run step), and every indicator case (a bare indicator, no
# session's) through the `saves.indicator.*` rows over core's
# ui/save-indicator-model (PL.native-indicator-row, U132(1)) twice — one
# show/tick then view call per step, and the whole case as one
# saves.indicator.apply — and compares by the corpus's rule
# (tests/saves_slots_corpus.cpp). All 156 cases at 45409ed are driven, 15 of
# them indicator cases. It fails when a row is missing, when any case cannot be
# driven, when a declared op goes undriven, when a session is left open, and
# when its comparator cannot fail. A pure consumer of insimulcore.h; the JSON
# reader is tests/radiant/json_value.cpp, used unchanged. Never skips: the
# corpus is in-repo.
add_executable(insimulcore_saves_slots tests/saves_slots_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_saves_slots PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_saves_slots PRIVATE insimulcore)
add_test(NAME saves_slots_corpus COMMAND insimulcore_saves_slots
  ${CMAKE_CURRENT_SOURCE_DIR}/corebridge/vendor/core/conformance/saves/slots.json)
# The negative control: the same runner over four deliberately wrong cases
# (tests/saves-negative/): one config, one run, one indicator case (seen wrong on
# both legs, the per-step rows and the batch) and one indicator case no row can
# drive. It passes only when the runner reports the first three as differing,
# the fourth as undriven, and the run as failed.
add_test(NAME saves_slots_corpus_negative COMMAND insimulcore_saves_slots
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/saves-negative/slots-wrong.json)
set_tests_properties(saves_slots_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "expected WRONGLY to resolve no config to four slots [^\n]*slotCount: 4 != 3.*expected WRONGLY to delete an empty slot [^\n]*unexpected key 'refusal'.*expected WRONGLY to hold [^\n]*show/tick/view: [^\n]*views.1.[.]opacity: 1 != 0[.]75.*expected WRONGLY to hold [^\n]*saves[.]indicator[.]apply: [^\n]*views.1.[.]opacity: 1 != 0[.]75.*WRONGLY undrivable[^\n]*not driven: an indicator step this runner does not know.*1 undriven, 7 failed.*saves_slots_corpus: FAIL")

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
# PL.native-bundle-core-r2 (U124, U126): the file's `press` op (core's
# PL.core-interact-pick-precedence: one E press, one object) is driven through
# props.interactables.target, .examinePick and .press, as core's runPress composes
# them, and the stands that state no y are counted against the rows' own contract
# (props.interactables.contract's standWithoutY). The regex demands every op driven,
# 0 undriven, that count and PASS.
set_tests_properties(props_interactables_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "props-interactables: [^\n]*driven noun [1-9][0-9]*, meanings [1-9][0-9]*, host [1-9][0-9]*, interact [1-9][0-9]*, target [1-9][0-9]*, press [1-9][0-9]*. 0 undriven\n  stands with no y: [1-9][0-9]*, sent as given [^\n]*\nprops_corpus: [0-9]+ case[(]s[)] driven through the rows, 0 failed[^\n]*\nprops_corpus: PASS")
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
# states one `prop` alone; and three more (PL.native-bundle-core-r2: core's
# PL.core-interact-pick-precedence and U126): a stand that states no y expected as
# if it stood on floor 0 (a binding that fills in y 0), a press where the 5 m
# examine pick acts over the 2.6 m target, and a press whose stand's own objects a
# runner dropped. It passes only when the runner reports each of them and the run
# as failed, in that order.
add_test(NAME props_interactables_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/interactables-wrong.json)
set_tests_properties(props_interactables_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.rangesM.talk: 3 != 3.5.*expected WRONGLY the board's host sign read as a sign.*expected WRONGLY a fence offered.*expected WRONGLY the nearer barrel examined before the pick-up.*expected WRONGLY the last listed prop on a tie.*expected WRONGLY a second full stop.*expected WRONGLY nothing in reach where the host's own ranges reach the crate.*expected WRONGLY no result for a lone prop.*expected WRONGLY the exit for a stand that states no y.*expected WRONGLY the examine pick acting over the interactables target.*expected WRONGLY no pick where a stand's own objects hold one.*op noun of area props-interactables: no case of it was driven.*props_corpus: FAIL")

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

# PL.native-step-clock-row (U122(1), U128): core's step clock (P5.core's
# stepFootsteps, src/audio/footsteps.ts) through the stateless audio.stepFootsteps
# row, by the same runner, over core's audio cue corpus conformance/audio/cues.json
# (copied byte for byte with ground.json): every footstepRun case one row call per
# step from audio.footsteps.contract's initialState, the state the last answer
# carried sent back each time; every footstep case one call from that state with
# a frame of the longest gait interval (the step less its foot is footstepCue's
# cue; no step must reset the clock); the contract's footsteps data held to
# audio.footsteps.contract. The file's ambient and music cases reach no row here:
# the regex demands they are reported as not reached, and 0 undriven of the two
# footstep ops. Unreal's P5 StepFootsteps (Portable/InsimulAudioCues) is the
# interim copy this row retires. The regex holds no ';' except the runner's own.
add_test(NAME audio_cues_corpus COMMAND insimulcore_props_corpus ${INSIMUL_PROPS_CORPUS}/audio/cues.json)
set_tests_properties(audio_cues_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "contract: 1 table[(]s[)] are audio.footsteps.contract's\n.*audio-cues: [0-9]+ case[(]s[)], driven footstep [1-9][0-9]*, footstepRun [1-9][0-9]*. 0 undriven\n  not reached: [1-9][0-9]* case[(]s[)] of ops no row here runs [(]ambient [0-9]+, ambientIssues [0-9]+, ambientRun [0-9]+, music [0-9]+, musicRun [0-9]+[)], neither passed nor failed\n.*props_corpus: PASS")
# Its negative control (tests/props-negative/cues-wrong.json, made from the
# vendored file): the run gait's interval moved in the contract, seven footstep
# cases given the answer a wrong step clock would give (Godot's template dropping
# the remainder at a step, a long frame not folded, standing keeping the clock, a
# negative frame moving it back, the right foot first, an unknown surface marked
# table, idle stepping) and a case of an op no row runs that is not on the
# unreached list. It passes only when the runner reports each of them and the run
# as failed, in the file's order (the footstep cases come before the runs). No two
# wildcards stand side by side in the regex.
add_test(NAME audio_cues_corpus_negative COMMAND insimulcore_props_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/cues-wrong.json)
set_tests_properties(audio_cues_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "contract.footsteps.gaits.run.intervalSec: 0.3 != 0.28.*expected WRONGLY an unknown surface marked table [^\n]*source: .table. != .default.*expected WRONGLY idle stepping [^\n]*cue: expected a object, got a null.*expected WRONGLY the remainder dropped at a step [^\n]*ticks.3..elapsedSec: 0 != 0.09.*expected WRONGLY the right foot first [^\n]*foot: .right. != .left.*expected WRONGLY standing keeping the clock [^\n]*ticks.3..elapsedSec: 0.375 != 0.*expected WRONGLY a long frame not folded below one interval [^\n]*ticks.0..elapsedSec: 0.6 != 0.19.*expected WRONGLY a negative frame moving the clock back [^\n]*ticks.2..elapsedSec: -0.75 != 0.25.*expected WRONGLY an op of no row taken as unreached [^\n]*op .footstepBurst. is not one of area audio-cues.s.*props_corpus: FAIL")

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

# traversal_corpus (PL.native-traversal-rows, rulings U106(1), U107 and U36):
# core's P9e traversal (P9e.core) as libinsimulcore's `traversal.*` rows, held to
# core's own eight corpora, COPIED byte for byte into
# corebridge/vendor/core/conformance/traversal/ at the pin
# (vendor-core-bundle.mjs TRAVERSAL_CORPUS_FILES; hashed, and byte-compared under
# --check --core). Slice 1, the stateless kernels (src/traversal/traversal.ts and
# its graph facts, vehicles.ts and vehicle-facts.ts, fast-travel.ts and
# fast-travel-facts.ts, src/ground-seating/ground-seat.ts): affordances.json,
# vehicles.json and fast-travel.json compose each case's record from one row per
# core function, as core's corpus test composes it from core's functions, and drive
# it again with its lists reversed (core's order guard); ground-seating.json sends
# each case's input to its op's row, a settle one row per step. Slice 2, the
# stateful layers: session.json runs each case in one traversal.session (core's
# TraversalPlanner, VehicleRegistry and FastTravelDirector wired together with a
# StaminaPool and the personal vehicles), each step composed from the session's ops;
# mounts.json through the traversal.personal.* rows (src/traversal/personal-vehicles.ts);
# save.json through traversal.save.* (src/traversal/traversal-save.ts) and a
# session's load; vehicles-only.json (PL.native-vehicle-rows, core's
# PL.core-vehicle-rules) in one session created with runsTraversal false (a game
# that runs the vehicles pack without traversal: no planner, no block written or
# read, loadVehicleLayers(registry, null) on a load). Unreal's Portable/InsimulTraversal is the interim copy these rows
# retire (P9e.unreal.retire-traversal-copy). The regex demands each file's driven
# line with every part driven and 0 undriven, in file order, and holds no ';'
# outside it; the runner also fails a header step no case drives.
add_executable(insimulcore_traversal_corpus tests/traversal_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_traversal_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_traversal_corpus PRIVATE insimulcore)
set(INSIMUL_TRAVERSAL_CORPORA ${INSIMUL_PROPS_CORPUS}/traversal/affordances.json ${INSIMUL_PROPS_CORPUS}/traversal/vehicles.json
  ${INSIMUL_PROPS_CORPUS}/traversal/fast-travel.json ${INSIMUL_PROPS_CORPUS}/traversal/ground-seating.json
  ${INSIMUL_PROPS_CORPUS}/traversal/session.json ${INSIMUL_PROPS_CORPUS}/traversal/mounts.json
  ${INSIMUL_PROPS_CORPUS}/traversal/save.json ${INSIMUL_PROPS_CORPUS}/traversal/vehicles-only.json)
add_test(NAME traversal_corpus COMMAND insimulcore_traversal_corpus ${INSIMUL_TRAVERSAL_CORPORA})
set_tests_properties(traversal_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "traversal-affordances: [0-9]+ case[(]s[)], driven resolve [1-9][0-9]*, best [1-9][0-9]*, route [1-9][0-9]*, graphFacts [1-9][0-9]*, order [1-9][0-9]*. 0 undriven\n.*traversal-vehicles: [0-9]+ case[(]s[)], driven resolve [1-9][0-9]*, apply [1-9][0-9]*, actions [1-9][0-9]*, seats [1-9][0-9]*, modeFact [1-9][0-9]*, stateFacts [1-9][0-9]*, stateDelta [1-9][0-9]*, anothers [1-9][0-9]*, order [1-9][0-9]*. 0 undriven\n.*traversal-fast-travel: [0-9]+ case[(]s[)], driven route [1-9][0-9]*, plan [1-9][0-9]*, ceiling [1-9][0-9]*, hours [1-9][0-9]*, arrival [1-9][0-9]*, discovery [1-9][0-9]*, order [1-9][0-9]*. 0 undriven\n.*traversal/ground-seating: [0-9]+ case[(]s[)], driven tuning [1-9][0-9]*, footprint [1-9][0-9]*, ground [1-9][0-9]*, target [1-9][0-9]*, stand [1-9][0-9]*, moved [1-9][0-9]*, settle [1-9][0-9]*. 0 undriven\n.*traversal/session: [0-9]+ case[(]s[)], driven run [1-9][0-9]*. 0 undriven\n.*traversal/mounts: [0-9]+ case[(]s[)], driven tuning [1-9][0-9]*, pace [1-9][0-9]*, modes [1-9][0-9]*, run [1-9][0-9]*. 0 undriven\n.*traversal/save: [0-9]+ case[(]s[)], driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*traversal/vehicles-only: [0-9]+ case[(]s[)], driven run [1-9][0-9]*. 0 undriven\n.*traversal_corpus: PASS")
# Its negative pass, as Unreal's traversal_corpus_negative: every case's expectation
# perturbed (its last leaf) must be refused, each file's count and the total stated;
# the runner prints PASS only when every case of every file was refused (refused ==
# cases, none accepted, no case undriven).
add_test(NAME traversal_corpus_negative COMMAND insimulcore_traversal_corpus --negative ${INSIMUL_TRAVERSAL_CORPORA})
set_tests_properties(traversal_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*traversal_corpus --negative: [1-9][0-9]* of [0-9]+ perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)].*traversal_corpus --negative: PASS")

# build_corpus (PL.native-headless-build, rulings U106(1), U107 and U36): core's
# P10 headless build contract (P10.core: src/build/headless-build.ts) as
# libinsimulcore's `build.*` rows, held to core's own corpus
# conformance/build/headless.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/headless-build/ at the pin (vendor-core-bundle.mjs
# BUILD_CORPUS_FROM: one folder over from core's build/, which every build/ rule here
# reads as build output; hashed, and byte-compared under --check --core).
# tests/build_corpus.cpp expands the file's credential markers as core's runner does
# and drives EVERY case through build.plan, .checkResult, .checkProgress or .size,
# holds build.contract to the file's contract, checks that no answer repeats a
# credential in a detail or a line, and asks the fold rows about every out-dir refusal
# and every accepted plan. Unreal's Portable/InsimulHeadlessBuild is the interim copy
# these rows retire (P10.unreal.retire-headless-build-copy). The regex demands every
# op driven, 0 undriven, the contract line, hidden credentials, a case only the macOS
# fold catches and one only the Windows fold catches, and PASS.
add_executable(insimulcore_build_corpus tests/build_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_build_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_build_corpus PRIVATE insimulcore)
set(INSIMUL_BUILD_CORPUS ${INSIMUL_PROPS_CORPUS}/headless-build/headless.json)
add_test(NAME build_corpus COMMAND insimulcore_build_corpus ${INSIMUL_BUILD_CORPUS})
set_tests_properties(build_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "contract: build.contract states the file's [1-9][0-9]* table[(]s[)][^\n]*\n.*headless-build: [0-9]+ case[(]s[)], driven plan [1-9][0-9]*, checkResult [1-9][0-9]*, checkProgress [1-9][0-9]*, size [1-9][0-9]*. 0 undriven\n.*credentials: [1-9][0-9]* case[(]s[)] carry one, none repeated in a detail or a line, [1-9][0-9]* line[(]s[)] hidden\n.*folds: holds-inputs [0-9]+ [(]macOS only [1-9][0-9]*, Windows only [1-9][0-9]*, both [0-9]+[)], reserved [1-9][0-9]* [(][^)]*[)], [1-9][0-9]* accepted plan[(]s[)] clear of both\n.*build_corpus: PASS")
# Its negative pass, as Unreal's headless_build_corpus_negative: every case's
# expectation perturbed (its last leaf) must be refused, and the purposeful
# perturbations too — a credential not caught, a credential shown (as an expectation
# and planted in an answer), a path escaping the build folder (by the fold that
# catches it: at least one macOS-only and one Windows-only), an artefact outside it
# and a path outside the project. PASS only when every case was refused and none
# accepted.
add_test(NAME build_corpus_negative COMMAND insimulcore_build_corpus --negative ${INSIMUL_BUILD_CORPUS})
set_tests_properties(build_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*targeted: credential not caught [1-9][0-9]*/[0-9]+, credential shown [1-9][0-9]*/[0-9]+, credential shown [(]planted[)] [1-9][0-9]*/[0-9]+, escape under a fold [1-9][0-9]*/[0-9]+, artefact outside outDir [1-9][0-9]*/[0-9]+, path outside project [1-9][0-9]*/[0-9]+ refused\n.*escapes refused by fold: macOS only [1-9][0-9]*, Windows only [1-9][0-9]*, both [0-9]+\n.*build_corpus --negative: [1-9][0-9]* of [0-9]+ perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)].*build_corpus --negative: PASS")


# progression_corpus (PL.native-progression-rows, rulings U106(7) and U36): core's P9i
# progression (P9i.core: src/progression/gamification.ts, feature-modules.ts and
# progression-save.ts) and core's skill trees (src/skills/ and
# game-engine/logic/SkillProgression.ts) as libinsimulcore's `progression.*` and
# `skill.*` rows, held to core's own corpora, COPIED byte for byte into
# corebridge/vendor/core/conformance/{progression,skills,prolog}/ at the pin
# (vendor-core-bundle.mjs PROGRESSION_CORPUS_FILES; hashed, and byte-compared under
# --check --core). tests/progression_corpus.cpp composes each case's record from one
# row per core function, as core's runner (progression/systems-corpus.ts) and core's
# skills corpus test compose it from core's functions; the gamification `run` op one
# progression.gamification.step per step. prolog/mechanic-skill.json's can_unlock/2
# cases are replayed through a KB-backed skill.unlock (the case's KB behind a
# skill.create session; the node's goals answered by core's skill_goal_met/2 there),
# and every node the KB opens is asked again with no KB and must stay locked
# (U106(7)). Unreal's interim P9i copy is what these rows retire. The regex demands
# the refusal probes' line, each file's driven line with every op driven and 0
# undriven, in file order, the run's step line, the skills kb op's step line (core's
# PL.core-skill-kb-live-facts: skill.kb.* rows) and the no-KB control, then PASS. It
# holds no ';': CMake reads one as a list separator, and a PASS_REGULAR_EXPRESSION
# list passes when ANY of its parts matches (a regex split that way passed a red run).
add_executable(insimulcore_progression_corpus tests/progression_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_progression_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_progression_corpus PRIVATE insimulcore)
set(INSIMUL_PROGRESSION_CORPORA ${INSIMUL_PROPS_CORPUS}/progression/gamification.json
  ${INSIMUL_PROPS_CORPUS}/progression/modules.json ${INSIMUL_PROPS_CORPUS}/progression/skills.json
  ${INSIMUL_PROPS_CORPUS}/progression/save.json ${INSIMUL_PROPS_CORPUS}/skills/advancement.json
  ${INSIMUL_PROPS_CORPUS}/skills/unlocks.json ${INSIMUL_PROPS_CORPUS}/skills/effects.json
  ${INSIMUL_PROPS_CORPUS}/skills/trees.json ${INSIMUL_PROPS_CORPUS}/skills/effect-terms.json
  ${INSIMUL_PROPS_CORPUS}/prolog/mechanic-skill.json)
add_test(NAME progression_corpus COMMAND insimulcore_progression_corpus ${INSIMUL_PROGRESSION_CORPORA})
set_tests_properties(progression_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 10 of 10 unknown op[(]s[)], step[(]s[)], area[(]s[)] and row[(]s[)] refused\n.*progression/gamification: [^\n]*driven levels [1-9][0-9]*, table [1-9][0-9]*, achievements [1-9][0-9]*, daily [1-9][0-9]*, run [1-9][0-9]*. 0 undriven\n.*steps through progression.gamification.step: day [1-9][0-9]*,[^\n]* stats [1-9][0-9]*\n.*progression/modules: [^\n]*driven definitions [1-9][0-9]*, resolve [1-9][0-9]*, genre [1-9][0-9]*, proficiency [1-9][0-9]*, difficulty [1-9][0-9]*, performance [1-9][0-9]*, adjust [1-9][0-9]*, records [1-9][0-9]*. 0 undriven\n.*progression/skills: [^\n]*driven domain [1-9][0-9]*, restore [1-9][0-9]*, compose [1-9][0-9]*, kb [1-9][0-9]*. 0 undriven\n.*steps through the skill.kb.[*] rows: load [1-9][0-9]*, assert [1-9][0-9]*, retract [1-9][0-9]*, query [1-9][0-9]*, unlock [1-9][0-9]*, save [1-9][0-9]*\n.*progression/save: [^\n]*driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*skills-advancement: [^\n]*driven case [1-9][0-9]*. 0 undriven\n.*skills-unlocks: [^\n]*driven case [1-9][0-9]*. 0 undriven\n.*skills-effects: [^\n]*driven case [1-9][0-9]*. 0 undriven\n.*skills-trees: [^\n]*driven case [1-9][0-9]*. 0 undriven\n.*skills-effect-terms: [^\n]*driven case [1-9][0-9]*. 0 undriven\n.*mechanic-skill: [^\n]*driven can_unlock [1-9][0-9]* [^\n]*. 0 undriven\n.*no-KB control: [1-9][0-9]* node[(]s[)] the KB opened stay locked [(]requires[)] without it\n.*progression_corpus: PASS")
# Its negative pass: every driven case's expectation perturbed (its last leaf) must be
# refused, each file's count and the total stated; PASS only when every case of every
# file was refused and none accepted.
add_test(NAME progression_corpus_negative COMMAND insimulcore_progression_corpus --negative ${INSIMUL_PROGRESSION_CORPORA})
set_tests_properties(progression_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 10 of 10 unknown op[(]s[)], step[(]s[)], area[(]s[)] and row[(]s[)] refused\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*negative: [1-9][0-9]* of [0-9]+ perturbed expectation[(]s[)] refused, 0 accepted\n.*progression_corpus --negative: [1-9][0-9]* of [0-9]+ perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)].*progression_corpus --negative: PASS")

# village_save_corpus (PL.native-village-save-rows, rulings U118, U128, U49(3) and U36):
# core's village-state save (src/save-file-game-state.ts: P1.core, and the conversations
# projection of PL.core-save-conversations-projection) as libinsimulcore's
# `save.village.*` rows (and skill.kb.loadJson for the corpus's skillKb op), held to
# core's own corpus conformance/saves/village-state.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/saves/ at the pin (vendor-core-bundle.mjs
# SAVES_CORPUS_FILES; hashed, and byte-compared under --check --core).
# tests/village_save_corpus.cpp drives each op as core's reference runner
# (save-file-game-state-corpus.ts) composes it; the same cases also run on both legs as
# the transcribed cases/core-saves-village.json. Unreal's interim village-save and
# save-conversations copies are what these rows retire. The regex demands the refusal
# probes' line with every probe refused, the contract line with every stated key agreeing,
# the driven line with each of core's ten ops driven and 0 undriven, then PASS. It holds
# no ';' (CMake would split it into a list, and a list passes when ANY part matches).
add_executable(insimulcore_village_save_corpus tests/village_save_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_village_save_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_village_save_corpus PRIVATE insimulcore)
set(INSIMUL_VILLAGE_SAVE_CORPUS ${INSIMUL_PROPS_CORPUS}/saves/village-state.json)
add_test(NAME village_save_corpus COMMAND insimulcore_village_save_corpus ${INSIMUL_VILLAGE_SAVE_CORPUS})
set_tests_properties(village_save_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\n.*contract: 13 key[(]s[)] save.village.contract states agree with the corpus's[^\n]*\n.*village-state: driven write [1-9][0-9]*, read [1-9][0-9]*, roundTrip [1-9][0-9]*, stamp [1-9][0-9]*, agentCurie [1-9][0-9]*, timeStateOf [1-9][0-9]*, totalHoursOf [1-9][0-9]*, conversationTimestamp [1-9][0-9]*, conversationEpochMs [1-9][0-9]*, skillKb [1-9][0-9]*. 0 undriven\nvillage_save_corpus: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\nvillage_save_corpus: PASS")
# Its negative pass: every case's expectation perturbed (its last leaf) must be refused.
add_test(NAME village_save_corpus_negative COMMAND insimulcore_village_save_corpus --negative ${INSIMUL_VILLAGE_SAVE_CORPUS})
set_tests_properties(village_save_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\n.*village_save_corpus --negative: [1-9][0-9]* of [1-9][0-9]* perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)][^\n]*\nvillage_save_corpus --negative: PASS")

# language_corpus (PL.native-language-rows slices 1 to 4, rulings U128, U118, U107(2), U49(3)
# and U36): core's P9h language kernels (src/language-learning/: the book, the save block, the
# prompt selector with the registers it reads, hover and its word key, the chat metrics
# with the difficulty monitor its lines feed; src/prolog/player-language-state.ts; slice 2:
# the vocabulary bank and the learning profile, the rest of adaptation.ts, listen and repeat
# with src/language/phonetic-similarity.ts's code; slice 3: the rest of world-words.ts, knowledge
# collection, object identification, point and name, examine, and the rest of reading-writing.ts,
# composition and listening; slice 4: quest-feedback.ts, the real-time quest language feedback
# the quest lifecycle governs, and the language quest types of src/quest-types/ with
# src/language/quest-templates.ts) as libinsimulcore's `language.*` rows, held to core's own
# corpora conformance/language/{progress,save,prompts,hover,chat,bank,adaptation,pronunciation,
# collection,objects,writing,quest-feedback,quest-types}.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/language/ at the pin (vendor-core-bundle.mjs
# LANGUAGE_CORPUS_FILES; hashed, and byte-compared under --check --core).
# tests/language_corpus.cpp composes each op from the rows as core's reference runner
# (src/language-learning/systems-corpus.ts) composes core's kernels; the same cases also run
# on both legs as the transcribed cases/core-language-*.json. Unreal's interim language copy
# (Portable/InsimulLanguage*) is what these rows retire (P9h.unreal.retire-language-copy). The regex
# demands every refusal probe refused, each file's driven line with every op and step of
# core's runner driven and 0 undriven, every row it names called, then PASS. It holds no ';'.
add_executable(insimulcore_language_corpus tests/language_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_language_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_language_corpus PRIVATE insimulcore)
set(INSIMUL_LANGUAGE_CORPORA
  ${INSIMUL_PROPS_CORPUS}/language/progress.json
  ${INSIMUL_PROPS_CORPUS}/language/save.json
  ${INSIMUL_PROPS_CORPUS}/language/prompts.json
  ${INSIMUL_PROPS_CORPUS}/language/hover.json
  ${INSIMUL_PROPS_CORPUS}/language/chat.json
  ${INSIMUL_PROPS_CORPUS}/language/bank.json
  ${INSIMUL_PROPS_CORPUS}/language/adaptation.json
  ${INSIMUL_PROPS_CORPUS}/language/pronunciation.json
  ${INSIMUL_PROPS_CORPUS}/language/collection.json
  ${INSIMUL_PROPS_CORPUS}/language/objects.json
  ${INSIMUL_PROPS_CORPUS}/language/writing.json
  ${INSIMUL_PROPS_CORPUS}/language/quest-feedback.json
  ${INSIMUL_PROPS_CORPUS}/language/quest-types.json)
add_test(NAME language_corpus COMMAND insimulcore_language_corpus ${INSIMUL_LANGUAGE_CORPORA})
set_tests_properties(language_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 27 of 27 probe[(]s[)] refused as core refuses[^\n]*\n.*language/progress: driven mastery [1-9][0-9]*, gain [1-9][0-9]*, run [1-9][0-9]*, facts [1-9][0-9]*. 0 undriven. steps advance [1-9][0-9]*, encounter [1-9][0-9]*, event [1-9][0-9]*, grammar [1-9][0-9]*, conversation [1-9][0-9]*, cefr [1-9][0-9]*, weak [1-9][0-9]*, summary [1-9][0-9]*\n.*language/save: driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*language/prompts: driven run [1-9][0-9]*. 0 undriven. steps register [1-9][0-9]*, pick [1-9][0-9]*, standing [1-9][0-9]*, answer [1-9][0-9]*, reach [1-9][0-9]*, choose [1-9][0-9]*\n.*language/hover: driven tokens [1-9][0-9]*, run [1-9][0-9]*. 0 undriven. steps hints [1-9][0-9]*, see [1-9][0-9]*, mastery [1-9][0-9]*, lookup [1-9][0-9]*, resolve [1-9][0-9]*, likely [1-9][0-9]*, display [1-9][0-9]*\n.*language/chat: driven words [1-9][0-9]*, percent [1-9][0-9]*, hear [1-9][0-9]*, usages [1-9][0-9]*, run [1-9][0-9]*. 0 undriven. steps start [1-9][0-9]*, line [1-9][0-9]*, hear [1-9][0-9]*, end [1-9][0-9]*\n.*language/bank: driven cards [1-9][0-9]*, reveal [1-9][0-9]*, grammar [1-9][0-9]*, tables [1-9][0-9]*, profile [1-9][0-9]*, history [1-9][0-9]*. 0 undriven\n.*language/adaptation: driven struggle [1-9][0-9]*, difficulty [1-9][0-9]*, mode [1-9][0-9]*, npc [1-9][0-9]*, hint [1-9][0-9]*, quests [1-9][0-9]*, advance [1-9][0-9]*. 0 undriven. steps turn [1-9][0-9]*\n.*language/pronunciation: driven encode [1-9][0-9]*, similarity [1-9][0-9]*, score [1-9][0-9]*, repeat [1-9][0-9]*, xp [1-9][0-9]*, hints [1-9][0-9]*. 0 undriven\n.*language/collection: driven run [1-9][0-9]*. 0 undriven. steps register [1-9][0-9]*, seed [1-9][0-9]*, reach [1-9][0-9]*, quiz [1-9][0-9]*, answer [1-9][0-9]*\n.*language/objects: driven normalize [1-9][0-9]*, identify [1-9][0-9]*, naming [1-9][0-9]*, examine [1-9][0-9]*. 0 undriven. steps register [1-9][0-9]*, prompt [1-9][0-9]*, answer [1-9][0-9]*, remove [1-9][0-9]*, quest [1-9][0-9]*, register [1-9][0-9]*, point [1-9][0-9]*, name [1-9][0-9]*\n.*language/writing: driven composition [1-9][0-9]*, listening [1-9][0-9]*. 0 undriven. steps register [1-9][0-9]*, prompt [1-9][0-9]*, chat [1-9][0-9]*, grade [1-9][0-9]*\n.*language/quest-feedback: driven targets [1-9][0-9]*, run [1-9][0-9]*. 0 undriven. steps vocabulary [1-9][0-9]*, lifecycle [1-9][0-9]*, grammar [1-9][0-9]*, correct [1-9][0-9]*, pronunciation [1-9][0-9]*, hints [1-9][0-9]*, objective [1-9][0-9]*, done [1-9][0-9]*\n.*language/quest-types: driven select [1-9][0-9]*, table [1-9][0-9]*, complete [1-9][0-9]*, map [1-9][0-9]*, templates [1-9][0-9]*. 0 undriven\n.*rows: 114 of 114 called by the corpora's cases\nlanguage_corpus: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\nlanguage_corpus: PASS")
# Its negative pass: every case's expectation perturbed (its last leaf) must be refused.
add_test(NAME language_corpus_negative COMMAND insimulcore_language_corpus --negative ${INSIMUL_LANGUAGE_CORPORA})
set_tests_properties(language_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 27 of 27 probe[(]s[)] refused as core refuses[^\n]*\n.*rows: 114 of 114 called by the corpora's cases\nlanguage_corpus --negative: [1-9][0-9]* of [1-9][0-9]* perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)][^\n]*\nlanguage_corpus --negative: PASS")

# genre_systems_corpus (PL.native-genre-rows slice 1, the puzzle; rulings U128, U115, U49(3) and
# U36): core's P9j puzzle module (src/puzzle/puzzle.ts: the definition a world gives, authored or
# generated, its facts, the world facts its riddles are answered from, the answer key and the
# choices), its decision layer (src/game-engine/logic/PuzzleDirector.ts over a KB that module
# activation builds: GamePrologEngine with genre puzzle, on the native Trealla seam) and its save
# block (src/puzzle/puzzle-save.ts) as libinsimulcore's `puzzle.*` rows, with the corpora's world
# input (core's worldOf) as `genre.world.of`, held to core's own corpora
# conformance/puzzle/{definition,run,save}.json and the world slice they name,
# conformance/genre-mechanics/thistlecombe.world-slice.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/ at the pin (vendor-core-bundle.mjs
# GENRE_SYSTEMS_CORPUS_FILES; hashed, and byte-compared under --check --core).
# tests/genre_systems_corpus.cpp composes each op from the rows as core's reference runner
# (src/genre-systems/systems-corpus.ts, runGenreSystemsOp) composes core's functions; the same
# cases also run on both legs as the transcribed cases/core-genre-puzzle-*.json (the runs that
# reach the KB on the C leg only). Unreal's interim puzzle copy (Portable/InsimulPuzzle.{h,cpp}) is
# what these rows retire (P9j.unreal.retire-puzzle-copy). Slice 2 adds the platformer the same
# way: core's src/platformer/course.ts (the course a world gives, its route and its stars),
# src/game-engine/logic/PlatformerDirector.ts (over a KB that module activation builds:
# GamePrologEngine with genre platformer, which selects traversal; movement is core's
# TraversalPlanner inside the director, the host's probe stated as data) and
# src/platformer/platformer-save.ts as the `platformer.*` rows, held to
# conformance/platformer/{course,run,save}.json (transcribed as cases/core-genre-platformer-*.json);
# they retire Unreal's Portable/InsimulPlatformer.{h,cpp} (P9j.unreal.retire-platformer-copy).
# Slice 3 adds the strategy game the same way: core's src/strategy/strategy.ts (the campaign a
# world gives, a turn's books, a holding's price, control and neighbours),
# src/game-engine/logic/StrategyDirector.ts (over a KB that module activation builds:
# GamePrologEngine with genre strategy) and src/strategy/strategy-save.ts as the `strategy.*`
# rows, held to conformance/strategy/{campaign,run,save}.json (transcribed as
# cases/core-genre-strategy-*.json); they retire Unreal's Portable/InsimulStrategy.{h,cpp}
# (P9j.unreal.retire-strategy-copy). Slice 4, the row's last, adds the genre pieces: core's
# src/genre-systems/genre-pieces.ts (which kinds a genre places, the key of one, a definition's
# pieces), the kinds they are keyed by (src/archetypes/taxonomy.ts), the binding walk's genre piece
# leg (src/editor/binding/archetypes.ts) and src/genre-systems/build-plan.ts (the anchors, the
# placement, the settle offset, the plan, its ground and the writer) as the `genrePieces.*` rows,
# held to conformance/genre-pieces/{kinds,build-plan}.json (core's runners
# src/editor/binding/genre-pieces-corpus.ts and src/genre-systems/build-plan-corpus.ts; the build
# plan's `$fixture` inputs resolved as core resolves them, and its placement, settle and ground
# tables held to genrePieces.contract; transcribed as cases/core-genre-genre-pieces-*.json); they
# retire Unreal's Portable/InsimulGenrePieces.{h,cpp} (P9j.unreal.retire-genre-pieces-copy).
# The regex demands every refusal probe as core answers,
# each file's driven line with every op (and the run file's every step) driven and 0 undriven,
# every row it names called, then PASS. It holds no ';'.
add_executable(insimulcore_genre_systems_corpus tests/genre_systems_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_genre_systems_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_genre_systems_corpus PRIVATE insimulcore)
set(INSIMUL_GENRE_SYSTEMS_CORPORA
  --slice ${INSIMUL_PROPS_CORPUS}/genre-mechanics/thistlecombe.world-slice.json
  ${INSIMUL_PROPS_CORPUS}/puzzle/definition.json
  ${INSIMUL_PROPS_CORPUS}/puzzle/run.json
  ${INSIMUL_PROPS_CORPUS}/puzzle/save.json
  ${INSIMUL_PROPS_CORPUS}/platformer/course.json
  ${INSIMUL_PROPS_CORPUS}/platformer/run.json
  ${INSIMUL_PROPS_CORPUS}/platformer/save.json
  ${INSIMUL_PROPS_CORPUS}/strategy/campaign.json
  ${INSIMUL_PROPS_CORPUS}/strategy/run.json
  ${INSIMUL_PROPS_CORPUS}/strategy/save.json
  ${INSIMUL_PROPS_CORPUS}/genre-pieces/kinds.json
  ${INSIMUL_PROPS_CORPUS}/genre-pieces/build-plan.json)
add_test(NAME genre_systems_corpus COMMAND insimulcore_genre_systems_corpus ${INSIMUL_GENRE_SYSTEMS_CORPORA})
set_tests_properties(genre_systems_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 54 of 54 probe[(]s[)] as core answers[^\n]*\n.*puzzle/definition: [1-9][0-9]* case[(]s[)], driven generate [1-9][0-9]*, authored [1-9][0-9]*, choices [1-9][0-9]*. 0 undriven\n.*puzzle/run: [1-9][0-9]* case[(]s[)], driven run [1-9][0-9]*. 0 undriven. steps restore [1-9][0-9]*, clue [1-9][0-9]*, answer [1-9][0-9]*, unlock [1-9][0-9]*, take [1-9][0-9]*, view [1-9][0-9]*, progress [1-9][0-9]*, complete [1-9][0-9]*, state [1-9][0-9]*\n.*puzzle/save: [1-9][0-9]* case[(]s[)], driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*platformer/course: [1-9][0-9]* case[(]s[)], driven generate [1-9][0-9]*, route [1-9][0-9]*, stars [1-9][0-9]*. 0 undriven\n.*platformer/run: [1-9][0-9]* case[(]s[)], driven run [1-9][0-9]*. 0 undriven. steps restore [1-9][0-9]*, enter [1-9][0-9]*, step [1-9][0-9]*, respawn [1-9][0-9]*, hint [1-9][0-9]*, unlocked [1-9][0-9]*, progress [1-9][0-9]*, state [1-9][0-9]*\n.*platformer/save: [1-9][0-9]* case[(]s[)], driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*strategy/campaign: [1-9][0-9]* case[(]s[)], driven generate [1-9][0-9]*, books [1-9][0-9]*, claimCost [1-9][0-9]*, controlled [1-9][0-9]*, adjacency [1-9][0-9]*. 0 undriven\n.*strategy/run: [1-9][0-9]* case[(]s[)], driven run [1-9][0-9]*. 0 undriven. steps start [1-9][0-9]*, restore [1-9][0-9]*, claim [1-9][0-9]*, assign [1-9][0-9]*, release [1-9][0-9]*, endTurn [1-9][0-9]*, stockpile [1-9][0-9]*, holder [1-9][0-9]*, controls [1-9][0-9]*, victory [1-9][0-9]*, progress [1-9][0-9]*, state [1-9][0-9]*\n.*strategy/save: [1-9][0-9]* case[(]s[)], driven block [1-9][0-9]*, read [1-9][0-9]*, restore [1-9][0-9]*. 0 undriven\n.*genre-pieces/kinds: [1-9][0-9]* case[(]s[)], driven kinds [1-9][0-9]*, key [1-9][0-9]*, pieces [1-9][0-9]*, collect [1-9][0-9]*, stamp [1-9][0-9]*. 0 undriven\n.*genre-pieces/build-plan: placement, settle and ground tables as genrePieces.contract states them\n.*genre-pieces/build-plan: [1-9][0-9]* case[(]s[)], driven anchors [1-9][0-9]*, place [1-9][0-9]*, plan [1-9][0-9]*, settle [1-9][0-9]*, ground [1-9][0-9]*, write [1-9][0-9]*. 0 undriven\n.*rows: 73 of 73 called by the corpora's cases\ngenre_systems_corpus: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\ngenre_systems_corpus: PASS")
# Its negative pass: every case's expectation perturbed (its last leaf), every one refused.
add_test(NAME genre_systems_corpus_negative COMMAND insimulcore_genre_systems_corpus --negative ${INSIMUL_GENRE_SYSTEMS_CORPORA})
set_tests_properties(genre_systems_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 54 of 54 probe[(]s[)] as core answers[^\n]*\n.*rows: 73 of 73 called by the corpora's cases\ngenre_systems_corpus --negative: [1-9][0-9]* of [1-9][0-9]* perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)][^\n]*\ngenre_systems_corpus --negative: PASS")

# villagers_pass_by_corpus (PL.native-pass-by-rows, rulings U128, U118, U107, U49(3) and U36):
# core's villager pass-by rule (src/pass-by/pass-by.ts: the body guard, the step aside and
# the turn back) and its frame-by-frame replay (src/pass-by/pass-by-replay.ts) as
# libinsimulcore's `passBy.*` rows, held to core's own corpus
# conformance/villagers/pass-by.json, COPIED byte for byte into
# corebridge/vendor/core/conformance/villagers/ at the pin (vendor-core-bundle.mjs
# PASS_BY_CORPUS_FILES; hashed, and byte-compared under --check --core).
# tests/villagers_pass_by_corpus.cpp calls one row per case, in the file's order, as core's
# reference runner (pass-by-corpus.ts) makes one core call; the same cases also run on both
# legs as the transcribed cases/core-villagers-pass-by.json. Unreal's interim
# Portable/InsimulPassBy is the copy these rows retire (P4.unreal.retire-pass-by-copy). The
# regex demands the refusal probes' line with every probe refused, the contract line with
# every constant agreeing, the driven line with each of core's five ops driven and 0
# undriven, then PASS. It holds no ';' (CMake would split it into a list, and a list passes
# when ANY part matches).
add_executable(insimulcore_villagers_pass_by_corpus tests/villagers_pass_by_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_villagers_pass_by_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_villagers_pass_by_corpus PRIVATE insimulcore)
set(INSIMUL_PASS_BY_CORPUS ${INSIMUL_PROPS_CORPUS}/villagers/pass-by.json)
add_test(NAME villagers_pass_by_corpus COMMAND insimulcore_villagers_pass_by_corpus ${INSIMUL_PASS_BY_CORPUS})
set_tests_properties(villagers_pass_by_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\ncontract: [1-9][0-9]* of [1-9][0-9]* constant[(]s[)] passBy.contract states agree with the corpus's, each with its export name, and sideFrames and measuredAbreastS agree\n.*villager-pass-by: driven floor [1-9][0-9]*, guard [1-9][0-9]*, plan [1-9][0-9]*, round [1-9][0-9]*, replay [1-9][0-9]*. 0 undriven\nvillagers_pass_by_corpus: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\nvillagers_pass_by_corpus: PASS")
# Its negative pass: every case's expectation perturbed (its last leaf) must be refused.
add_test(NAME villagers_pass_by_corpus_negative COMMAND insimulcore_villagers_pass_by_corpus --negative ${INSIMUL_PASS_BY_CORPUS})
set_tests_properties(villagers_pass_by_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\n.*villagers_pass_by_corpus --negative: [1-9][0-9]* of [1-9][0-9]* perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)][^\n]*\nvillagers_pass_by_corpus --negative: PASS")

# editor_dock_operations_corpus (PL.native-dock-operations-rows, rulings U132, U113, U128 and
# U101(1)): core's request builder for the four operations engine editor docks call
# (src/editor/dock-operations.ts: DOCK_OPERATION_IDS, DOCK_OPERATION_RULES, dockOperationRequest;
# PL.core-dock-operations-register) as libinsimulcore's `editor.dockOperations.ids`, `.rules` and
# `.request` rows, held to core's four row files conformance/editor-operations/
# {get-world-ir-summary,reread-reference-texts,mint-play-grant,get-entity-neighbourhood}.json
# (27 request cases at the 45409ed pin: 7 / 5 / 8 / 7) and the area's MANIFEST.json, COPIED byte
# for byte as their own set (sha256 in VENDORED.json, checked by core_vendor; byte-compared with
# core by `--check --core`). tests/editor_dock_operations_corpus.cpp holds each file to
# MANIFEST.json's sha256 and case counts (stale bytes are red here too), each published `row` to
# the rules row, and replays every request case as ONE request-row call, comparing method, path,
# query and body exactly, or core's refusal code and `received`; it requires every refusal code
# core states to be answered and {} to be no body, and proves on every start that its comparator,
# perturbations and manifest check can fail and that the row refuses only what core's types
# exclude. The regex demands every probe, all four files, every code and PASS.
add_executable(insimulcore_editor_dock_operations_corpus tests/editor_dock_operations_corpus.cpp
  tests/radiant/json_value.cpp tests/radiant/sha256.cpp)
target_include_directories(insimulcore_editor_dock_operations_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_editor_dock_operations_corpus PRIVATE insimulcore)
set(INSIMUL_EDITOR_OPERATIONS_CORPUS ${INSIMUL_PROPS_CORPUS}/editor-operations)
add_test(NAME editor_dock_operations_corpus COMMAND insimulcore_editor_dock_operations_corpus ${INSIMUL_EDITOR_OPERATIONS_CORPUS})
set_tests_properties(editor_dock_operations_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 13 of 13 probe[(]s[)] refused as core refuses[^\n]*\nmanifest: 4 of 4 file[(]s[)] match MANIFEST.json's sha256 and case counts\nrules: 4 of 4 published row[(]s[)] state the rule[^\n]*\n.*get-world-ir-summary.json [(]getWorldIRSummary[)]: [1-9][0-9]* request case[(]s[)] driven, 0 failed\n.*reread-reference-texts.json [(]rereadReferenceTexts[)]: [1-9][0-9]* request case[(]s[)] driven, 0 failed\n.*mint-play-grant.json [(]mintPlayGrant[)]: [1-9][0-9]* request case[(]s[)] driven, 0 failed\n.*get-entity-neighbourhood.json [(]getEntityNeighbourhood[)]: [1-9][0-9]* request case[(]s[)] driven, 0 failed\ncodes: 8 of 8 refusal code[(]s[)] core states answered by the corpus\nempty body: [1-9][0-9]* corpus case[(]s[)] and 4 of 4 probe[(]s[)] answer [{][}] as no body\neditor_dock_operations_corpus: 27 of 27 request case[(]s[)] driven through editor.dockOperations.request, 0 failed\neditor_dock_operations_corpus: PASS")
# Its negative pass: every case's expectation perturbed (an ok case five ways, a refusal three), every one refused.
add_test(NAME editor_dock_operations_corpus_negative COMMAND insimulcore_editor_dock_operations_corpus --negative ${INSIMUL_EDITOR_OPERATIONS_CORPUS})
set_tests_properties(editor_dock_operations_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "manifest: 4 of 4 file[(]s[)] match[^\n]*\n.*editor_dock_operations_corpus --negative: 101 of 101 perturbation[(]s[)] refused over [1-9][0-9]* request case[(]s[)], 0 accepted, 0 failure[(]s[)]\neditor_dock_operations_corpus --negative: PASS")

# props_vehicle_placement_corpus (PL.native-vehicle-rows, rulings U128, U115, U107, U106(3),
# U49(3) and U36): core's world-vehicle parking rule (PL.core-vehicle-rules:
# src/props/vehicle-placement.ts, parkVehicle and vehicleStreetProbes) as libinsimulcore's
# `props.vehicle.*` rows, held to core's own corpus conformance/props/vehicle-placement.json
# (26 cases at the 45409ed pin: park 23, probes 3), COPIED byte for byte with the props set
# (sha256 in VENDORED.json, checked by core_vendor; byte-compared with core by `--check
# --core`). tests/props_vehicle_placement_corpus.cpp calls one row per case, in the file's
# order, as core's runner (vehicle-placement-corpus.ts, runVehiclePlacementOp) makes one core
# call, and compares as checkVehiclePlacementCase does (numbers within the file's tolerance,
# key sets both ways); it holds props.vehicle.contract to the file's contract (every
# constant's value with its VEHICLE_PARK_* export name, refusals, tiers, deviations), requires
# the file's numerics to name double precision, and proves on every start that its
# comparator, perturbation and contract check can fail (eleven contract probes) and that the
# rows refuse what core cannot read while a refused parking is core's value. The regex demands
# every probe, the contract, both ops driven, 0 undriven and PASS.
add_executable(insimulcore_props_vehicle_placement_corpus tests/props_vehicle_placement_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_props_vehicle_placement_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_props_vehicle_placement_corpus PRIVATE insimulcore)
set(INSIMUL_VEHICLE_PLACEMENT_CORPUS ${INSIMUL_PROPS_CORPUS}/props/vehicle-placement.json)
add_test(NAME props_vehicle_placement_corpus COMMAND insimulcore_props_vehicle_placement_corpus ${INSIMUL_VEHICLE_PLACEMENT_CORPUS})
set_tests_properties(props_vehicle_placement_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\nnumerics: double precision, as the file states[^\n]*\ncontract: [1-9][0-9]* of [1-9][0-9]* constant[(]s[)] props.vehicle.contract states agree with the corpus's, each with its export name, and refusals, tiers and deviations agree\n.*props-vehicle-placement: driven probes [1-9][0-9]*, park [1-9][0-9]*. 0 undriven\nprops_vehicle_placement_corpus: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\nprops_vehicle_placement_corpus: PASS")
# Its numerics control: a file whose `numerics` names single precision (tests/props-negative/
# vehicle-placement-float.json, one core case and one core constant) must fail the run on that line.
add_test(NAME props_vehicle_placement_corpus_numerics COMMAND insimulcore_props_vehicle_placement_corpus
  ${CMAKE_CURRENT_SOURCE_DIR}/tests/props-negative/vehicle-placement-float.json)
set_tests_properties(props_vehicle_placement_corpus_numerics PROPERTIES
  PASS_REGULAR_EXPRESSION "\\[FAIL\\] numerics: the file states \"Runners compute in IEEE-754 single precision[^\n]*not double precision.*props_vehicle_placement_corpus: FAIL")
# Its negative pass: every case's expectation perturbed (its last leaf) must be refused.
add_test(NAME props_vehicle_placement_corpus_negative COMMAND insimulcore_props_vehicle_placement_corpus --negative ${INSIMUL_VEHICLE_PLACEMENT_CORPUS})
set_tests_properties(props_vehicle_placement_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: [1-9][0-9]* of [1-9][0-9]* probe[(]s[)] refused as core refuses[^\n]*\n.*props_vehicle_placement_corpus --negative: [1-9][0-9]* of [1-9][0-9]* perturbed case[(]s[)] refused, 0 accepted, 0 failure[(]s[)][^\n]*\nprops_vehicle_placement_corpus --negative: PASS")

# ui_hud_corpus (PL.native-hud-rows, rulings U143(2), U128, U85(3) and U36): core's three HUD
# view-models (P2.core, P2.core-north) — the toast queue and the history log
# (src/ui/notifications.ts, game-engine/logic/NotificationStore.ts), the compass
# (src/ui/compass-model.ts) and the minimap (src/ui/minimap-model.ts) — as libinsimulcore's
# `ui.notifications.*`, `ui.compass.*` and `ui.minimap.*` rows, held to core's own corpora
# conformance/ui/{notifications,compass,minimap}-cases.json (22, 82 and 50 cases at the 45409ed
# pin), COPIED byte for byte with the P2 HUD set (sha256 in VENDORED.json, checked by core_vendor;
# byte-compared with core by `--check --core`). tests/ui_hud_corpus.cpp answers each case as
# core's runner (src/ui/hud-corpus.ts, runHudOp) does, through the rows, and compares as
# compareHudValue does (numbers within the file's tolerance, key sets both ways); it holds each
# file's contract block whole (the keys the contract row states, the keys it measures, the rule
# keys the cases pin; an unknown key fails), and proves on every start that its comparator,
# perturbation and contract check can fail and that the rows refuse what core cannot read while
# core's own refusals are values. The regex demands every probe, each file's contract whole, every
# op driven, 0 undriven and PASS.
add_executable(insimulcore_ui_hud_corpus tests/ui_hud_corpus.cpp tests/radiant/json_value.cpp)
target_include_directories(insimulcore_ui_hud_corpus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
target_link_libraries(insimulcore_ui_hud_corpus PRIVATE insimulcore)
set(INSIMUL_HUD_CORPORA
  ${INSIMUL_PROPS_CORPUS}/ui/notifications-cases.json
  ${INSIMUL_PROPS_CORPUS}/ui/compass-cases.json
  ${INSIMUL_PROPS_CORPUS}/ui/minimap-cases.json)
add_test(NAME ui_hud_corpus COMMAND insimulcore_ui_hud_corpus ${INSIMUL_HUD_CORPORA})
set_tests_properties(ui_hud_corpus PROPERTIES
  PASS_REGULAR_EXPRESSION "refusals: 14 of 14 probe[(]s[)] refused as core refuses[^\n]*\n.*ui-notifications contract: 9 key[(]s[)], whole: 4 of 4 stated by ui.notifications.contract agree; 3 of 3 measured hold[^\n]*\nui-notifications: driven toasts [1-9][0-9]*, history [1-9][0-9]*. 0 undriven\nui-notifications: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\n.*ui-compass contract: 16 key[(]s[)], whole: 4 of 4 stated by ui.compass.contract agree; 3 of 3 measured hold[^\n]*\nui-compass: driven view [1-9][0-9]*, heading [1-9][0-9]*, cardinal [1-9][0-9]*, north [1-9][0-9]*, world_view [1-9][0-9]*. 0 undriven\nui-compass: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\n.*ui-minimap contract: 12 key[(]s[)], whole: 7 of 7 stated by ui.minimap.contract agree; 1 of 1 measured hold[^\n]*\nui-minimap: driven project [1-9][0-9]*, toneFor [1-9][0-9]*, sizeFor [1-9][0-9]*, session [1-9][0-9]*. 0 undriven\nui-minimap: [1-9][0-9]* of [1-9][0-9]* case[(]s[)] driven through the rows, 0 failed[^\n]*\nui_hud_corpus: 3 file[(]s[)], 154 of 154 case[(]s[)] driven, 0 case[(]s[)] failed, 0 failure[(]s[)][^\n]*\nui_hud_corpus: PASS")
# Its negative pass: every case's expectation perturbed (its last leaf) must be refused.
add_test(NAME ui_hud_corpus_negative COMMAND insimulcore_ui_hud_corpus --negative ${INSIMUL_HUD_CORPORA})
set_tests_properties(ui_hud_corpus_negative PROPERTIES
  PASS_REGULAR_EXPRESSION "ui-notifications: 22 of 22 perturbed case[(]s[)] refused, 0 accepted\n.*ui-compass: 82 of 82 perturbed case[(]s[)] refused, 0 accepted\n.*ui-minimap: 50 of 50 perturbed case[(]s[)] refused, 0 accepted\nui_hud_corpus --negative: 3 file[(]s[)], 154 of 154 case[(]s[)] driven, 0 case[(]s[)] failed, 0 failure[(]s[)][^\n]*\nui_hud_corpus --negative: PASS")
# Its wrong-file control (tests/hud-negative/compass-wrong.json, core's compass corpus cut to three cases
# and doctored): a contract value the row states otherwise, a contract key no one holds, a refusal code the
# rows never answer, a wrong expectation and an op core's runner does not have must each be named, and the
# run must FAIL.
add_test(NAME ui_hud_corpus_wrong COMMAND insimulcore_ui_hud_corpus ${CMAKE_CURRENT_SOURCE_DIR}/tests/hud-negative/compass-wrong.json)
set_tests_properties(ui_hud_corpus_wrong PROPERTIES
  PASS_REGULAR_EXPRESSION "\\[FAIL\\] ui-compass contract: defaultSpanDegrees: 140 != 150\n[^\n]*\\[FAIL\\] ui-compass contract: the file's contract key wrongRule is not one this runner holds[^\n]*\n.*expected WRONGLY as heading 80 [^\n]*heading: 80 != 70\n[^\n]*\\[FAIL\\] WRONGLY an op core's runner does not have [^\n]*not driven: op rotate is not one of core's ui-compass ops.*\\[FAIL\\] ui-compass contract: refusalCodes: the contract states \\[not_finite, span_out_of_range, teleported\\] but the rows answered \\[not_finite\\].*ui_hud_corpus: FAIL")

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
