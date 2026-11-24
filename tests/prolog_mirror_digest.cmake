# prolog_mirror_digest.cmake — the digest gate over the vendored Prolog corpus
# (conformance/prolog/), PL.native-prolog-mirror-full slice 1 (U120(9)).
#
# WHY: every conformance leg grades the mirror's ANSWERS, so a mirrored file whose
# bytes went stale while its answers stayed the same stays green on all three. That
# happened: a stale pack-agreement.json passed every leg (self-sweep M22), because
# nothing compared the mirror to core's bytes. This gate does.
#
# conformance/PROLOG_MIRROR.json records, against core's bytes at the commit
# corebridge/core-pin.json pins (`coreCommit`), the sha256 of every mirrored file
# (`files`) and the name of every core file NOT mirrored (`notMirrored`, empty since
# slice 5: the mirror holds all of core's files). The
# gate refuses (exit non-zero, every problem named) when:
#   - the manifest's coreCommit is not core-pin.json's coreCommit (the pin moved and
#     the mirror was not re-recorded);
#   - a file in conformance/prolog/ is not in `files` (an extra file), or a `files`
#     entry has no file (a missing one);
#   - a file's sha256 is not the recorded one (a hand-edit, or bytes from another
#     core commit);
#   - a name is both mirrored and listed as not mirrored;
#   - any name is listed as not mirrored (an incomplete mirror: slice 5 made the
#     mirror whole, so a core file new at a moved pin, or a reverted slice, is
#     refused until it is recorded with ADD=; slice 4's m1).
# With a core checkout it ALSO holds the record itself to core: core's
# conformance/prolog/ at coreCommit must hold exactly `files` + `notMirrored`, and
# every mirrored file's sha256 must be the sha256 of core's blob at that commit.
# The checkout is, in order: -DCORE_DIR=<path> (an empty -DCORE_DIR= turns the
# record checks off), env INSIMUL_CORE_DIR, else the monorepo's sibling core when it
# exists, found from the mirror's own path the way the corpus resolver finds its
# sibling: <native>/../babylon/packages/core (the insimul workspace), then
# <native>/../insimul-runtime/packages/core, a list kept once in
# prolog_mirror_sibling.cmake (slice 4). So a checkout inside the monorepo runs
# them by default (slice 2, settling slice 1's m1). A sibling that does not hold the
# pin's commit is named and set aside (fetch core there); an explicit one is used
# as given, so a missing commit there is refused. Without a core checkout the
# manifest is trusted as recorded — say so, never skip silently: the line printed
# names which check ran and where its core came from, or why none was used (no
# sibling holding the pin, a stale sibling, or the checks turned off by an empty
# -DCORE_DIR=; slice 3, settling slice 2's m2). CMakeLists.txt looks for the sibling
# itself at configure time and, when one holding the pin is there, requires the
# check to have used it and the negative to refuse 9 of 9 (slice 3, slice 2's m1).
#
# Modes (cmake -P, all paths absolute):
#   check     -DMIRROR_DIR=… -DMANIFEST=… -DPIN=… [-DCORE_DIR=…] [-DWORK_DIR=…]
#             [-DEXPECT_SIBLING=…] (CMakeLists.txt's configure-time sibling, for the
#             message when the run then has no core; it changes no verdict)
#   negative  -DMODE=negative -DMIRROR_DIR=… -DMANIFEST=… -DPIN=… [-DCORE_DIR=…] -DWORK_DIR=…
#             copies the mirror and perturbs it seven ways (a whitespace-only edit to
#             pack-agreement.json that every leg would still pass, an extra file, a
#             missing file, a renamed file, a pin that moved, a name both mirrored
#             and not, and a file moved from the mirror to `notMirrored`); passes
#             only when each perturbation is refused for its own named reason. With
#             a core checkout it adds two more (the whitespace edit with the record
#             hand-rewritten to match it, and a file dropped from the mirror and from
#             the whole record), which only core's objects can catch.
#   record    -DMODE=record -DMIRROR_DIR=… -DMANIFEST=… -DPIN=… [-DCORE_DIR=…]
#             [-DADD="a.json;b.json"] [-DWORK_DIR=…]
#             re-syncs the mirror FROM CORE'S GIT OBJECTS at the pin (never from the
#             mirror on disk, so a stale file cannot be recorded as current): copies
#             core's bytes for every name already in `files` plus ADD, and rewrites
#             the manifest. Then run the three legs and update conformance/VENDORED.md.
cmake_minimum_required(VERSION 3.24)

if(NOT DEFINED MODE)
  set(MODE check)
endif()
if(NOT DEFINED WORK_DIR)
  set(WORK_DIR "${CMAKE_CURRENT_BINARY_DIR}/prolog-mirror-digest")
endif()
foreach(v MIRROR_DIR MANIFEST PIN)
  if(NOT DEFINED ${v})
    message(FATAL_ERROR "prolog_mirror_digest: -D${v}=<path> is required")
  endif()
endforeach()

set(CORE_PATH "conformance/prolog")
include("${CMAKE_CURRENT_LIST_DIR}/prolog_mirror_sibling.cmake")

# Where the core checkout for the record checks comes from (see the header).
set(CORE_FROM "")
# Why there is no core checkout, for the PASS line when there is none.
set(CORE_NONE "no core checkout: no sibling core holding the pin; set INSIMUL_CORE_DIR to also hold the record to core's git objects")
if(DEFINED CORE_DIR)
  if(NOT CORE_DIR STREQUAL "")
    set(CORE_FROM "-DCORE_DIR")
  else()
    set(CORE_NONE "the record checks against core's git objects were turned off by an empty -DCORE_DIR=")
  endif()
elseif(DEFINED ENV{INSIMUL_CORE_DIR} AND NOT "$ENV{INSIMUL_CORE_DIR}" STREQUAL "")
  set(CORE_DIR "$ENV{INSIMUL_CORE_DIR}")
  set(CORE_FROM "INSIMUL_CORE_DIR")
else()
  set(CORE_DIR "")
  get_filename_component(_native "${MIRROR_DIR}/../.." ABSOLUTE)
  # The candidate list lives in prolog_mirror_sibling.cmake, which CMakeLists.txt
  # includes too, so the ctests require exactly the sibling this lookup uses.
  set(_pc "")
  if(EXISTS "${PIN}")
    file(READ "${PIN}" _pj)
    string(JSON _pc ERROR_VARIABLE _pe GET "${_pj}" coreCommit)
    if(_pe)
      set(_pc "")
    endif()
  endif()
  insimul_prolog_mirror_sibling("${_native}" "${_pc}" _c _holds)
  if(_c AND _holds)
    # The sibling is only used when it holds the pin's commit: a stale checkout
    # is named, never trusted and never a red the mirror did not earn.
    set(CORE_DIR "${_c}")
    set(CORE_FROM "the monorepo's sibling core")
  elseif(_c)
    message("prolog_mirror_digest: the sibling core ${_c} does not hold the pin's commit ${_pc}; "
            "the record checks need it there (git -C <core> fetch origin) or INSIMUL_CORE_DIR")
    set(CORE_NONE "no core checkout: the sibling core does not hold the pin's commit ${_pc}; fetch it there or set INSIMUL_CORE_DIR to also hold the record to core's git objects")
  endif()
endif()
# CMakeLists.txt passes -DEXPECT_SIBLING=<dir> to the digest ctests when it found a
# sibling holding the pin at configure time, so their regexes require the record
# checks. If this run then has no core (the sibling moved or went away after
# configure), say why here rather than leave only a bare regex mismatch (slice 4,
# slice 3's m1).
if(DEFINED EXPECT_SIBLING AND NOT EXPECT_SIBLING STREQUAL "" AND CORE_FROM STREQUAL "")
  message("prolog_mirror_digest: CMake found the sibling core ${EXPECT_SIBLING} holding the pin at "
          "configure time, but this run has none (${CORE_NONE}); the digest ctests require it: "
          "re-run cmake if the sibling moved or went away")
endif()

# The pin's coreCommit, or "" when the pin cannot be read.
function(read_pin pin out)
  set(c "")
  if(EXISTS "${pin}")
    file(READ "${pin}" pj)
    string(JSON c ERROR_VARIABLE e GET "${pj}" coreCommit)
    if(e)
      set(c "")
    endif()
  endif()
  set(${out} "${c}" PARENT_SCOPE)
endfunction()

# Sets <prefix>_COMMIT, <prefix>_NAMES (sorted), <prefix>_SHA_<name>, <prefix>_NOT
# (sorted) and <prefix>_ERR (non-empty when the manifest cannot be read).
macro(read_manifest manifest prefix)
  set(${prefix}_COMMIT "")
  set(${prefix}_NAMES "")
  set(${prefix}_NOT "")
  set(${prefix}_ERR "")
  if(NOT EXISTS "${manifest}")
    set(${prefix}_ERR "the manifest ${manifest} does not exist")
  else()
    file(READ "${manifest}" _mj)
    string(JSON ${prefix}_COMMIT ERROR_VARIABLE _e GET "${_mj}" coreCommit)
    if(_e)
      set(${prefix}_ERR "the manifest records no coreCommit")
    endif()
    string(JSON _n ERROR_VARIABLE _e LENGTH "${_mj}" files)
    if(_e OR _n EQUAL 0)
      set(${prefix}_ERR "the manifest records no `files`")
      set(_n 0)
    endif()
    if(_n GREATER 0)
      math(EXPR _last "${_n} - 1")
      foreach(_i RANGE ${_last})
        string(JSON _k MEMBER "${_mj}" files ${_i})
        string(JSON _v GET "${_mj}" files "${_k}")
        list(APPEND ${prefix}_NAMES "${_k}")
        set("${prefix}_SHA_${_k}" "${_v}")
      endforeach()
    endif()
    string(JSON _n ERROR_VARIABLE _e LENGTH "${_mj}" notMirrored)
    if(_e)
      set(${prefix}_ERR "the manifest records no `notMirrored` list (an empty list is stated as [])")
      set(_n 0)
    endif()
    if(_n GREATER 0)
      math(EXPR _last "${_n} - 1")
      foreach(_i RANGE ${_last})
        string(JSON _v GET "${_mj}" notMirrored ${_i})
        list(APPEND ${prefix}_NOT "${_v}")
      endforeach()
    endif()
    list(SORT ${prefix}_NAMES)
    list(SORT ${prefix}_NOT)
  endif()
endmacro()

# Core's file names under conformance/prolog/ at <commit> (sorted), or sets <err>.
function(core_names core commit out err)
  execute_process(COMMAND git -C "${core}" ls-tree --name-only "${commit}" "${CORE_PATH}/"
    OUTPUT_VARIABLE o ERROR_VARIABLE eo RESULT_VARIABLE r OUTPUT_STRIP_TRAILING_WHITESPACE)
  if(NOT r EQUAL 0 OR o STREQUAL "")
    set(${err} "core ${core} has no ${CORE_PATH}/ at ${commit} (git: ${eo})" PARENT_SCOPE)
    set(${out} "" PARENT_SCOPE)
    return()
  endif()
  string(REPLACE "\n" ";" lines "${o}")
  set(names "")
  foreach(l IN LISTS lines)
    get_filename_component(b "${l}" NAME)
    list(APPEND names "${b}")
  endforeach()
  list(SORT names)
  set(${out} "${names}" PARENT_SCOPE)
  set(${err} "" PARENT_SCOPE)
endfunction()

# Writes core's blob <commit>:conformance/prolog/<name> to <dest>; sets <ok>.
function(core_blob core commit name dest ok)
  execute_process(COMMAND git -C "${core}" cat-file blob "${commit}:${CORE_PATH}/${name}"
    OUTPUT_FILE "${dest}" RESULT_VARIABLE r ERROR_QUIET)
  if(r EQUAL 0)
    set(${ok} TRUE PARENT_SCOPE)
  else()
    set(${ok} FALSE PARENT_SCOPE)
  endif()
endfunction()

# The check itself. Appends one line per problem to <out>; sets <summary>.
function(check_mirror mirror manifest pin core out summary)
  set(problems "")
  read_manifest("${manifest}" M)
  if(M_ERR)
    set(${out} "${M_ERR}" PARENT_SCOPE)
    set(${summary} "" PARENT_SCOPE)
    return()
  endif()
  read_pin("${pin}" pinned)
  if(pinned STREQUAL "")
    list(APPEND problems "cannot read coreCommit from ${pin}")
  elseif(NOT M_COMMIT STREQUAL pinned)
    list(APPEND problems "stale record: the manifest was recorded at core ${M_COMMIT} but core-pin.json pins ${pinned}; re-record the mirror at the pin (MODE=record)")
  endif()

  file(GLOB on_disk RELATIVE "${mirror}" LIST_DIRECTORIES false "${mirror}/*")
  list(SORT on_disk)
  if(NOT EXISTS "${mirror}" OR on_disk STREQUAL "")
    list(APPEND problems "the mirror ${mirror} is missing or empty")
  endif()
  foreach(f IN LISTS on_disk)
    if(NOT f IN_LIST M_NAMES)
      list(APPEND problems "extra file: ${f} is in conformance/prolog/ but not in the manifest")
    endif()
  endforeach()
  foreach(f IN LISTS M_NAMES)
    if(NOT f IN_LIST on_disk)
      list(APPEND problems "missing file: the manifest records ${f}, which conformance/prolog/ does not hold")
    else()
      file(SHA256 "${mirror}/${f}" h)
      if(NOT h STREQUAL "${M_SHA_${f}}")
        list(APPEND problems "drift: ${f} is sha256 ${h}, the manifest records ${M_SHA_${f}} (core's bytes at ${M_COMMIT})")
      endif()
    endif()
    if(f IN_LIST M_NOT)
      list(APPEND problems "both: ${f} is recorded as mirrored and as not mirrored")
    endif()
  endforeach()

  # The mirror is complete (slice 5): every core file is mirrored, so a name left in
  # `notMirrored` (a core file new at a moved pin, or a slice reverted) is refused.
  foreach(f IN LISTS M_NOT)
    list(APPEND problems "incomplete mirror: ${f} is listed as not mirrored; the mirror holds every core file, so record it with -DADD=${f} (MODE=record)")
  endforeach()

  list(LENGTH M_NAMES nm)
  list(LENGTH M_NOT nn)
  set(against "the manifest as recorded (${CORE_NONE})")
  if(core)
    set(against "core's git objects at ${M_COMMIT} in ${core} (from ${CORE_FROM})")
    core_names("${core}" "${M_COMMIT}" cnames cerr)
    if(cerr)
      list(APPEND problems "${cerr}")
    else()
      set(stated ${M_NAMES} ${M_NOT})
      list(SORT stated)
      foreach(f IN LISTS cnames)
        if(NOT f IN_LIST stated)
          list(APPEND problems "unlisted core file: core holds ${CORE_PATH}/${f} at ${M_COMMIT}; the manifest neither mirrors it nor lists it as not mirrored")
        endif()
      endforeach()
      foreach(f IN LISTS stated)
        if(NOT f IN_LIST cnames)
          list(APPEND problems "not in core: the manifest names ${f}, which core does not hold at ${M_COMMIT}")
        endif()
      endforeach()
      file(MAKE_DIRECTORY "${WORK_DIR}")
      foreach(f IN LISTS M_NAMES)
        if(f IN_LIST cnames)
          core_blob("${core}" "${M_COMMIT}" "${f}" "${WORK_DIR}/core-blob" ok)
          file(SHA256 "${WORK_DIR}/core-blob" ch)
          if(NOT ok OR NOT ch STREQUAL "${M_SHA_${f}}")
            list(APPEND problems "record drift: core's ${f} at ${M_COMMIT} is sha256 ${ch}, the manifest records ${M_SHA_${f}}")
          endif()
        endif()
      endforeach()
      file(REMOVE "${WORK_DIR}/core-blob")
    endif()
  endif()
  set(${out} "${problems}" PARENT_SCOPE)
  set(${summary} "${nm} mirrored file(s) and ${nn} not-mirrored name(s) at core ${M_COMMIT}, held to ${against}" PARENT_SCOPE)
endfunction()

function(report_and_exit name problems summary)
  list(LENGTH problems np)
  if(np GREATER 0)
    message("prolog_mirror_digest: REFUSED (${np} problem(s)):")
    foreach(p IN LISTS problems)
      message("  - ${p}")
    endforeach()
    message(FATAL_ERROR "prolog_mirror_digest: the vendored Prolog corpus does not match its record (see conformance/VENDORED.md to re-sync)")
  endif()
  message("prolog_mirror_digest: ${summary}")
  message("prolog_mirror_digest: PASS")
endfunction()

# ---------------------------------------------------------------- check
if(MODE STREQUAL "check")
  check_mirror("${MIRROR_DIR}" "${MANIFEST}" "${PIN}" "${CORE_DIR}" problems summary)
  report_and_exit(check "${problems}" "${summary}")
  return()
endif()

# ---------------------------------------------------------------- negative
if(MODE STREQUAL "negative")
  # Run on the UNPERTURBED copy first: a negative control over a mirror that is
  # already red proves nothing.
  set(base "${WORK_DIR}/negative")
  file(REMOVE_RECURSE "${base}")
  file(MAKE_DIRECTORY "${base}")
  check_mirror("${MIRROR_DIR}" "${MANIFEST}" "${PIN}" "" p0 s0)
  if(p0)
    message(FATAL_ERROR "prolog_mirror_digest --negative: the unperturbed mirror is already refused: ${p0}")
  endif()
  read_manifest("${MANIFEST}" M)
  list(GET M_NAMES 0 first)
  list(GET M_NAMES 1 second)
  file(READ "${MANIFEST}" manifest_text)

  set(named 0)
  set(total 0)
  set(probes whitespace extra missing renamed pin both incomplete)
  if(CORE_DIR)
    # With a core checkout, two more: M22's shape with the record re-written by hand
    # to match the stale bytes (only core's git objects can catch it), and a core
    # file the record forgot.
    list(APPEND probes recorddrift unlisted)
  endif()
  foreach(probe IN LISTS probes)
    math(EXPR total "${total} + 1")
    set(d "${base}/${probe}")
    file(MAKE_DIRECTORY "${d}")
    file(COPY "${MIRROR_DIR}/" DESTINATION "${d}/prolog")
    set(man "${MANIFEST}")
    set(pin "${PIN}")
    if(probe STREQUAL "whitespace")
      # M22's shape: the bytes move, the answers do not, every leg stays green.
      set(target pack-agreement.json)
      if(NOT EXISTS "${d}/prolog/${target}")
        set(target "${first}")
      endif()
      file(APPEND "${d}/prolog/${target}" "\n")
      set(want "drift: ${target} is sha256")
    elseif(probe STREQUAL "extra")
      file(WRITE "${d}/prolog/zz-extra.json" "{\"area\":\"x\",\"cases\":[]}\n")
      set(want "extra file: zz-extra.json")
    elseif(probe STREQUAL "missing")
      file(REMOVE "${d}/prolog/${first}")
      set(want "missing file: the manifest records ${first}")
    elseif(probe STREQUAL "renamed")
      file(RENAME "${d}/prolog/${second}" "${d}/prolog/renamed-${second}")
      set(want "extra file: renamed-${second}")
    elseif(probe STREQUAL "pin")
      set(pin "${d}/core-pin.json")
      file(WRITE "${pin}" "{\"coreCommit\":\"0000000000000000000000000000000000000000\"}\n")
      set(want "stale record: the manifest was recorded at core ${M_COMMIT} but core-pin.json pins 0000000000000000000000000000000000000000")
    elseif(probe STREQUAL "both")
      set(man "${d}/PROLOG_MIRROR.json")
      string(JSON t SET "${manifest_text}" notMirrored 0 "\"${first}\"")
      file(WRITE "${man}" "${t}")
      set(want "both: ${first} is recorded as mirrored and as not mirrored")
    elseif(probe STREQUAL "incomplete")
      # A file taken out of the mirror and moved to `notMirrored`, the record
      # otherwise consistent: the shape of a slice reverted (slice 4's m1).
      file(REMOVE "${d}/prolog/${first}")
      set(man "${d}/PROLOG_MIRROR.json")
      string(JSON t REMOVE "${manifest_text}" files "${first}")
      string(JSON t SET "${t}" notMirrored 0 "\"${first}\"")
      file(WRITE "${man}" "${t}")
      set(want "incomplete mirror: ${first} is listed as not mirrored")
    elseif(probe STREQUAL "recorddrift")
      set(target pack-agreement.json)
      if(NOT EXISTS "${d}/prolog/${target}")
        set(target "${first}")
      endif()
      file(APPEND "${d}/prolog/${target}" "\n")
      file(SHA256 "${d}/prolog/${target}" h)
      set(man "${d}/PROLOG_MIRROR.json")
      string(JSON t SET "${manifest_text}" files "${target}" "\"${h}\"")
      file(WRITE "${man}" "${t}")
      set(want "record drift: core's ${target} at ${M_COMMIT} is sha256")
    elseif(probe STREQUAL "unlisted")
      # A file the record forgot entirely: out of the mirror and out of `files`,
      # and not listed as not mirrored. The mirror is consistent with its record,
      # so only core's names can see it. (Before slice 5 this dropped a name from
      # `notMirrored`, which is now empty.)
      file(REMOVE "${d}/prolog/${first}")
      set(man "${d}/PROLOG_MIRROR.json")
      string(JSON t REMOVE "${manifest_text}" files "${first}")
      file(WRITE "${man}" "${t}")
      set(want "unlisted core file: core holds ${CORE_PATH}/${first}")
    endif()
    set(probe_core "")
    if(probe STREQUAL "recorddrift" OR probe STREQUAL "unlisted")
      set(probe_core "${CORE_DIR}")
    endif()
    check_mirror("${d}/prolog" "${man}" "${pin}" "${probe_core}" p s)
    string(FIND "${p}" "${want}" at)
    if(at GREATER -1)
      math(EXPR named "${named} + 1")
      message("  [refused] ${probe}: ${want}")
    else()
      message("  [ACCEPTED] ${probe}: wanted a problem containing \"${want}\", got: ${p}")
    endif()
  endforeach()
  file(REMOVE_RECURSE "${base}")
  message("prolog_mirror_digest --negative: ${named} of ${total} perturbation(s) refused for their named reason")
  if(NOT named EQUAL total)
    message(FATAL_ERROR "prolog_mirror_digest --negative: a perturbation was accepted")
  endif()
  message("prolog_mirror_digest --negative: PASS")
  return()
endif()

# ---------------------------------------------------------------- record
if(MODE STREQUAL "record")
  if(NOT CORE_DIR)
    message(FATAL_ERROR "prolog_mirror_digest record: a core checkout is required (-DCORE_DIR=<a git checkout of @insimul/core>, INSIMUL_CORE_DIR, or the monorepo's sibling core holding the pin); the record is taken from core's git objects, never from the mirror")
  endif()
  read_pin("${PIN}" commit)
  if(commit STREQUAL "")
    message(FATAL_ERROR "prolog_mirror_digest record: cannot read coreCommit from ${PIN}")
  endif()
  set(keep "")
  if(EXISTS "${MANIFEST}")
    read_manifest("${MANIFEST}" M)
    set(keep ${M_NAMES})
  endif()
  list(APPEND keep ${ADD})
  list(REMOVE_DUPLICATES keep)
  list(SORT keep)
  core_names("${CORE_DIR}" "${commit}" cnames cerr)
  if(cerr)
    message(FATAL_ERROR "prolog_mirror_digest record: ${cerr}")
  endif()
  file(MAKE_DIRECTORY "${MIRROR_DIR}")
  set(files_json "")
  foreach(f IN LISTS keep)
    if(NOT f IN_LIST cnames)
      message(FATAL_ERROR "prolog_mirror_digest record: core holds no ${CORE_PATH}/${f} at ${commit}")
    endif()
    core_blob("${CORE_DIR}" "${commit}" "${f}" "${MIRROR_DIR}/${f}" ok)
    if(NOT ok)
      message(FATAL_ERROR "prolog_mirror_digest record: git could not read ${commit}:${CORE_PATH}/${f}")
    endif()
    file(SHA256 "${MIRROR_DIR}/${f}" h)
    if(files_json)
      string(APPEND files_json ",\n")
    endif()
    string(APPEND files_json "    \"${f}\": \"${h}\"")
  endforeach()
  file(GLOB on_disk RELATIVE "${MIRROR_DIR}" LIST_DIRECTORIES false "${MIRROR_DIR}/*")
  foreach(f IN LISTS on_disk)
    if(NOT f IN_LIST keep)
      message(FATAL_ERROR "prolog_mirror_digest record: ${MIRROR_DIR}/${f} is not a file being recorded; remove it or pass it in ADD")
    endif()
  endforeach()
  set(not_json "")
  foreach(f IN LISTS cnames)
    if(NOT f IN_LIST keep)
      if(not_json)
        string(APPEND not_json ",\n")
      endif()
      string(APPEND not_json "    \"${f}\"")
    endif()
  endforeach()
  set(desc "The digest record of conformance/prolog/, the vendored mirror of @insimul/core's conformance/prolog/. `files` is the sha256 of core's bytes at `coreCommit` (which must equal corebridge/core-pin.json's) for every mirrored file; `notMirrored` names every core file at that commit the mirror does not hold, and must be empty: the mirror holds all of core's files, and the prolog_mirror_digest ctest refuses a name there (a core file new at a moved pin) until it is recorded with ADD=. Written by tests/prolog_mirror_digest.cmake MODE=record from core's git objects, never by hand; the prolog_mirror_digest ctest refuses any drift.")
  if(not_json)
    set(not_block "[\n${not_json}\n  ]")
  else()
    set(not_block "[]")
  endif()
  file(WRITE "${MANIFEST}" "{\n  \"description\": \"${desc}\",\n  \"source\": \"@insimul/core ${CORE_PATH}/\",\n  \"coreCommit\": \"${commit}\",\n  \"files\": {\n${files_json}\n  },\n  \"notMirrored\": ${not_block}\n}\n")
  list(LENGTH keep nk)
  list(LENGTH cnames nc)
  message("prolog_mirror_digest record: ${nk} of core's ${nc} file(s) at ${commit} mirrored and recorded in ${MANIFEST}")
  if(not_json)
    message("prolog_mirror_digest record: WARNING: core holds file(s) the mirror does not (listed in notMirrored); the check refuses an incomplete mirror: re-run with them in -DADD=")
  endif()
  return()
endif()

message(FATAL_ERROR "prolog_mirror_digest: unknown MODE '${MODE}' (check | negative | record)")
