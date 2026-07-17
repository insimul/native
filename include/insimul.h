#ifndef INSIMUL_H
#define INSIMUL_H

/*
 * insimul.h — the stable C ABI for libinsimul, the shared native Prolog core
 * used by the Unreal, Unity, and Godot engine plugins.
 *
 * SCOPE (US-LI1): this is the skeleton. The library builds (static + shared)
 * and a ctest smoke test drives a real query through the embedded Trealla
 * Prolog engine. The full, documented ABI — KB lifecycle, consult,
 * assert/retract, and the JSON binding-set query iterator — lands in US-LI2 and
 * will be added here.
 *
 * INVARIANT (holds from US-LI2 onward): this header MUST NOT include any Trealla
 * headers and MUST NOT leak Trealla types. The engine is an implementation
 * detail behind an opaque, extern "C" boundary so the same ABI can back a
 * different engine later without breaking the wrappers.
 *
 * THREAD MODEL: one KB instance is owned by one thread; there is no global
 * mutable state shared across KBs. This is required for Unity/Unreal usage.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* ABI declarations arrive in US-LI2. */

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* INSIMUL_H */
