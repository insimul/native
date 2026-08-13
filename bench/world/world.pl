% world.pl — the world chain and the identity/equivalence rules.
% KINP: a playthrough inherits from editor canon, which inherits from
% consensus reality (conformance/prolog/worlds.json). The '#' of the
% playthrough spelling is percent-encoded, and stays undecoded.

:- dynamic(world_parent/2).
:- dynamic(same_as/3).

world_parent(id(world, insimul, 'alderforest%23save-7f'), id(world, insimul, alderforest)).
world_parent(id(world, insimul, alderforest), id(world, pinakes, 'consensus-reality')).

world_ancestor(W, P) :- world_parent(W, P).
world_ancestor(W, A) :- world_parent(W, M), world_ancestor(M, A).
world_scope(W, W).
world_scope(W, A) :- world_ancestor(W, A).

id_local(id(_, _, L), L).
id_ns(id(_, N, _), N).

% Equivalence is symmetric and transitive over a confidence floor.
equivalent(A, B, C) :- same_as(A, B, C).
equivalent(A, B, C) :- same_as(B, A, C).
alias_of(L, M) :- equivalent(A, B, _), id_local(A, L), id_local(B, M).
confident_alias(L, M) :- equivalent(A, B, C), C >= 0.75,
    id_local(A, L), id_local(B, M).
