# prolog_mirror_sibling.cmake — the ONE lookup of the monorepo's sibling core for
# the Prolog mirror's digest (PL.native-prolog-mirror-full slice 4, settling slice
# 3's m1).
#
# Both callers include this file: tests/prolog_mirror_digest.cmake (cmake -P, its
# default record checks) and CMakeLists.txt (configure time, to decide whether the
# digest ctests must show those checks ran). Before slice 4 each carried its own
# copy of the candidate list, so a location added to the script alone would have
# been used by the script but never required by the ctests. Add a location here
# and both see it.
#
# insimul_prolog_mirror_sibling(<native_dir> <pin_commit> <out_dir> <out_holds>)
#   <native_dir>  the native checkout the candidates are relative to.
#   <pin_commit>  corebridge/core-pin.json's coreCommit ("" when unreadable).
#   <out_dir>     set to the first candidate that is a git checkout holding
#                 conformance/prolog, or "" when there is none. Only the first
#                 such candidate counts: a later one is never tried.
#   <out_holds>   TRUE when <out_dir> holds <pin_commit> as a commit, else FALSE.
function(insimul_prolog_mirror_sibling native pin out_dir out_holds)
  set(_dir "")
  set(_holds FALSE)
  # The candidates, in order: the insimul workspace, then the insimul-runtime
  # submodule layout.
  foreach(_rel "../babylon/packages/core" "../insimul-runtime/packages/core")
    get_filename_component(_c "${native}/${_rel}" ABSOLUTE)
    if(EXISTS "${_c}/.git" AND EXISTS "${_c}/conformance/prolog")
      set(_dir "${_c}")
      if(NOT pin STREQUAL "")
        execute_process(COMMAND git -C "${_c}" cat-file -e "${pin}^{commit}"
          RESULT_VARIABLE _r OUTPUT_QUIET ERROR_QUIET)
        if(_r EQUAL 0)
          set(_holds TRUE)
        endif()
      endif()
      break()
    endif()
  endforeach()
  set(${out_dir} "${_dir}" PARENT_SCOPE)
  set(${out_holds} ${_holds} PARENT_SCOPE)
endfunction()
