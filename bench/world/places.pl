% places.pl — locations, their containment tree, and the factions.

:- dynamic(location/2).
:- dynamic(location_parent/2).
:- dynamic(faction/2).
:- dynamic(faction_standing/3).

location(id(ent, 'insimul:world:alderforest', 'loc_0001'), 'West chapel').
location(id(ent, 'insimul:world:alderforest', 'loc_0002'), 'North market').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0002'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0003'), 'Old orchard').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0003'), id(ent, 'insimul:world:alderforest', 'loc_0002')).
location(id(ent, 'insimul:world:alderforest', 'loc_0004'), 'Old chapel').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0004'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0005'), 'Far barrow').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0005'), id(ent, 'insimul:world:alderforest', 'loc_0003')).
location(id(ent, 'insimul:world:alderforest', 'loc_0006'), 'Far wharf').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0006'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0007'), 'Far bridge').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0007'), id(ent, 'insimul:world:alderforest', 'loc_0003')).
location(id(ent, 'insimul:world:alderforest', 'loc_0008'), 'Low gate').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0008'), id(ent, 'insimul:world:alderforest', 'loc_0003')).
location(id(ent, 'insimul:world:alderforest', 'loc_0009'), 'South mill').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0009'), id(ent, 'insimul:world:alderforest', 'loc_0008')).
location(id(ent, 'insimul:world:alderforest', 'loc_0010'), 'Far quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0010'), id(ent, 'insimul:world:alderforest', 'loc_0007')).
location(id(ent, 'insimul:world:alderforest', 'loc_0011'), 'North chapel').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0011'), id(ent, 'insimul:world:alderforest', 'loc_0010')).
location(id(ent, 'insimul:world:alderforest', 'loc_0012'), 'North quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0012'), id(ent, 'insimul:world:alderforest', 'loc_0002')).
location(id(ent, 'insimul:world:alderforest', 'loc_0013'), 'North mill').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0013'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0014'), 'Far chapel').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0014'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0015'), 'Old orchard').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0015'), id(ent, 'insimul:world:alderforest', 'loc_0008')).
location(id(ent, 'insimul:world:alderforest', 'loc_0016'), 'South bridge').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0016'), id(ent, 'insimul:world:alderforest', 'loc_0011')).
location(id(ent, 'insimul:world:alderforest', 'loc_0017'), 'Far quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0017'), id(ent, 'insimul:world:alderforest', 'loc_0010')).
location(id(ent, 'insimul:world:alderforest', 'loc_0018'), 'Old barrow').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0018'), id(ent, 'insimul:world:alderforest', 'loc_0008')).
location(id(ent, 'insimul:world:alderforest', 'loc_0019'), 'Low quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0019'), id(ent, 'insimul:world:alderforest', 'loc_0005')).
location(id(ent, 'insimul:world:alderforest', 'loc_0020'), 'Old quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0020'), id(ent, 'insimul:world:alderforest', 'loc_0008')).
location(id(ent, 'insimul:world:alderforest', 'loc_0021'), 'Low gate').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0021'), id(ent, 'insimul:world:alderforest', 'loc_0020')).
location(id(ent, 'insimul:world:alderforest', 'loc_0022'), 'Far chapel').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0022'), id(ent, 'insimul:world:alderforest', 'loc_0003')).
location(id(ent, 'insimul:world:alderforest', 'loc_0023'), 'South market').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0023'), id(ent, 'insimul:world:alderforest', 'loc_0019')).
location(id(ent, 'insimul:world:alderforest', 'loc_0024'), 'High quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0024'), id(ent, 'insimul:world:alderforest', 'loc_0001')).
location(id(ent, 'insimul:world:alderforest', 'loc_0025'), 'West gate').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0025'), id(ent, 'insimul:world:alderforest', 'loc_0005')).
location(id(ent, 'insimul:world:alderforest', 'loc_0026'), 'Far quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0026'), id(ent, 'insimul:world:alderforest', 'loc_0009')).
location(id(ent, 'insimul:world:alderforest', 'loc_0027'), 'East market').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0027'), id(ent, 'insimul:world:alderforest', 'loc_0005')).
location(id(ent, 'insimul:world:alderforest', 'loc_0028'), 'High market').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0028'), id(ent, 'insimul:world:alderforest', 'loc_0023')).
location(id(ent, 'insimul:world:alderforest', 'loc_0029'), 'Low mill').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0029'), id(ent, 'insimul:world:alderforest', 'loc_0026')).
location(id(ent, 'insimul:world:alderforest', 'loc_0030'), 'East quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0030'), id(ent, 'insimul:world:alderforest', 'loc_0014')).
location(id(ent, 'insimul:world:alderforest', 'loc_0031'), 'North quarry').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0031'), id(ent, 'insimul:world:alderforest', 'loc_0010')).
location(id(ent, 'insimul:world:alderforest', 'loc_0032'), 'West gate').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0032'), id(ent, 'insimul:world:alderforest', 'loc_0021')).
location(id(ent, 'insimul:world:alderforest', 'loc_0033'), 'West chapel').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0033'), id(ent, 'insimul:world:alderforest', 'loc_0025')).
location(id(ent, 'insimul:world:alderforest', 'loc_0034'), 'North gate').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0034'), id(ent, 'insimul:world:alderforest', 'loc_0022')).
location(id(ent, 'insimul:world:alderforest', 'loc_0035'), 'Old wharf').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0035'), id(ent, 'insimul:world:alderforest', 'loc_0026')).
location(id(ent, 'insimul:world:alderforest', 'loc_0036'), 'Low watchtower').
location_parent(id(ent, 'insimul:world:alderforest', 'loc_0036'), id(ent, 'insimul:world:alderforest', 'loc_0026')).

faction(id(ent, 'insimul:world:alderforest', 'fac_0001'), 'Woodwardens').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0001'), id(ent, 'insimul:world:alderforest', 'fac_0002'), -6).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0001'), id(ent, 'insimul:world:alderforest', 'fac_0005'), -76).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0001'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 83).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0001'), id(ent, 'insimul:world:alderforest', 'fac_0001'), 60).
faction(id(ent, 'insimul:world:alderforest', 'fac_0002'), 'Ashen Guild').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0002'), id(ent, 'insimul:world:alderforest', 'fac_0007'), 1).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0002'), id(ent, 'insimul:world:alderforest', 'fac_0006'), -12).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0002'), id(ent, 'insimul:world:alderforest', 'fac_0007'), -34).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0002'), id(ent, 'insimul:world:alderforest', 'fac_0006'), 74).
faction(id(ent, 'insimul:world:alderforest', 'fac_0003'), 'River Concord').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0003'), id(ent, 'insimul:world:alderforest', 'fac_0007'), 51).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0003'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 79).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0003'), id(ent, 'insimul:world:alderforest', 'fac_0006'), -11).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0003'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 75).
faction(id(ent, 'insimul:world:alderforest', 'fac_0004'), 'Stonewrights').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0004'), id(ent, 'insimul:world:alderforest', 'fac_0008'), -30).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0004'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 30).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0004'), id(ent, 'insimul:world:alderforest', 'fac_0001'), -57).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0004'), id(ent, 'insimul:world:alderforest', 'fac_0005'), 23).
faction(id(ent, 'insimul:world:alderforest', 'fac_0005'), 'Lamplighters').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0005'), id(ent, 'insimul:world:alderforest', 'fac_0004'), 36).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0005'), id(ent, 'insimul:world:alderforest', 'fac_0004'), -86).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0005'), id(ent, 'insimul:world:alderforest', 'fac_0004'), -76).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0005'), id(ent, 'insimul:world:alderforest', 'fac_0001'), -76).
faction(id(ent, 'insimul:world:alderforest', 'fac_0006'), 'Free Hands').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0006'), id(ent, 'insimul:world:alderforest', 'fac_0003'), 46).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0006'), id(ent, 'insimul:world:alderforest', 'fac_0003'), 48).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0006'), id(ent, 'insimul:world:alderforest', 'fac_0002'), -12).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0006'), id(ent, 'insimul:world:alderforest', 'fac_0002'), 65).
faction(id(ent, 'insimul:world:alderforest', 'fac_0007'), 'Thornwatch').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0007'), id(ent, 'insimul:world:alderforest', 'fac_0006'), 60).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0007'), id(ent, 'insimul:world:alderforest', 'fac_0003'), -44).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0007'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 68).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0007'), id(ent, 'insimul:world:alderforest', 'fac_0008'), 9).
faction(id(ent, 'insimul:world:alderforest', 'fac_0008'), 'Quiet Court').
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0008'), id(ent, 'insimul:world:alderforest', 'fac_0006'), 3).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0008'), id(ent, 'insimul:world:alderforest', 'fac_0002'), -96).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0008'), id(ent, 'insimul:world:alderforest', 'fac_0008'), -35).
faction_standing(id(ent, 'insimul:world:alderforest', 'fac_0008'), id(ent, 'insimul:world:alderforest', 'fac_0004'), -34).

inside(X, Y) :- location_parent(X, Y).
inside(X, Y) :- location_parent(X, M), inside(M, Y).
neighbours(A, B) :- location_parent(A, P), location_parent(B, P), A \== B.
