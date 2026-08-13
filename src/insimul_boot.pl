% insimul_boot.pl — bootstrap Prolog consulted into every insimul KB.
%
% This is the Prolog side of the insimul C ABI. The C layer (src/insimul.c)
% never inspects Trealla term structures directly; instead it drives these
% helper predicates, passing goals in as text and receiving results back
% through a temp file, one line per record:
%
%   SOL <json>     one solution's binding set (query)
%   ERR <class> <term>   a caught Prolog exception: an ISO error class token
%                  (existence_error, type_error, syntax_error, …) and the term
%                  itself as human-readable detail
%   OK             a successful mutation (assert/retract/consult)
%   NONE           retract matched no clause
%
% The <json> binding-set format is the contract the C#/C++/GDScript engine
% wrappers parse — see README.md "Binding-set JSON format". Everything here is
% per-KB: no shared/global state, no reliance on process stdout/stderr, so a
% host may run one KB per thread (Unity/Unreal requirement).
%
% All predicates are named with a '$insimul'/'$ij' prefix so they never
% collide with a consulted program's own predicates, and '$guard'/2 refuses any
% host term that mentions such a name, so the bridge is a boundary and not just
% a naming convention (US-2, leak L-15).
%
% ENGINE-NEUTRALITY (US-2). Everything the ABI hands a host is produced HERE, so
% this file is where "the ABI speaks ISO Prolog, not Trealla" is either true or
% false. Three rules keep it true:
%   1. flags the output depends on are PINNED below, never inherited;
%   2. every value is rendered by '$ij'/2 to a documented JSON shape — no
%      engine writer output reaches a host except as error *detail*;
%   3. every error record carries an ISO error CLASS (see '$err_class'/2), so a
%      consumer never has to string-match a vendor's exception text.

% --- pinned flags -----------------------------------------------------------
%
% These are insimul's decisions, not the engine's defaults, so a different
% engine underneath inherits them instead of re-rolling the dice (leak L-03).
% double_quotes: ISO says `codes`, SWI says `string`, Trealla and tau-prolog say
% `chars`; we pin `chars` — the value this corpus, its save images and every
% wrapper were built against. unknown: ISO's default, pinned because a consumer
% depends on it as control flow (leak L-04).
:- set_prolog_flag(double_quotes, chars).
:- set_prolog_flag(unknown, error).

% --- JSON serialization of a Prolog term to stream S ------------------------

'$ij_str'(S, A) :-
    ( atom(A) -> atom_chars(A, Cs) ; string(A) -> string_chars(A, Cs) ; Cs = [] ),
    write(S, '"'), '$ij_esc'(S, Cs), write(S, '"').
'$ij_esc'(_, []).
'$ij_esc'(S, [C|Cs]) :-
    char_code(C, X),
    ( X =:= 34 -> write(S, '\\"')
    ; X =:= 92 -> write(S, '\\\\')
    ; X =:= 10 -> write(S, '\\n')
    ; X =:= 9  -> write(S, '\\t')
    ; X =:= 13 -> write(S, '\\r')
    ; X =:= 8  -> write(S, '\\b')
    ; X =:= 12 -> write(S, '\\f')
    ; X < 32   -> '$ij_uesc'(S, X)      % RFC 8259: every C0 control must be escaped
    ; put_char(S, C) ),
    '$ij_esc'(S, Cs).

% \uXXXX for the remaining C0 controls (leak L-13: emitting them raw produced a
% document serde_json/System.Text.Json/JSON.parse are entitled to reject, from a
% call that reported success).
'$ij_uesc'(S, X) :-
    H is (X >> 4) /\ 15, L is X /\ 15,
    write(S, '\\u00'), '$ij_hex'(S, H), '$ij_hex'(S, L).
'$ij_hex'(S, N) :- ( N < 10 -> Code is 0'0 + N ; Code is 0'a + N - 10 ),
    char_code(C, Code), put_char(S, C).

% atoms -> strings, numbers -> numbers, lists -> arrays,
% compound terms -> {"functor":..,"args":[..]}, unbound vars -> null.
'$ij'(S, T) :- var(T), !, write(S, null).
'$ij'(S, T) :- integer(T), !, '$ij_int'(S, T).
'$ij'(S, T) :- float(T), !, '$ij_float'(S, T).
'$ij'(S, T) :- T == [], !, write(S, '[]').
'$ij'(S, T) :- is_list(T), !, write(S, '['), '$ij_list'(S, T), write(S, ']').
'$ij'(S, T) :- atom(T), !, '$ij_str'(S, T).
'$ij'(S, T) :- string(T), !, '$ij_str'(S, T).
'$ij'(S, T) :- compound(T), !, T =.. [F|As], '$ij_functor'(F, As, N),
    write(S, '{"functor":'), '$ij_str'(S, N), write(S, ',"args":['), '$ij_list'(S, As), write(S, ']}').
'$ij'(S, _) :- write(S, null).

% Integers (leak L-06). A JSON number is an IEEE-754 double to every consumer we
% have (serde_json's f64 path, JSON.parse, System.Text.Json), so an integer
% outside the exactly-representable range is emitted as {"bigint":"<digits>"} —
% lossless, and unmistakable for a compound (no "functor"/"args" keys). Whether
% such an integer can occur at all is the engine's business (bounded vs not);
% how it crosses the ABI is ours.
'$ij_int_max'(9007199254740991).        % 2^53 - 1
'$ij_int'(S, T) :-
    '$ij_int_max'(M), Min is -M,
    ( T >= Min, T =< M -> write(S, T)
    ; write(S, '{"bigint":"'), write(S, T), write(S, '"}') ).

% Floats. JSON has no infinity or NaN, so those become tagged objects rather
% than the bare `inf`/`nan` tokens a writer would emit (invalid JSON). The
% pinned engine raises evaluation_error instead of producing them; an engine
% that does not must still cross this ABI as valid JSON.
'$ij_float'(S, T) :-
    ( \+ T =:= T             -> write(S, '{"float":"nan"}')
    ; T >  1.7976931348623157e308 -> write(S, '{"float":"inf"}')
    ; T < -1.7976931348623157e308 -> write(S, '{"float":"-inf"}')
    ; write(S, T) ).

% The list-cons functor is engine-specific ('.' here and in ISO, '[|]' in
% SWI-Prolog 7+), and it reaches game code: a partial list [a|Y] surfaces as a
% compound. Normalise it to '.' so the name a host decodes is insimul's, not the
% engine's (leak L-14).
'$ij_functor'(F, [_,_], '.') :- '$ij_cons_name'(C), F == C, !.
'$ij_functor'(F, _, F).
'$ij_cons_name'(C) :- T = [a|b], T =.. [C|_].
'$ij_list'(_, []).
'$ij_list'(S, [H]) :- !, '$ij'(S, H).
'$ij_list'(S, [H|T]) :- '$ij'(S, H), write(S, ','), '$ij_list'(S, T).

% A solution's binding set: {"Var": <value>, ...}. Variables whose source name
% begins with '_' (anonymous / don't-care) are omitted, matching the toplevel.
'$ij_binds'(S, Vs) :- write(S, '{'), '$ij_binds_'(S, Vs, true), write(S, '}').
'$ij_binds_'(_, [], _).
'$ij_binds_'(S, [N=V|T], First) :-
    ( atom_chars(N, ['_'|_]) -> '$ij_binds_'(S, T, First)
    ; ( First == true -> true ; write(S, ',') ),
      '$ij_str'(S, N), write(S, ':'), '$ij'(S, V),
      '$ij_binds_'(S, T, false) ).

% Capture a binding set / error term as an atom (deterministic, no choicepoints
% escape — important because the query loop backtracks over solutions).
'$ij_atom'(Vs, Atom) :- with_output_to(atom(Atom), (current_output(S), '$ij_binds'(S, Vs))).
'$err_atom'(E, Atom) :- with_output_to(atom(Atom), write_term(E, [quoted(true)])).

% --- the neutral error surface (leaks L-08 / L-09 / L-10) -------------------
%
% An exception crosses the ABI as two things: a CLASS a host may branch on, and
% the term's text as detail. The class is drawn from ISO 7.12.2's fixed
% vocabulary, so it is the same token on any conforming engine — unlike the
% text, where the pinned engine, tau-prolog and SWI disagree on the wrapper, the
% predicate-indicator notation and the culprit for the very same goal.
%
% 'unknown' is the class of a throw/1 of anything that is not error/2: ISO does
% not name it, and inventing a token would imply a portability we do not have.
'$err_classes'([instantiation_error, type_error, domain_error, existence_error,
                permission_error, representation_error, evaluation_error,
                resource_error, syntax_error, system_error]).
'$err_class'(E, Class) :-
    ( nonvar(E), E = error(F, _), nonvar(F)
      -> ( compound(F) -> functor(F, N, _) ; N = F ),
         '$err_classes'(Cs),
         ( memberchk(N, Cs) -> Class = N ; Class = system_error )
    ;  Class = unknown ).

% The ISO context (error/2's second argument) is implementation-defined, so it
% is detail — but it must not name OUR internals: a host that asked to run
% 'foo(bar' was being told the error happened inside read_term_from_atom/3, a
% bootstrap predicate it has never heard of whose name changes when we
% refactor. Replace an internal (or unbound, which renders as _123) context with
% the ABI call that raised.
'$err_norm'(E, Op, E2) :-
    ( nonvar(E), E = error(F, C), '$err_ctx_internal'(C) -> E2 = error(F, Op) ; E2 = E ).
'$err_ctx_internal'(C) :- var(C), !.
'$err_ctx_internal'(N/_) :- atom(N), '$internal_ctx_name'(N), !.
'$err_ctx_internal'(C) :- compound(C), functor(C, N, _), '$internal_name'(N), !.
'$err_ctx_internal'(C) :- atom(C), '$internal_ctx_name'(C).
'$internal_ctx_name'(N) :- '$internal_name'(N), !.
'$internal_ctx_name'(read_term_from_atom).
'$internal_ctx_name'(read_term).
'$internal_ctx_name'(clause).
'$internal_ctx_name'(retract).
'$internal_name'(N) :- atom(N), atom_chars(N, ['$'|_]).

% The one place an exception becomes a record. Every op routes through here, so
% the ERR shape cannot drift between operations.
'$err_lines'(E, Op, ['ERR'-Text]) :-
    '$err_norm'(E, Op, E2),
    '$err_class'(E2, Class),
    '$err_atom'(E2, EA),
    atom_concat(Class, ' ', P),
    atom_concat(P, EA, Text).

% --- the bridge namespace is a boundary (leak L-15) -------------------------
%
% '$'-prefixed names are this file's own: '$insimul_snapshot'/1 takes a file
% path and '$snap_wipe'/0 erases the KB, and calling '$ij_str'(user_output, hi)
% from an ordinary host goal wrote to the process's stdout — the exact thing the
% per-KB result-file channel exists to prevent. The prefix stopped accidents; it
% was never a boundary. Now any host term that MENTIONS such a name — as a goal,
% inside a goal, as an asserted clause or as a consulted clause head — is
% refused with an ISO permission_error before it runs.
'$guard'(T, Op) :- '$guard_'(T, Op).
'$guard_'(T, _)  :- var(T), !.
'$guard_'(T, Op) :- atom(T), !, '$guard_name'(T, 0, Op).
'$guard_'(T, Op) :- compound(T), !,
    functor(T, N, A), '$guard_name'(N, A, Op),
    T =.. [_|As], '$guard_args'(As, Op).
'$guard_'(_, _).                    % numbers and strings mention no name
'$guard_args'([], _).
'$guard_args'([H|T], Op) :- '$guard_'(H, Op), '$guard_args'(T, Op).
'$guard_name'(N, A, Op) :-
    ( '$internal_name'(N)
      -> throw(error(permission_error(access, private_procedure, N/A), Op))
      ;  true ).

% --- result file writer -----------------------------------------------------

'$write_lines'(ResFile, Lines) :-
    setup_call_cleanup(open(ResFile, write, S), '$write_lines_'(S, Lines), close(S)).
'$write_lines_'(_, []).
'$write_lines_'(S, [Tag-Text|T]) :-
    write(S, Tag), write(S, ' '), write(S, Text), nl(S), '$write_lines_'(S, T).

% --- the operations the C ABI dispatches to ---------------------------------

% Query: enumerate every solution's binding set, or emit one ERR line.
'$insimul_query'(ResFile, GoalAtom) :-
    catch(
      ( read_term_from_atom(GoalAtom, Goal, [variable_names(Vs)]),
        '$guard'(Goal, insimul_query_start),
        findall('SOL'-J, ( call(Goal), '$ij_atom'(Vs, J) ), Lines) ),
      E, '$err_lines'(E, insimul_query_start, Lines)),
    '$write_lines'(ResFile, Lines).

% Assert a clause (undefined predicates are auto-created dynamic by assertz).
'$insimul_assert'(ResFile, GoalAtom) :-
    catch(
      ( read_term_from_atom(GoalAtom, Fact, []),
        '$guard'(Fact, insimul_kb_assert),
        assertz(Fact), Lines = ['OK'-''] ),
      E, '$err_lines'(E, insimul_kb_assert, Lines)),
    '$write_lines'(ResFile, Lines).

% Retract the first matching clause; NONE if nothing matched.
'$insimul_retract'(ResFile, GoalAtom) :-
    catch(
      ( read_term_from_atom(GoalAtom, Fact, []),
        '$guard'(Fact, insimul_kb_retract),
        ( retract(Fact) -> Lines = ['OK'-''] ; Lines = ['NONE'-''] ) ),
      E, '$err_lines'(E, insimul_kb_retract, Lines)),
    '$write_lines'(ResFile, Lines).

% Consult program text: read term-by-term so a syntax error surfaces as a
% catchable exception (Trealla's own consult/1 only warns to stderr, and its
% loader can't be captured per-KB). The load is transactional: directives
% (:- op/3, etc.) are executed as they are read so they affect later parsing,
% but clauses are only asserted once the WHOLE source has parsed cleanly. A
% syntax error therefore adds no clauses (directives run before the error are
% not undone — matching typical consult-failure semantics for these KBs, which
% use directives only for operator/flag setup, never to inspect clauses).
'$insimul_consult'(ResFile, SrcFile) :-
    catch(
      ( setup_call_cleanup(open(SrcFile, read, S),
          '$consult_collect'(S, insimul_kb_consult, Clauses), close(S)),
        '$consult_assert'(Clauses) ),
      E, Err = E),
    ( var(Err) -> Lines = ['OK'-''] ; '$err_lines'(Err, insimul_kb_consult, Lines) ),
    '$write_lines'(ResFile, Lines).
'$consult_collect'(S, Op, Clauses) :-
    read_term(S, T, []),
    ( T == end_of_file -> Clauses = []
    ; T = (:- D) -> '$guard'(D, Op), '$run_directive'(D, Op),
                    '$consult_collect'(S, Op, Clauses)
    ; '$guard'(T, Op), Clauses = [T|Rest], '$consult_collect'(S, Op, Rest) ).

% Directive failure is SPECIFIED, not inherited (leak L-12): a directive that
% raises or that simply fails FAILS THE WHOLE LOAD, with the reason. It used to
% be swallowed by a catch(_, _, true), so a KB whose ':- set_prolog_flag(...)'
% was misspelled loaded "successfully" and then behaved differently. Because the
% load is transactional, a rejected directive leaves no clauses behind (earlier
% directives are not undone — they are operator/flag setup and that is stated in
% insimul.h).
'$run_directive'(D, Op) :-
    ( catch('$consult_directive'(D), E, true) -> true
    ; E = error(directive_failed(D), Op) ),
    ( nonvar(E) -> throw(E) ; true ).

% Directives are normally just called. dynamic/1 is the exception: in Trealla it
% exists only as a *loader* directive, so calling it as a goal throws
% existence_error — a read_term consult loop has to honour it itself, or a KB
% that declares a predicate it never asserts into (the KINP corpus does this for
% same_as/3 and world_parent/2) raises existence_error on the first call instead
% of failing, which is what the declaration exists to prevent.
'$consult_directive'(dynamic(PI)) :- !, '$declare_dynamic'(PI).
'$consult_directive'(D) :- call(D).

% assertz/1 auto-creates an undefined predicate as dynamic, so asserting a
% fresh-variable head and immediately retracting it leaves the predicate defined,
% dynamic and clause-free — exactly what ':- dynamic(N/A).' means. asserta (not
% assertz) puts our placeholder FIRST, so the following retract can only remove
% that placeholder, never a real clause of an already-populated predicate.
'$declare_dynamic'(V)      :- var(V), !, throw(error(instantiation_error, dynamic/1)).
'$declare_dynamic'((A, B)) :- !, '$declare_dynamic'(A), '$declare_dynamic'(B).
'$declare_dynamic'([])     :- !.
'$declare_dynamic'([H|T])  :- !, '$declare_dynamic'(H), '$declare_dynamic'(T).
'$declare_dynamic'(N/A)    :- !, functor(H, N, A), asserta(H), retract(H).
'$declare_dynamic'(PI)     :- throw(error(type_error(predicate_indicator, PI), dynamic/1)).

'$consult_assert'([]).
'$consult_assert'([C|Cs]) :- assertz(C), '$consult_assert'(Cs).

% --- snapshot / restore (US-LI4: the bridge to save.currentState.prologFacts) --
%
% A snapshot is the KB's dynamic clause set (every fact/rule the host consulted or
% asserted) rendered as canonical Prolog text — one clause per line, terminated by
% '.'. It is DETERMINISTIC: predicates are emitted in the standard order of their
% Name/Arity indicators, and clauses within a predicate in assert order (clause/2's
% order), so the same logical state always serializes byte-for-byte identically.
% The bootstrap's own '$'-prefixed helpers are loaded static (not dynamic) and are
% additionally filtered out, so they never leak into a snapshot.
%
% The text is written with quoted(true) + numbervars(true) after copy_term +
% numbervars, so it is BOTH re-readable by this engine (restore) AND parseable by
% the TypeScript prolog-fact-parser.ts (single-quoted atoms, A/B/C variables,
% one clause per line ending in '.').

% Dynamic user predicates, as a sorted (dedup'd, deterministic) N/A list.
'$snap_preds'(Ps) :-
    findall(N/A,
      ( current_predicate(N/A),
        \+ '$internal_name'(N),
        functor(H, N, A),
        predicate_property(H, dynamic) ),
      Ps0),
    sort(Ps0, Ps).

'$snap_write_all'(_, []).
'$snap_write_all'(S, [P|Ps]) :- '$snap_write'(S, P), '$snap_write_all'(S, Ps).

'$snap_write'(S, N/A) :-
    functor(H, N, A),
    forall(clause(H, B), '$snap_write_clause'(S, H, B)).

% A fact (Body == true) writes just its head; a rule writes 'Head :- Body'. Vars
% are numbervar'd on a COPY so the stored clause is untouched and names render as
% A, B, C … deterministically.
'$snap_write_clause'(S, H, true) :- !, '$snap_term'(S, H).
'$snap_write_clause'(S, H, B) :- '$snap_term'(S, (H :- B)).
% The write_term option list is COMPLETE on purpose (leak L-16): every option
% that changes a byte of the image is stated here rather than inherited from the
% engine's defaults, and the flags the writer reads (double_quotes) are pinned at
% the top of this file. What is still the engine's — operator spacing, how a
% float is re-rendered — is named in insimul.h and locked down by the golden
% images in tests/snapshot.c, so a change to it is a red test, not a surprise in
% someone's save file.
'$snap_term'(S, T0) :-
    copy_term(T0, T),
    numbervars(T, 0, _),
    write_term(S, T, [quoted(true), numbervars(true), ignore_ops(false)]),
    write(S, '.'), nl(S).

% Build the whole image as an atom (so a mid-serialization error can be reported
% cleanly, before any status byte is written to the result file).
'$snap_image'(Img) :-
    with_output_to(atom(Img),
      ( current_output(S), '$snap_preds'(Ps), '$snap_write_all'(S, Ps) )).

% Result file for snapshot: line 1 is the status ('OK' or 'ERR <term>'); on OK the
% image text follows from line 2 on. (The other ops tag every record; snapshot's
% payload is multi-line Prolog, so only the FIRST line is a tag.)
'$insimul_snapshot'(ResFile) :-
    catch('$snap_image'(Img), E, Err = E),
    setup_call_cleanup(open(ResFile, write, S),
      ( nonvar(Err)
        -> '$err_lines'(Err, insimul_kb_snapshot, ['ERR'-Text]),
           write(S, 'ERR '), write(S, Text), nl(S)
        ;  write(S, 'OK'), nl(S), write(S, Img) ),
      close(S)).

% Restore REPLACES the dynamic state: the image is parsed first (a malformed image
% leaves the KB untouched), then every current dynamic user predicate is wiped, then
% the image's clauses are asserted in file order (preserving clause order).
'$snap_wipe' :-
    '$snap_preds'(Ps), '$snap_wipe_'(Ps).
'$snap_wipe_'([]).
'$snap_wipe_'([N/A|Ps]) :- functor(H, N, A), retractall(H), '$snap_wipe_'(Ps).

'$insimul_restore'(ResFile, SrcFile) :-
    catch(
      ( setup_call_cleanup(open(SrcFile, read, S),
          '$consult_collect'(S, insimul_kb_restore, Clauses), close(S)),
        '$snap_wipe', '$consult_assert'(Clauses) ),
      E, Err = E),
    ( var(Err) -> Lines = ['OK'-''] ; '$err_lines'(Err, insimul_kb_restore, Lines) ),
    '$write_lines'(ResFile, Lines).
