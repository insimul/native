# cmake/swipl.cmake — locate a built SWI-Prolog and describe it to the build.
#
# The D20 spike's SECOND engine (tasklist 250). Unlike Trealla, SWI-Prolog is
# NOT vendored here and is not fetched by the build: it is located, from an
# install prefix produced by scripts/build_swipl.sh (which pins the commit and
# records the exact configure flags, so the measurement is reproducible on
# another machine). A spike is allowed to depend on a tool it built; shipping
# would not be — see docs/SWIPL_SPIKE.md §"What vendoring would cost".
#
# Sets, for the caller:
#   INSIMUL_ENGINE_SRC / _INCLUDE / _LINK / _DEFS   — how to compile the port
#   INSIMUL_ENGINE_VERSION_VALUE / _COMMIT_VALUE    — the version stamp's values
#   INSIMUL_ENGINE_WASM_LINK_OPTIONS                — extra link options (wasm)
#   INSIMUL_ENGINE_WASM_PRELOAD_DIR / _MOUNT        — a directory the wasm target
#                                                     must ship inside the module
#
# TWO TARGETS, TWO PREFIX SHAPES (US-1 native, US-2 wasm):
#
#   native — `swipl --dump-runtime-variables`, SWI's own answer to "where did I
#            install myself", so this cannot drift from the tree that was built.
#   wasm   — there is no host `swipl` to ask (the build is cross-compiled), so
#            the prefix is the fixed layout scripts/build_swipl.sh --target wasm
#            assembles: lib/libswipl.a, include/, home/ (boot.prc + library).
#            The home tree becomes an Emscripten --preload-file image mounted at
#            /swipl inside the module — gap G-02 in its browser form: the engine
#            is not self-contained, so its library rides along as file-system
#            bytes the page must download.

set(INSIMUL_SWIPL_ROOT "" CACHE PATH
    "Install prefix of the SWI-Prolog built by scripts/build_swipl.sh")

if(NOT INSIMUL_SWIPL_ROOT)
  if(EMSCRIPTEN)
    message(FATAL_ERROR
      "INSIMUL_ENGINE=swipl needs -DINSIMUL_SWIPL_ROOT=<prefix>.\n"
      "Build one first:  scripts/build_swipl.sh --target wasm\n"
      "which prints the prefix to pass here.")
  else()
    message(FATAL_ERROR
      "INSIMUL_ENGINE=swipl needs -DINSIMUL_SWIPL_ROOT=<prefix>.\n"
      "Build one first:  scripts/build_swipl.sh\n"
      "which prints the prefix to pass here.")
  endif()
endif()

# The commit that produced this prefix, recorded by scripts/build_swipl.sh next
# to the install so the version stamp names bytes, not a wish. Same file on both
# targets; `target=` in it says which one it describes.
set(INSIMUL_SWIPL_COMMIT "unknown")
set(INSIMUL_SWIPL_PIN_TARGET "unknown")
if(EXISTS "${INSIMUL_SWIPL_ROOT}/INSIMUL_SWIPL_PIN")
  file(STRINGS "${INSIMUL_SWIPL_ROOT}/INSIMUL_SWIPL_PIN" _pin_lines)
  foreach(_l ${_pin_lines})
    if(_l MATCHES "^commit=(.*)$")
      set(INSIMUL_SWIPL_COMMIT "${CMAKE_MATCH_1}")
    elseif(_l MATCHES "^target=(.*)$")
      set(INSIMUL_SWIPL_PIN_TARGET "${CMAKE_MATCH_1}")
    endif()
  endforeach()
endif()

if(EMSCRIPTEN)
  # ------------------------------------------------------------------- wasm
  set(INSIMUL_SWIPL_LIB  "${INSIMUL_SWIPL_ROOT}/lib/libswipl.a")
  set(INSIMUL_SWIPL_INC  "${INSIMUL_SWIPL_ROOT}/include")
  set(INSIMUL_SWIPL_HOME_DIR "${INSIMUL_SWIPL_ROOT}/home")

  if(NOT EXISTS "${INSIMUL_SWIPL_LIB}" OR NOT EXISTS "${INSIMUL_SWIPL_HOME_DIR}/boot.prc")
    message(FATAL_ERROR
      "${INSIMUL_SWIPL_ROOT} is not a wasm SWI-Prolog prefix "
      "(expected lib/libswipl.a and home/boot.prc).\n"
      "The native prefix cannot be used here: build one with "
      "scripts/build_swipl.sh --target wasm")
  endif()
  if(NOT INSIMUL_SWIPL_PIN_TARGET STREQUAL "wasm")
    message(FATAL_ERROR
      "${INSIMUL_SWIPL_ROOT}/INSIMUL_SWIPL_PIN says target=${INSIMUL_SWIPL_PIN_TARGET}, "
      "not 'wasm'. Refusing to link a host build into a wasm module.")
  endif()

  # No `swipl` to interrogate in a cross build; the version is the one compiled
  # into the header that will be compiled against.
  file(STRINGS "${INSIMUL_SWIPL_INC}/SWI-Prolog.h" _plver_line
       REGEX "^#define[ \t]+PLVERSION[ \t]+[0-9]+")
  string(REGEX MATCH "[0-9]+" _swipl_ver_num "${_plver_line}")
  if(NOT _swipl_ver_num)
    message(FATAL_ERROR "no PLVERSION in ${INSIMUL_SWIPL_INC}/SWI-Prolog.h")
  endif()
  set(INSIMUL_SWIPL_ARCH "wasm32-emscripten")

  # SWI's home tree is not compiled in; it is shipped as a preload image and
  # mounted at a FIXED path in the module's MEMFS. The port reads
  # INSIMUL_SWIPL_HOME (and still honours $SWI_HOME_DIR at run time).
  set(INSIMUL_SWIPL_MOUNT "/swipl")
  set(INSIMUL_ENGINE_WASM_PRELOAD_DIR   "${INSIMUL_SWIPL_HOME_DIR}")
  set(INSIMUL_ENGINE_WASM_PRELOAD_MOUNT "${INSIMUL_SWIPL_MOUNT}")
  # The SWI core (not one of its packages) uses zlib; Emscripten's port supplies
  # it, and scripts/build_swipl.sh built libswipl.a against exactly this one.
  set(INSIMUL_ENGINE_WASM_LINK_OPTIONS "-sUSE_ZLIB=1")

  set(INSIMUL_ENGINE_INCLUDE ${INSIMUL_SWIPL_INC})
  set(INSIMUL_ENGINE_LINK    ${INSIMUL_SWIPL_LIB})
  set(INSIMUL_ENGINE_DEFS    INSIMUL_SWIPL_HOME="${INSIMUL_SWIPL_MOUNT}")
else()
  # ----------------------------------------------------------------- native
  # `unknown` is accepted: a prefix produced before the pin file carried a
  # target= line is a native one. A prefix that SAYS wasm never is.
  if(INSIMUL_SWIPL_PIN_TARGET STREQUAL "wasm")
    message(FATAL_ERROR
      "${INSIMUL_SWIPL_ROOT} is a wasm prefix (INSIMUL_SWIPL_PIN says target=wasm); "
      "build a native one with scripts/build_swipl.sh")
  endif()

  find_program(INSIMUL_SWIPL_EXE swipl
               PATHS ${INSIMUL_SWIPL_ROOT}/bin NO_DEFAULT_PATH)
  if(NOT INSIMUL_SWIPL_EXE)
    message(FATAL_ERROR "no swipl executable under ${INSIMUL_SWIPL_ROOT}/bin")
  endif()

  execute_process(COMMAND ${INSIMUL_SWIPL_EXE} --dump-runtime-variables
                  OUTPUT_VARIABLE _swipl_vars
                  RESULT_VARIABLE _swipl_rc
                  ERROR_QUIET)
  if(NOT _swipl_rc EQUAL 0)
    message(FATAL_ERROR "${INSIMUL_SWIPL_EXE} --dump-runtime-variables failed")
  endif()

  # PLBASE — the runtime "home" tree (boot.prc + library/*.qlf). SWI resolves it at
  # run time, so it is baked into the port as INSIMUL_SWIPL_HOME and overridable
  # with SWI_HOME_DIR. This is gap G-02: libinsimul stops being one file.
  string(REGEX MATCH "PLBASE=\"([^\"]*)\"" _ "${_swipl_vars}")
  set(INSIMUL_SWIPL_HOME_DIR "${CMAKE_MATCH_1}")
  string(REGEX MATCH "PLLIBSWIPL=\"([^\"]*)\"" _ "${_swipl_vars}")
  set(INSIMUL_SWIPL_LIB "${CMAKE_MATCH_1}")
  string(REGEX MATCH "PLVERSION=\"([^\"]*)\"" _ "${_swipl_vars}")
  set(_swipl_ver_num "${CMAKE_MATCH_1}")
  string(REGEX MATCH "PLARCH=\"([^\"]*)\"" _ "${_swipl_vars}")
  set(INSIMUL_SWIPL_ARCH "${CMAKE_MATCH_1}")

  if(NOT INSIMUL_SWIPL_HOME_DIR OR NOT INSIMUL_SWIPL_LIB)
    message(FATAL_ERROR
      "could not read PLBASE/PLLIBSWIPL out of --dump-runtime-variables:\n${_swipl_vars}")
  endif()
  if(NOT EXISTS "${INSIMUL_SWIPL_LIB}")
    message(FATAL_ERROR "SWI-Prolog shared library not found: ${INSIMUL_SWIPL_LIB}")
  endif()

  set(INSIMUL_ENGINE_INCLUDE ${INSIMUL_SWIPL_HOME_DIR}/include)
  set(INSIMUL_ENGINE_LINK    ${INSIMUL_SWIPL_LIB})
  set(INSIMUL_ENGINE_DEFS    INSIMUL_SWIPL_HOME="${INSIMUL_SWIPL_HOME_DIR}")
endif()

# PLVERSION is MMmmpp as an integer (100001 -> 10.0.1).
math(EXPR _v_major "${_swipl_ver_num} / 10000")
math(EXPR _v_minor "(${_swipl_ver_num} / 100) % 100")
math(EXPR _v_patch "${_swipl_ver_num} % 100")
set(INSIMUL_SWIPL_VERSION "${_v_major}.${_v_minor}.${_v_patch}")

message(STATUS
  "SWI-Prolog: ${INSIMUL_SWIPL_VERSION} (${INSIMUL_SWIPL_COMMIT}) "
  "arch ${INSIMUL_SWIPL_ARCH} home ${INSIMUL_SWIPL_HOME_DIR}")

set(INSIMUL_ENGINE_SRC     ${CMAKE_CURRENT_SOURCE_DIR}/src/engine_swipl.c)
set(INSIMUL_ENGINE_VERSION_VALUE "${INSIMUL_SWIPL_VERSION}")
set(INSIMUL_ENGINE_COMMIT_VALUE  "${INSIMUL_SWIPL_COMMIT}")
