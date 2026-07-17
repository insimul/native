# insimul-native — the shared native Prolog core (libinsimul).
#
# Builds a static + shared library `insimul` from src/, embedding a REAL
# ISO-conforming Prolog engine: Trealla Prolog (pure C, MIT), vendored via
# FetchContent at a pinned commit (see THIRD_PARTY.md). US-LI1 delivers the
# skeleton + a ctest smoke test that consults a KB and runs one query through
# Trealla's C API; the stable insimul C ABI lands in US-LI2 (include/insimul.h).
cmake_minimum_required(VERSION 3.24)
project(insimul LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

find_package(Threads REQUIRED)
include(FetchContent)

# ---------------------------------------------------------------------------
# Vendored Trealla Prolog (MIT). Pinned — see THIRD_PARTY.md before bumping.
# ---------------------------------------------------------------------------
set(TREALLA_GIT_TAG "v2.106.1" CACHE STRING "Trealla tag (documented pin)")
set(TREALLA_GIT_COMMIT "07de013677af760a8bca0594ae4b2bef158a3cde"
    CACHE STRING "Trealla commit (the authoritative pin)")

FetchContent_Declare(
  trealla
  GIT_REPOSITORY https://github.com/trealla-prolog/trealla.git
  GIT_TAG        ${TREALLA_GIT_COMMIT}
  GIT_SHALLOW    FALSE   # fetching an exact SHA is unreliable with shallow clones
)
# Trealla ships a Makefile, not a CMakeLists — MakeAvailable (CMake >= 3.28)
# just populates ${trealla_SOURCE_DIR} and does NOT add_subdirectory().
FetchContent_MakeAvailable(trealla)
set(TREALLA_DIR ${trealla_SOURCE_DIR})

# ---------------------------------------------------------------------------
# Embed Trealla's Prolog standard library (library/*.pl) as C byte arrays.
# Trealla's Makefile compiles a host tool `bin2c` and, for each library/x.pl,
# writes "#include <stddef.h>" followed by bin2c's output into library/x.c.
# bin2c derives the C symbol name from its PATH ARGUMENT, so it MUST be run as
# `bin2c library/<name>.pl` from the Trealla root or the symbols won't match
# the externs in src/library.c. cmake/gen_embed.cmake handles that.
# ---------------------------------------------------------------------------
add_executable(insimul_bin2c ${TREALLA_DIR}/util/bin2c.c)

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
      -DBIN2C=$<TARGET_FILE:insimul_bin2c>
      -DTREALLA_DIR=${TREALLA_DIR}
      -DPL_NAME=${name}
      -DOUT=${out}
      -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_embed.cmake
    DEPENDS insimul_bin2c ${pl}
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
  USE_THREADS=1
  _GNU_SOURCE
  VERSION="${TREALLA_GIT_TAG}"
  DEFAULT_LIBRARY_PATH="${CMAKE_INSTALL_PREFIX}/share/trealla/library"
)
# Vendored code: silence its warnings so the insimul build log stays readable.
target_compile_options(trealla_objs PRIVATE -w)
target_link_libraries(trealla_objs PUBLIC m Threads::Threads)

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
add_library(insimul STATIC src/insimul.c ${INSIMUL_BOOT_C})
target_link_libraries(insimul PRIVATE trealla_objs)
target_link_libraries(insimul INTERFACE m Threads::Threads)
target_include_directories(insimul PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
# src/insimul.c needs Trealla's C API (trealla.h); it stays PRIVATE so it never
# leaks into insimul's public include interface.
target_include_directories(insimul PRIVATE ${TREALLA_DIR}/src)

add_library(insimul_shared SHARED src/insimul.c ${INSIMUL_BOOT_C})
target_link_libraries(insimul_shared PRIVATE trealla_objs)
set_target_properties(insimul_shared PROPERTIES OUTPUT_NAME insimul)
target_include_directories(insimul_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_include_directories(insimul_shared PRIVATE ${TREALLA_DIR}/src)

# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
enable_testing()

add_executable(insimul_smoke tests/smoke.c)
target_link_libraries(insimul_smoke PRIVATE insimul)
# The smoke test drives Trealla's C API directly, so it needs trealla.h.
target_include_directories(insimul_smoke PRIVATE ${TREALLA_DIR}/src)
add_test(NAME smoke COMMAND insimul_smoke)

# The ABI test is a pure consumer of include/insimul.h (no trealla.h): it both
# exercises US-LI2 and proves the opaque boundary compiles/links cleanly.
add_executable(insimul_abi tests/abi.c)
target_link_libraries(insimul_abi PRIVATE insimul)
add_test(NAME abi COMMAND insimul_abi)

# Conformance harness (US-LI3): drives the ABI over every golden corpus case
# from insimul-runtime/packages/core/conformance/prolog. The default corpus dir
# is baked as an absolute path to the sibling submodule; INSIMUL_CONFORMANCE_DIR
# overrides it (so CI can point anywhere). Also a pure consumer of insimul.h.
get_filename_component(INSIMUL_CONFORMANCE_DEFAULT_DIR
  "${CMAKE_CURRENT_SOURCE_DIR}/../insimul-runtime/packages/core/conformance/prolog"
  ABSOLUTE)
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
