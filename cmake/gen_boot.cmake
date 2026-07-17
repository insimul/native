# gen_boot.cmake — embed a text file as a NUL-terminated C byte array.
#
# Invoked at build time by CMakeLists.txt:
#   cmake -DIN=<file> -DOUT=<file.c> -DVAR=<symbol> -P gen_boot.cmake
#
# Produces a C translation unit defining
#   const unsigned char <VAR>[]     (the file bytes, NUL-terminated)
#   const unsigned long  <VAR>_len  (byte count, excluding the NUL)
# so src/insimul.c can fmemopen() the bootstrap Prolog with no on-disk path.
# Deterministic (byte-exact), unlike Trealla's bin2c whose symbol name depends
# on the input path.

file(READ ${IN} _hex HEX)
string(LENGTH ${_hex} _hexlen)
math(EXPR _n "${_hexlen} / 2")
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," _body "${_hex}")

file(WRITE ${OUT}
"/* Generated from ${IN} by cmake/gen_boot.cmake — do not edit. */\n"
"const unsigned char ${VAR}[] = {\n"
"${_body} 0x00\n"
"};\n"
"const unsigned long ${VAR}_len = ${_n}UL;\n")
