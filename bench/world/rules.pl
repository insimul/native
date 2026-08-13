% rules.pl — the derived gameplay predicates a session actually asks.
% These are the goals scripts/measure.sh runs against the loaded world.

quest_available(L) :- quest(Q, _, _, _, active), \+ quest_blocked(Q), id_local(Q, L).
quest_blocked(Q) :- quest_prerequisite(Q, P), \+ completed(_, P, _).
quest_of_difficulty(D, L) :- quest(Q, _, _, D, _), id_local(Q, L).
quest_payout(L, Total) :-
    quest(Q, _, _, _, _), id_local(Q, L),
    findall(V, quest_reward(Q, _, V), Vs), sum_list_(Vs, Total).
sum_list_([], 0).
sum_list_([H|T], S) :- sum_list_(T, S0), S is S0 + H.

giver_of(QL, NL) :- quest_giver(Q, N), id_local(Q, QL), id_local(N, NL).
veteran(L) :- npc_level(N, Lv), Lv >= 20, id_local(N, L).
staffed(FL, Count) :-
    faction(F, _), id_local(F, FL),
    findall(N, npc_faction(N, F), Ns), length_(Ns, Count).
length_([], 0).
length_([_|T], N) :- length_(T, N0), N is N0 + 1.

% Reachability over the location tree, and the world-scoped view of it.
resident(LocL, NpcL) :- npc_home(N, Loc), id_local(Loc, LocL), id_local(N, NpcL).
nested_in(AL, BL) :- inside(A, B), id_local(A, AL), id_local(B, BL).
world_view(WL, Scope) :-
    world_scope(id(world, insimul, 'alderforest%23save-7f'), S), id_local(S, Scope), WL = 'alderforest%23save-7f'.

carrier(ItemL, NpcName) :-
    item_owner(I, N), id_local(I, ItemL), npc_name(N, NpcName).
rich_item(L, V) :- item(I, _, V), V > 300, id_local(I, L).
