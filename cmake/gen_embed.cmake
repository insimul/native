# gen_embed.cmake — run at build time via `cmake -P` to embed one Trealla
# standard-library file as a C source. Replicates the Makefile rule:
#
#   library/%.c: library/%.pl util/bin2c
#       echo '#include <stddef.h>' > $@
#       ./util/bin2c $< >> $@
#
# bin2c derives the emitted C symbol name from its path argument (non-alnum ->
# '_'), so it is invoked as `library/<name>.pl` with the Trealla source root as
# the working directory. That yields symbols like `library_lists_pl` that match
# the externs in src/library.c.
#
# Required -D args: BIN2C, TREALLA_DIR, PL_NAME, OUT.
execute_process(
  COMMAND ${BIN2C} library/${PL_NAME}.pl
  WORKING_DIRECTORY ${TREALLA_DIR}
  OUTPUT_VARIABLE _body
  RESULT_VARIABLE _rc
)
if(NOT _rc EQUAL 0)
  message(FATAL_ERROR "bin2c failed for library/${PL_NAME}.pl (rc=${_rc})")
endif()
file(WRITE ${OUT} "#include <stddef.h>\n${_body}")
