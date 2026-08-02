/*
 * insimul-api.mjs — the JS face of the libinsimul C ABI (include/insimul.h),
 * running on the Emscripten/WebAssembly build.
 *
 * This is hand-written and engine-agnostic: it takes an already-instantiated
 * Emscripten module (the generated `insimul.mjs` glue) and turns the twelve raw
 * C entry points into JS objects that cannot leak. It contains no Prolog
 * knowledge and no Trealla knowledge — same opacity rule as insimul.h.
 *
 *   import createInsimul from './insimul.mjs';        // generated glue
 *   import { loadInsimul } from './insimul-api.mjs';  // this file
 *
 *   const insimul = await loadInsimul(createInsimul);
 *   const kb = insimul.createKb();
 *   kb.consult('parent(tom, bob).\nparent(bob, ann).\n' +
 *              'grandparent(X, Z) :- parent(X, Y), parent(Y, Z).');
 *   for (const sol of kb.solutions('grandparent(tom, Who)')) console.log(sol.Who);
 *   kb.destroy();
 *
 * ============================ OWNERSHIP RULES ==============================
 *
 * WebAssembly has no destructors and no finalizers we can rely on, so every
 * pointer this ABI hands out is owned explicitly. Three kinds cross the
 * boundary, and each is handled here so callers never see a raw pointer:
 *
 * 1. HANDLES (insimul_kb *, insimul_query *) are opaque integers into the wasm
 *    heap. They must be released — `insimul_kb_destroy` / `insimul_query_stop`
 *    — or the module's memory grows without bound. `Kb`/`Query` below own
 *    exactly one handle each, null it on release, and throw on use-after-free.
 *    `kb.solutions()` is a generator wrapped in try/finally so the query handle
 *    is stopped even if the consumer `break`s out of the loop or throws.
 *
 * 2. BORROWED STRINGS (`const char *` from insimul_query_next,
 *    insimul_last_error, insimul_kb_snapshot) are owned by the object they came
 *    from and are invalidated by the next call on that object. We `UTF8ToString`
 *    them into JS strings IMMEDIATELY, at the call site, and never store the
 *    pointer. That is exactly insimul.h's "callers copy anything they need to
 *    keep; they never free a returned pointer". `insimul_version()` is static
 *    and needs no copy, but is treated the same way for uniformity.
 *
 * 3. ARGUMENT STRINGS going the other way are malloc'd on the wasm heap and
 *    freed in a finally block (see `withCString`). We deliberately do NOT use
 *    Emscripten's `ccall(..., 'string', ...)` marshalling for these: it copies
 *    onto the wasm STACK, and a snapshot image or a large consult source is
 *    easily big enough to blow it.
 *
 * THREADS: the wasm build is single-threaded on purpose (no SharedArrayBuffer
 * requirement — see cmake/wasm.cmake). One module instance, N KBs, one thread.
 */

/**
 * Instantiate the wasm module and wrap it.
 *
 * @param {Function} moduleFactory the default export of the generated
 *   `insimul.mjs` glue (a `-sMODULARIZE=1 -sEXPORT_ES6=1` factory).
 * @param {object} [moduleOptions] passed straight through to the factory (e.g.
 *   `{ locateFile }` when the .wasm is served from a different path).
 * @returns {Promise<Insimul>}
 */
export async function loadInsimul(moduleFactory, moduleOptions = {}) {
  return new Insimul(await moduleFactory(moduleOptions));
}

/** Thrown when the ABI reports failure; `.message` is insimul_last_error(). */
export class InsimulError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsimulError';
  }
}

export class Insimul {
  /** @param {object} module an instantiated Emscripten module. */
  constructor(module) {
    this.module = module;
    this._keepalive = null;

    const c = (name, ret, args) => module.cwrap(name, ret, args);
    this._fn = {
      kbCreate:   c('insimul_kb_create',   'number', []),
      kbDestroy:  c('insimul_kb_destroy',  null,     ['number']),
      kbConsult:  c('insimul_kb_consult',  'number', ['number', 'number']),
      kbAssert:   c('insimul_kb_assert',   'number', ['number', 'number']),
      kbRetract:  c('insimul_kb_retract',  'number', ['number', 'number']),
      queryStart: c('insimul_query_start', 'number', ['number', 'number']),
      queryNext:  c('insimul_query_next',  'number', ['number']),
      queryStop:  c('insimul_query_stop',  null,     ['number']),
      kbSnapshot: c('insimul_kb_snapshot', 'number', ['number']),
      kbRestore:  c('insimul_kb_restore',  'number', ['number', 'number']),
      lastError:  c('insimul_last_error',  'number', ['number']),
      version:    c('insimul_version',     'number', []),
    };
  }

  /** The build stamp: "insimul <semver> (git <sha>, trealla <tag>/<commit>)". */
  version() {
    return this.module.UTF8ToString(this._fn.version());
  }

  /**
   * Create a knowledge base.
   *
   * Note the hidden first KB: Trealla tears down its process-global symbol
   * table when the LAST prolog instance is destroyed, and re-initialising it
   * afterwards deadlocks (see CLAUDE.md "Trealla gotchas"). So the first
   * createKb() also opens an internal keepalive KB that is never destroyed,
   * which keeps that global refcount above zero for the life of the module.
   * Callers can then create and destroy KBs freely. It costs one empty KB.
   */
  createKb() {
    if (this._keepalive === null) {
      const ka = this._fn.kbCreate();
      if (!ka) throw new InsimulError('insimul_kb_create() failed (keepalive)');
      this._keepalive = ka;
    }
    const handle = this._fn.kbCreate();
    if (!handle) throw new InsimulError('insimul_kb_create() failed');
    return new Kb(this, handle);
  }

  /** Copy a JS string onto the wasm heap, run `body(ptr)`, always free. */
  _withCString(str, body) {
    const ptr = this.module.stringToNewUTF8(str);
    if (!ptr) throw new InsimulError('out of wasm memory marshalling a string');
    try {
      return body(ptr);
    } finally {
      this.module._free(ptr);
    }
  }
}

export class Kb {
  constructor(insimul, handle) {
    this._insimul = insimul;
    this._handle = handle;
  }

  get closed() {
    return this._handle === null;
  }

  _h() {
    if (this._handle === null) throw new InsimulError('KB has been destroyed');
    return this._handle;
  }

  /** insimul_last_error(kb) — the message for the most recent failure, or null. */
  lastError() {
    const ptr = this._insimul._fn.lastError(this._h());
    return ptr ? this._insimul.module.UTF8ToString(ptr) : null;
  }

  _check(rc) {
    if (rc !== 0) throw new InsimulError(this.lastError() ?? 'unknown insimul error');
    return rc;
  }

  /** Load Prolog program text. Throws InsimulError on a syntax error (nothing is loaded). */
  consult(source) {
    const { _fn } = this._insimul;
    return this._check(
      this._insimul._withCString(source, (p) => _fn.kbConsult(this._h(), p)));
  }

  /** Assert one clause given as term text WITHOUT a trailing full stop. */
  assert(fact) {
    const { _fn } = this._insimul;
    return this._check(
      this._insimul._withCString(fact, (p) => _fn.kbAssert(this._h(), p)));
  }

  /**
   * Retract the first clause unifying with `fact` (term text, no full stop).
   * @returns {boolean} true if a clause was removed, false if none matched.
   */
  retract(fact) {
    const { _fn } = this._insimul;
    const rc = this._insimul._withCString(fact, (p) => _fn.kbRetract(this._h(), p));
    if (rc < 0) throw new InsimulError(this.lastError() ?? 'unknown insimul error');
    return rc === 0;
  }

  /**
   * Start a query. Returns a Query the caller MUST stop() — prefer
   * `solutions()`, which does it for you.
   */
  query(goal) {
    const { _fn } = this._insimul;
    const q = this._insimul._withCString(goal, (p) => _fn.queryStart(this._h(), p));
    if (!q) throw new InsimulError(this.lastError() ?? 'query failed to start');
    return new Query(this._insimul, q);
  }

  /**
   * Iterate a goal's solutions as parsed binding-set objects. The query handle
   * is released when iteration finishes, breaks, or throws.
   * @returns {Generator<object>}
   */
  *solutions(goal) {
    const q = this.query(goal);
    try {
      yield* q;
    } finally {
      q.stop();
    }
  }

  /** Serialize the dynamic clause set as canonical Prolog text. */
  snapshot() {
    const ptr = this._insimul._fn.kbSnapshot(this._h());
    if (!ptr) throw new InsimulError(this.lastError() ?? 'snapshot failed');
    // Copy now: the KB owns this buffer and reuses it on the next snapshot.
    return this._insimul.module.UTF8ToString(ptr);
  }

  /** Replace the dynamic state from a snapshot image. */
  restore(image) {
    const { _fn } = this._insimul;
    return this._check(
      this._insimul._withCString(image, (p) => _fn.kbRestore(this._h(), p)));
  }

  /** Release the KB. Idempotent; the handle is invalid afterwards. */
  destroy() {
    if (this._handle === null) return;
    this._insimul._fn.kbDestroy(this._handle);
    this._handle = null;
  }
}

export class Query {
  constructor(insimul, handle) {
    this._insimul = insimul;
    this._handle = handle;
  }

  /**
   * The next solution as the ABI's own JSON TEXT, or null when exhausted.
   *
   * insimul_query_next returns a `const char *` the QUERY owns; it is
   * invalidated by the following next()/stop(). We copy it into a JS string
   * here, at the call site, so no borrowed pointer ever escapes this method.
   *
   * Most callers want next(); this exists for the conformance harness, which
   * compares the engine's byte-level output against the native leg's.
   */
  nextRaw() {
    if (this._handle === null) throw new InsimulError('query has been stopped');
    const ptr = this._insimul._fn.queryNext(this._handle);
    if (!ptr) return null;
    return this._insimul.module.UTF8ToString(ptr);
  }

  /** The next binding set as a plain object, or null when exhausted. */
  next() {
    const s = this.nextRaw();
    return s === null ? null : JSON.parse(s);
  }

  /** Release the query handle. Idempotent. */
  stop() {
    if (this._handle === null) return;
    this._insimul._fn.queryStop(this._handle);
    this._handle = null;
  }

  *[Symbol.iterator]() {
    for (let s = this.next(); s !== null; s = this.next()) yield s;
  }
}
