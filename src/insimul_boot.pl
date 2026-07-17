% insimul_boot.pl — bootstrap Prolog consulted into every insimul KB.
%
% This is the Prolog side of the insimul C ABI. The C layer (src/insimul.c)
% never inspects Trealla term structures directly; instead it drives these
% helper predicates, passing goals in as text and receiving results back
% through a temp file, one line per record:
%
%   SOL <json>     one solution's binding set (query)
%   ERR <term>     a caught Prolog exception (any op)
%   OK             a successful mutation (assert/retract/consult)
%   NONE           retract matched no clause
%
% The <json> binding-set format is the contract the C#/C++/GDScript engine
% wrappers parse — see README.md "Binding-set JSON format". Everything here is
% per-KB: no shared/global state, no reliance on process stdout/stderr, so a
% host may run one KB per thread (Unity/Unreal requirement).
%
% All predicates are named with a '$insimul'/'$ij' prefix so they never
% collide with a consulted program's own predicates.

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
    ; put_char(S, C) ),
    '$ij_esc'(S, Cs).

% atoms -> strings, numbers -> numbers, lists -> arrays,
% compound terms -> {"functor":..,"args":[..]}, unbound vars -> null.
'$ij'(S, T) :- var(T), !, write(S, null).
'$ij'(S, T) :- integer(T), !, write(S, T).
'$ij'(S, T) :- float(T), !, write(S, T).
'$ij'(S, T) :- T == [], !, write(S, '[]').
'$ij'(S, T) :- is_list(T), !, write(S, '['), '$ij_list'(S, T), write(S, ']').
'$ij'(S, T) :- atom(T), !, '$ij_str'(S, T).
'$ij'(S, T) :- string(T), !, '$ij_str'(S, T).
'$ij'(S, T) :- compound(T), !, T =.. [F|As],
    write(S, '{"functor":'), '$ij_str'(S, F), write(S, ',"args":['), '$ij_list'(S, As), write(S, ']}').
'$ij'(S, _) :- write(S, null).
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
        findall('SOL'-J, ( call(Goal), '$ij_atom'(Vs, J) ), Lines) ),
      E, ( '$err_atom'(E, EA), Lines = ['ERR'-EA] )),
    '$write_lines'(ResFile, Lines).

% Assert a clause (undefined predicates are auto-created dynamic by assertz).
'$insimul_assert'(ResFile, GoalAtom) :-
    catch(
      ( read_term_from_atom(GoalAtom, Fact, []), assertz(Fact), Lines = ['OK'-''] ),
      E, ( '$err_atom'(E, EA), Lines = ['ERR'-EA] )),
    '$write_lines'(ResFile, Lines).

% Retract the first matching clause; NONE if nothing matched.
'$insimul_retract'(ResFile, GoalAtom) :-
    catch(
      ( read_term_from_atom(GoalAtom, Fact, []),
        ( retract(Fact) -> Lines = ['OK'-''] ; Lines = ['NONE'-''] ) ),
      E, ( '$err_atom'(E, EA), Lines = ['ERR'-EA] )),
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
      ( setup_call_cleanup(open(SrcFile, read, S), '$consult_collect'(S, Clauses), close(S)),
        '$consult_assert'(Clauses) ),
      E, Err = E),
    ( var(Err) -> Lines = ['OK'-''] ; '$err_atom'(Err, EA), Lines = ['ERR'-EA] ),
    '$write_lines'(ResFile, Lines).
'$consult_collect'(S, Clauses) :-
    read_term(S, T, []),
    ( T == end_of_file -> Clauses = []
    ; T = (:- D) -> ( catch(D, _, true) -> true ; true ), '$consult_collect'(S, Clauses)
    ; Clauses = [T|Rest], '$consult_collect'(S, Rest) ).
'$consult_assert'([]).
'$consult_assert'([C|Cs]) :- assertz(C), '$consult_assert'(Cs).
