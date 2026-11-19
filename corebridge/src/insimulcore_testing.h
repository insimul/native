/*
 * insimulcore_testing.h — INTERNAL views for this repository's own tests.
 *
 * Not part of the ABI: never installed, never shipped beside insimulcore.h, and
 * no engine plugin may include it. It exists so tests/prolog_engine_cases.c can
 * evaluate corebridge/js/host-prolog-engine.js inside a real runtime, against the
 * real __insimul_prolog_* globals, and read the KB table those globals keep
 * (PL.native-consult-floor-leak). A pure consumer of the library uses
 * insimulcore.h alone.
 */
#ifndef INSIMULCORE_TESTING_H
#define INSIMULCORE_TESTING_H

#include "insimulcore.h"
#include "quickjs.h"

/* The handle's QuickJS context (the bundle is already evaluated in it). */
JSContext *insimulcore_testing_context(insimul_core *core);

/* Slots the handle's KB table has ever used (live KBs plus reusable holes). */
int insimulcore_testing_kb_slots(const insimul_core *core);

/* KBs currently alive in the handle's table. */
int insimulcore_testing_kb_live(const insimul_core *core);

#endif /* INSIMULCORE_TESTING_H */
