# libinsimulcore — `@insimul/core` behind a C ABI (tasklist 104, US-1).
#
# THE SECOND LIBRARY IN THIS REPO, NOT A SECOND HALF OF THE FIRST. libinsimul
# is the Prolog core (Trealla behind include/insimul.h); libinsimulcore is
# core's TypeScript running in an embedded QuickJS behind
# corebridge/include/insimulcore.h. Two libraries, two ABIs, one build — they
# are deliberately NOT merged (RUNTIME_CORE_ADOPTION.md §4.5). The only edge
# between them is that libinsimulcore *consumes* libinsimul's public ABI, the
# same way a game plugin does.
#
# It lives here rather than in the Godot plugin so Unity (P/Invoke) and Unreal
# (ThirdParty module) bind the SAME bridge instead of forking it — see
# README.md and docs/consuming.md.
#
# ARTIFACTS (both land beside libinsimul's in the top-level build dir):
#   libinsimulcore.a       static; a consumer links libinsimul.a too
#   libinsimulcore.dylib   shared; SELF-CONTAINED — see "why static-linked" below
#
# NOT BUILT FOR WASM. cmake/wasm.cmake's `return()` stops before this directory
# is added: a browser host runs `@insimul/core` as the TypeScript it already is,
# so compiling a JS engine to wasm to run JS would be circular. libinsimul's
# wasm target is unaffected (that is US-1's fourth acceptance criterion).

# --------------------------------------------------------------------- QuickJS
# The pin lives in the vendored tree (vendor/quickjs/VERSION), exactly as
# Trealla's pin lives in the top-level CMakeLists — one authoritative source per
# dependency, read by the build so the stamp cannot drift from what was
# compiled. insimul_core_version() reports it via CONFIG_VERSION.
# See ../THIRD_PARTY.md before bumping.
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/vendor/quickjs/VERSION QUICKJS_VERSION
     LIMIT_COUNT 1)
string(STRIP "${QUICKJS_VERSION}" QUICKJS_VERSION)
if(NOT QUICKJS_VERSION)
  message(FATAL_ERROR "corebridge: vendor/quickjs/VERSION is empty — the QuickJS pin is unreadable")
endif()
# The top-level CMakeLists passes this to tests/corebridge_smoke.c, which asserts
# insimul_core_version() actually reports the pin that was compiled in.
set(QUICKJS_VERSION "${QUICKJS_VERSION}" PARENT_SCOPE)

# Only the engine core is vendored: quickjs-libc is deliberately absent, so the
# embedded runtime has no filesystem, process or network access at all.
add_library(quickjs_objs OBJECT
  vendor/quickjs/quickjs.c
  vendor/quickjs/libregexp.c
  vendor/quickjs/libunicode.c
  vendor/quickjs/cutils.c
  vendor/quickjs/dtoa.c
)
set_target_properties(quickjs_objs PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(quickjs_objs PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/vendor/quickjs)
target_compile_definitions(quickjs_objs PUBLIC CONFIG_VERSION="${QUICKJS_VERSION}")
# Vendored code, unmodified: silence its warnings so the insimul build log stays
# readable (same treatment trealla_objs gets).
target_compile_options(quickjs_objs PRIVATE -w)
target_link_libraries(quickjs_objs PUBLIC m)

# ------------------------------------------------------- the bridge's own units
# vendor/core/insimul_core_bundle.c is GENERATED (tools/vendor-core-bundle.mjs)
# and is compiled with warnings off for the same reason: it is a 54 KB byte
# array, not source anybody reviews line by line.
set_source_files_properties(vendor/core/insimul_core_bundle.c PROPERTIES COMPILE_OPTIONS -w)

set(INSIMULCORE_SRC
  src/insimulcore.c
  vendor/core/insimul_core_bundle.c
)

# ---------------------------------------------------------------- the libraries
add_library(insimulcore STATIC ${INSIMULCORE_SRC})
target_include_directories(insimulcore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
# vendor/core holds the generated bundle header; it is an implementation detail,
# so PRIVATE — a consumer sees only insimulcore.h.
target_include_directories(insimulcore PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/vendor/core)
target_link_libraries(insimulcore PRIVATE quickjs_objs)
# libinsimul's PUBLIC ABI, consumed exactly as an engine plugin consumes it
# (src/insimulcore.c includes insimul.h, never trealla.h). PRIVATE for headers;
# a static archive does not absorb another archive, so it is re-exported as an
# INTERFACE link requirement — link libinsimulcore and you link libinsimul.
target_link_libraries(insimulcore PRIVATE insimul)
target_link_libraries(insimulcore INTERFACE insimul)

# WHY THE SHARED LIBRARY STATIC-LINKS libinsimul. `libinsimulcore.dylib` is what
# Unity P/Invokes and Unreal stages; it must be loadable on its own, without an
# rpath dance to find a sibling libinsimul.dylib. Absorbing libinsimul.a makes it
# a single self-contained artifact — which is safe here precisely because the two
# ABIs share no state: no `insimul_kb` handle ever crosses insimulcore.h, so a
# host that also loads libinsimul.dylib gets an independent engine instance
# rather than a corrupted shared one. It costs binary size, not correctness.
add_library(insimulcore_shared SHARED ${INSIMULCORE_SRC})
set_target_properties(insimulcore_shared PROPERTIES OUTPUT_NAME insimulcore)
target_include_directories(insimulcore_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_include_directories(insimulcore_shared PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/vendor/core)
target_link_libraries(insimulcore_shared PRIVATE quickjs_objs insimul)

# Both artifacts land in the top-level build dir, beside libinsimul.a and
# libinsimul.dylib — that is the layout scripts/package.sh and the engine repos'
# gates (godot's run_radiant_tests.sh probes `<native>/build/libinsimul.*`)
# already expect.
set_target_properties(insimulcore insimulcore_shared PROPERTIES
  ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
  LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
