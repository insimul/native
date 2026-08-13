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
#
# Everything is read from `swipl --dump-runtime-variables`, SWI's own answer to
# "where did I install myself", so this cannot drift from the tree that was built.

set(INSIMUL_SWIPL_ROOT "" CACHE PATH
    "Install prefix of the SWI-Prolog built by scripts/build_swipl.sh")

if(NOT INSIMUL_SWIPL_ROOT)
  message(FATAL_ERROR
    "INSIMUL_ENGINE=swipl needs -DINSIMUL_SWIPL_ROOT=<prefix>.\n"
    "Build one first:  scripts/build_swipl.sh\n"
    "which prints the prefix to pass here.")
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
set(INSIMUL_SWIPL_HOME "${CMAKE_MATCH_1}")
string(REGEX MATCH "PLLIBSWIPL=\"([^\"]*)\"" _ "${_swipl_vars}")
set(INSIMUL_SWIPL_LIB "${CMAKE_MATCH_1}")
string(REGEX MATCH "PLVERSION=\"([^\"]*)\"" _ "${_swipl_vars}")
set(_swipl_ver_num "${CMAKE_MATCH_1}")
string(REGEX MATCH "PLARCH=\"([^\"]*)\"" _ "${_swipl_vars}")
set(INSIMUL_SWIPL_ARCH "${CMAKE_MATCH_1}")

if(NOT INSIMUL_SWIPL_HOME OR NOT INSIMUL_SWIPL_LIB)
  message(FATAL_ERROR
    "could not read PLBASE/PLLIBSWIPL out of --dump-runtime-variables:\n${_swipl_vars}")
endif()
if(NOT EXISTS "${INSIMUL_SWIPL_LIB}")
  message(FATAL_ERROR "SWI-Prolog shared library not found: ${INSIMUL_SWIPL_LIB}")
endif()

# PLVERSION is MMmmpp as an integer (100001 -> 10.0.1).
math(EXPR _v_major "${_swipl_ver_num} / 10000")
math(EXPR _v_minor "(${_swipl_ver_num} / 100) % 100")
math(EXPR _v_patch "${_swipl_ver_num} % 100")
set(INSIMUL_SWIPL_VERSION "${_v_major}.${_v_minor}.${_v_patch}")

# The commit that produced this prefix, recorded by scripts/build_swipl.sh next
# to the install so the version stamp names bytes, not a wish.
set(INSIMUL_SWIPL_COMMIT "unknown")
if(EXISTS "${INSIMUL_SWIPL_ROOT}/INSIMUL_SWIPL_PIN")
  file(STRINGS "${INSIMUL_SWIPL_ROOT}/INSIMUL_SWIPL_PIN" _pin_lines)
  foreach(_l ${_pin_lines})
    if(_l MATCHES "^commit=(.*)$")
      set(INSIMUL_SWIPL_COMMIT "${CMAKE_MATCH_1}")
    endif()
  endforeach()
endif()

message(STATUS
  "SWI-Prolog: ${INSIMUL_SWIPL_VERSION} (${INSIMUL_SWIPL_COMMIT}) "
  "arch ${INSIMUL_SWIPL_ARCH} home ${INSIMUL_SWIPL_HOME}")

set(INSIMUL_ENGINE_SRC     ${CMAKE_CURRENT_SOURCE_DIR}/src/engine_swipl.c)
set(INSIMUL_ENGINE_INCLUDE ${INSIMUL_SWIPL_HOME}/include)
set(INSIMUL_ENGINE_LINK    ${INSIMUL_SWIPL_LIB})
set(INSIMUL_ENGINE_DEFS    INSIMUL_SWIPL_HOME="${INSIMUL_SWIPL_HOME}")
set(INSIMUL_ENGINE_VERSION_VALUE "${INSIMUL_SWIPL_VERSION}")
set(INSIMUL_ENGINE_COMMIT_VALUE  "${INSIMUL_SWIPL_COMMIT}")
