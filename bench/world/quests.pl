% quests.pl — quest/5, quest_objective/3, quest_reward/3,
% quest_prerequisite/2: the shapes of packages/core's predicate schema.

:- dynamic(quest/5).
:- dynamic(quest_objective/3).
:- dynamic(quest_reward/3).
:- dynamic(quest_prerequisite/2).
:- dynamic(quest_giver/2).
:- dynamic(completed/3).

quest(id(ent, 'insimul:world:alderforest', 'q0001'), 'Find the Lost Ledger', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0001'), id(ent, 'insimul:world:alderforest', 'npc_0037')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0001'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0001'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0001'), gold, 348).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0001'), gold, 774).
quest(id(ent, 'insimul:world:alderforest', 'q0002'), 'Slay the Dragon', main, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0002'), id(ent, 'insimul:world:alderforest', 'npc_0002')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0002'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0002'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0002'), renown, 815).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0002'), supplies, 891).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0002'), id(ent, 'insimul:world:alderforest', 'q0001')).
quest(id(ent, 'insimul:world:alderforest', 'q0003'), 'Clear the Cellar', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0003'), id(ent, 'insimul:world:alderforest', 'npc_0108')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0003'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0003'), 1, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0003'), renown, 80).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0003'), gold, 235).
quest(id(ent, 'insimul:world:alderforest', 'q0004'), 'Douse the Beacon', main, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0004'), id(ent, 'insimul:world:alderforest', 'npc_0071')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0004'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0004'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0004'), supplies, 547).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0004'), supplies, 283).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0004'), id(ent, 'insimul:world:alderforest', 'q0001')).
quest(id(ent, 'insimul:world:alderforest', 'q0005'), 'Gather Herbs', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0005'), id(ent, 'insimul:world:alderforest', 'npc_0094')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0005'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0005'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0005'), renown, 751).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0005'), supplies, 393).
quest(id(ent, 'insimul:world:alderforest', 'q0006'), 'Sing the Elegy', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0006'), id(ent, 'insimul:world:alderforest', 'npc_0096')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0006'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0006'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0006'), xp, 650).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0006'), renown, 536).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0006'), id(ent, 'insimul:world:alderforest', 'q0001')).
quest(id(ent, 'insimul:world:alderforest', 'q0007'), 'Clear the Cellar', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0007'), id(ent, 'insimul:world:alderforest', 'npc_0049')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0007'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0007'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0007'), xp, 261).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0007'), renown, 60).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0007'), id(ent, 'insimul:world:alderforest', 'q0004')).
quest(id(ent, 'insimul:world:alderforest', 'q0008'), 'Slay the Dragon', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0008'), id(ent, 'insimul:world:alderforest', 'npc_0118')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0008'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0008'), 1, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0008'), 2, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0008'), renown, 751).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0008'), xp, 50).
quest(id(ent, 'insimul:world:alderforest', 'q0009'), 'Rescue the Merchant', main, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0009'), id(ent, 'insimul:world:alderforest', 'npc_0073')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0009'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0009'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0009'), 2, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0009'), supplies, 414).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0009'), xp, 181).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0009'), id(ent, 'insimul:world:alderforest', 'q0003')).
quest(id(ent, 'insimul:world:alderforest', 'q0010'), 'Clear the Cellar', side, normal, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0010'), id(ent, 'insimul:world:alderforest', 'npc_0082')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0010'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0010'), 1, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0010'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0010'), renown, 381).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0010'), supplies, 322).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0010'), id(ent, 'insimul:world:alderforest', 'q0008')).
quest(id(ent, 'insimul:world:alderforest', 'q0011'), 'Sing the Elegy', main, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0011'), id(ent, 'insimul:world:alderforest', 'npc_0098')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0011'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0011'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0011'), supplies, 32).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0011'), renown, 685).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0011'), id(ent, 'insimul:world:alderforest', 'q0009')).
quest(id(ent, 'insimul:world:alderforest', 'q0012'), 'Slay the Dragon', main, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0012'), id(ent, 'insimul:world:alderforest', 'npc_0002')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0012'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0012'), 1, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0012'), supplies, 899).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0012'), gold, 126).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0012'), id(ent, 'insimul:world:alderforest', 'q0008')).
quest(id(ent, 'insimul:world:alderforest', 'q0013'), 'Sing the Elegy', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0013'), id(ent, 'insimul:world:alderforest', 'npc_0067')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0013'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0013'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0013'), renown, 339).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0013'), xp, 529).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0013'), id(ent, 'insimul:world:alderforest', 'q0005')).
quest(id(ent, 'insimul:world:alderforest', 'q0014'), 'Gather Herbs', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0014'), id(ent, 'insimul:world:alderforest', 'npc_0020')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0014'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0014'), 1, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0014'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0014'), supplies, 712).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0014'), supplies, 594).
quest(id(ent, 'insimul:world:alderforest', 'q0015'), 'Mend the Weir', main, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0015'), id(ent, 'insimul:world:alderforest', 'npc_0052')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0015'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0015'), 1, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0015'), 2, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0015'), renown, 617).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0015'), xp, 778).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0015'), id(ent, 'insimul:world:alderforest', 'q0010')).
quest(id(ent, 'insimul:world:alderforest', 'q0016'), 'Find the Lost Ledger', main, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0016'), id(ent, 'insimul:world:alderforest', 'npc_0014')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0016'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0016'), 1, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0016'), supplies, 171).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0016'), gold, 381).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0016'), id(ent, 'insimul:world:alderforest', 'q0006')).
quest(id(ent, 'insimul:world:alderforest', 'q0017'), 'Clear the Cellar', side, hard, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0017'), id(ent, 'insimul:world:alderforest', 'npc_0049')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0017'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0017'), 1, speak_to_elder).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0017'), renown, 719).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0017'), renown, 462).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0017'), id(ent, 'insimul:world:alderforest', 'q0007')).
quest(id(ent, 'insimul:world:alderforest', 'q0018'), 'Gather Herbs', main, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0018'), id(ent, 'insimul:world:alderforest', 'npc_0052')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0018'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0018'), 1, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0018'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0018'), supplies, 402).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0018'), gold, 517).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0018'), id(ent, 'insimul:world:alderforest', 'q0009')).
quest(id(ent, 'insimul:world:alderforest', 'q0019'), 'Track the Poacher', side, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0019'), id(ent, 'insimul:world:alderforest', 'npc_0068')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0019'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0019'), 1, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0019'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0019'), xp, 268).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0019'), xp, 742).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0019'), id(ent, 'insimul:world:alderforest', 'q0008')).
quest(id(ent, 'insimul:world:alderforest', 'q0020'), 'Clear the Cellar', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0020'), id(ent, 'insimul:world:alderforest', 'npc_0016')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0020'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0020'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0020'), supplies, 897).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0020'), supplies, 249).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0020'), id(ent, 'insimul:world:alderforest', 'q0015')).
quest(id(ent, 'insimul:world:alderforest', 'q0021'), 'Find the Lost Ledger', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0021'), id(ent, 'insimul:world:alderforest', 'npc_0115')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0021'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0021'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0021'), 2, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0021'), xp, 351).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0021'), gold, 879).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0021'), id(ent, 'insimul:world:alderforest', 'q0002')).
quest(id(ent, 'insimul:world:alderforest', 'q0022'), 'Sing the Elegy', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0022'), id(ent, 'insimul:world:alderforest', 'npc_0037')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0022'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0022'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0022'), xp, 852).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0022'), renown, 314).
quest(id(ent, 'insimul:world:alderforest', 'q0023'), 'Track the Poacher', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0023'), id(ent, 'insimul:world:alderforest', 'npc_0118')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0023'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0023'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0023'), renown, 261).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0023'), xp, 728).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0023'), id(ent, 'insimul:world:alderforest', 'q0004')).
quest(id(ent, 'insimul:world:alderforest', 'q0024'), 'Track the Poacher', side, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0024'), id(ent, 'insimul:world:alderforest', 'npc_0049')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0024'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0024'), 1, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0024'), 2, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0024'), gold, 509).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0024'), renown, 369).
quest(id(ent, 'insimul:world:alderforest', 'q0025'), 'Douse the Beacon', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0025'), id(ent, 'insimul:world:alderforest', 'npc_0117')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0025'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0025'), 1, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0025'), supplies, 376).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0025'), gold, 747).
quest(id(ent, 'insimul:world:alderforest', 'q0026'), 'Track the Poacher', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0026'), id(ent, 'insimul:world:alderforest', 'npc_0105')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0026'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0026'), 1, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0026'), xp, 527).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0026'), renown, 583).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0026'), id(ent, 'insimul:world:alderforest', 'q0008')).
quest(id(ent, 'insimul:world:alderforest', 'q0027'), 'Gather Herbs', main, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0027'), id(ent, 'insimul:world:alderforest', 'npc_0091')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0027'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0027'), 1, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0027'), 2, speak_to_elder).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0027'), renown, 352).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0027'), xp, 84).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0027'), id(ent, 'insimul:world:alderforest', 'q0025')).
quest(id(ent, 'insimul:world:alderforest', 'q0028'), 'Slay the Dragon', main, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0028'), id(ent, 'insimul:world:alderforest', 'npc_0092')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0028'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0028'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0028'), supplies, 467).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0028'), supplies, 455).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0028'), id(ent, 'insimul:world:alderforest', 'q0022')).
quest(id(ent, 'insimul:world:alderforest', 'q0029'), 'Track the Poacher', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0029'), id(ent, 'insimul:world:alderforest', 'npc_0101')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0029'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0029'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0029'), gold, 591).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0029'), renown, 319).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0029'), id(ent, 'insimul:world:alderforest', 'q0009')).
quest(id(ent, 'insimul:world:alderforest', 'q0030'), 'Slay the Dragon', main, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0030'), id(ent, 'insimul:world:alderforest', 'npc_0112')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0030'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0030'), 1, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0030'), 2, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0030'), renown, 846).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0030'), renown, 509).
quest(id(ent, 'insimul:world:alderforest', 'q0031'), 'Douse the Beacon', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0031'), id(ent, 'insimul:world:alderforest', 'npc_0037')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0031'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0031'), 1, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0031'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0031'), xp, 488).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0031'), renown, 536).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0031'), id(ent, 'insimul:world:alderforest', 'q0007')).
quest(id(ent, 'insimul:world:alderforest', 'q0032'), 'Find the Lost Ledger', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0032'), id(ent, 'insimul:world:alderforest', 'npc_0041')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0032'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0032'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0032'), 2, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0032'), renown, 296).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0032'), supplies, 189).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0032'), id(ent, 'insimul:world:alderforest', 'q0004')).
quest(id(ent, 'insimul:world:alderforest', 'q0033'), 'Slay the Dragon', side, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0033'), id(ent, 'insimul:world:alderforest', 'npc_0054')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0033'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0033'), 1, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0033'), gold, 878).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0033'), supplies, 295).
quest(id(ent, 'insimul:world:alderforest', 'q0034'), 'Escort the Caravan', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0034'), id(ent, 'insimul:world:alderforest', 'npc_0113')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0034'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0034'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0034'), xp, 19).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0034'), gold, 99).
quest(id(ent, 'insimul:world:alderforest', 'q0035'), 'Sing the Elegy', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0035'), id(ent, 'insimul:world:alderforest', 'npc_0030')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0035'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0035'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0035'), gold, 636).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0035'), renown, 582).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0035'), id(ent, 'insimul:world:alderforest', 'q0019')).
quest(id(ent, 'insimul:world:alderforest', 'q0036'), 'Sing the Elegy', side, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0036'), id(ent, 'insimul:world:alderforest', 'npc_0113')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0036'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0036'), 1, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0036'), 2, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0036'), xp, 488).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0036'), renown, 897).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0036'), id(ent, 'insimul:world:alderforest', 'q0017')).
quest(id(ent, 'insimul:world:alderforest', 'q0037'), 'Find the Lost Ledger', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0037'), id(ent, 'insimul:world:alderforest', 'npc_0100')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0037'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0037'), 1, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0037'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0037'), renown, 29).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0037'), gold, 748).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0037'), id(ent, 'insimul:world:alderforest', 'q0023')).
quest(id(ent, 'insimul:world:alderforest', 'q0038'), 'Sing the Elegy', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0038'), id(ent, 'insimul:world:alderforest', 'npc_0015')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0038'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0038'), 1, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0038'), renown, 566).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0038'), xp, 650).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0038'), id(ent, 'insimul:world:alderforest', 'q0034')).
quest(id(ent, 'insimul:world:alderforest', 'q0039'), 'Sing the Elegy', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0039'), id(ent, 'insimul:world:alderforest', 'npc_0061')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0039'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0039'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0039'), renown, 370).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0039'), gold, 25).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0039'), id(ent, 'insimul:world:alderforest', 'q0002')).
quest(id(ent, 'insimul:world:alderforest', 'q0040'), 'Rescue the Merchant', side, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0040'), id(ent, 'insimul:world:alderforest', 'npc_0052')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0040'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0040'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0040'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0040'), supplies, 380).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0040'), gold, 172).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0040'), id(ent, 'insimul:world:alderforest', 'q0011')).
quest(id(ent, 'insimul:world:alderforest', 'q0041'), 'Sing the Elegy', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0041'), id(ent, 'insimul:world:alderforest', 'npc_0083')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0041'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0041'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0041'), gold, 445).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0041'), supplies, 412).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0041'), id(ent, 'insimul:world:alderforest', 'q0035')).
quest(id(ent, 'insimul:world:alderforest', 'q0042'), 'Track the Poacher', main, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0042'), id(ent, 'insimul:world:alderforest', 'npc_0093')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0042'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0042'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0042'), xp, 685).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0042'), renown, 368).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0042'), id(ent, 'insimul:world:alderforest', 'q0017')).
quest(id(ent, 'insimul:world:alderforest', 'q0043'), 'Track the Poacher', main, hard, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0043'), id(ent, 'insimul:world:alderforest', 'npc_0022')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0043'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0043'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0043'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0043'), gold, 201).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0043'), gold, 455).
quest(id(ent, 'insimul:world:alderforest', 'q0044'), 'Track the Poacher', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0044'), id(ent, 'insimul:world:alderforest', 'npc_0116')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0044'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0044'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0044'), renown, 897).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0044'), renown, 897).
quest(id(ent, 'insimul:world:alderforest', 'q0045'), 'Douse the Beacon', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0045'), id(ent, 'insimul:world:alderforest', 'npc_0020')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0045'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0045'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0045'), gold, 279).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0045'), gold, 269).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0045'), id(ent, 'insimul:world:alderforest', 'q0014')).
quest(id(ent, 'insimul:world:alderforest', 'q0046'), 'Escort the Caravan', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0046'), id(ent, 'insimul:world:alderforest', 'npc_0025')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0046'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0046'), 1, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0046'), xp, 55).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0046'), gold, 151).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0046'), id(ent, 'insimul:world:alderforest', 'q0025')).
quest(id(ent, 'insimul:world:alderforest', 'q0047'), 'Slay the Dragon', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0047'), id(ent, 'insimul:world:alderforest', 'npc_0119')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0047'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0047'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0047'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0047'), xp, 451).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0047'), xp, 195).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0047'), id(ent, 'insimul:world:alderforest', 'q0033')).
quest(id(ent, 'insimul:world:alderforest', 'q0048'), 'Gather Herbs', side, hard, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0048'), id(ent, 'insimul:world:alderforest', 'npc_0002')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0048'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0048'), 1, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0048'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0048'), renown, 594).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0048'), xp, 605).
quest(id(ent, 'insimul:world:alderforest', 'q0049'), 'Rescue the Merchant', main, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0049'), id(ent, 'insimul:world:alderforest', 'npc_0073')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0049'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0049'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0049'), 2, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0049'), renown, 835).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0049'), renown, 351).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0049'), id(ent, 'insimul:world:alderforest', 'q0009')).
quest(id(ent, 'insimul:world:alderforest', 'q0050'), 'Rescue the Merchant', side, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0050'), id(ent, 'insimul:world:alderforest', 'npc_0046')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0050'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0050'), 1, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0050'), 2, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0050'), xp, 575).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0050'), gold, 895).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0050'), id(ent, 'insimul:world:alderforest', 'q0041')).
quest(id(ent, 'insimul:world:alderforest', 'q0051'), 'Clear the Cellar', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0051'), id(ent, 'insimul:world:alderforest', 'npc_0108')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0051'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0051'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0051'), gold, 403).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0051'), supplies, 231).
quest(id(ent, 'insimul:world:alderforest', 'q0052'), 'Find the Lost Ledger', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0052'), id(ent, 'insimul:world:alderforest', 'npc_0016')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0052'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0052'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0052'), renown, 772).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0052'), xp, 502).
quest(id(ent, 'insimul:world:alderforest', 'q0053'), 'Track the Poacher', main, normal, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0053'), id(ent, 'insimul:world:alderforest', 'npc_0039')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0053'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0053'), 1, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0053'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0053'), xp, 634).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0053'), xp, 172).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0053'), id(ent, 'insimul:world:alderforest', 'q0034')).
quest(id(ent, 'insimul:world:alderforest', 'q0054'), 'Douse the Beacon', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0054'), id(ent, 'insimul:world:alderforest', 'npc_0062')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0054'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0054'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0054'), xp, 858).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0054'), renown, 236).
quest(id(ent, 'insimul:world:alderforest', 'q0055'), 'Sing the Elegy', side, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0055'), id(ent, 'insimul:world:alderforest', 'npc_0115')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0055'), 0, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0055'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0055'), 2, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0055'), gold, 267).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0055'), xp, 338).
quest(id(ent, 'insimul:world:alderforest', 'q0056'), 'Douse the Beacon', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0056'), id(ent, 'insimul:world:alderforest', 'npc_0076')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0056'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0056'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0056'), xp, 124).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0056'), gold, 256).
quest(id(ent, 'insimul:world:alderforest', 'q0057'), 'Track the Poacher', side, easy, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0057'), id(ent, 'insimul:world:alderforest', 'npc_0006')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0057'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0057'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0057'), xp, 386).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0057'), gold, 138).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0057'), id(ent, 'insimul:world:alderforest', 'q0037')).
quest(id(ent, 'insimul:world:alderforest', 'q0058'), 'Escort the Caravan', main, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0058'), id(ent, 'insimul:world:alderforest', 'npc_0081')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0058'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0058'), 1, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0058'), renown, 283).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0058'), xp, 406).
quest(id(ent, 'insimul:world:alderforest', 'q0059'), 'Track the Poacher', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0059'), id(ent, 'insimul:world:alderforest', 'npc_0015')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0059'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0059'), 1, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0059'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0059'), renown, 239).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0059'), xp, 114).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0059'), id(ent, 'insimul:world:alderforest', 'q0025')).
quest(id(ent, 'insimul:world:alderforest', 'q0060'), 'Rescue the Merchant', side, hard, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0060'), id(ent, 'insimul:world:alderforest', 'npc_0020')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0060'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0060'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0060'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0060'), supplies, 453).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0060'), gold, 110).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0060'), id(ent, 'insimul:world:alderforest', 'q0015')).
quest(id(ent, 'insimul:world:alderforest', 'q0061'), 'Track the Poacher', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0061'), id(ent, 'insimul:world:alderforest', 'npc_0021')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0061'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0061'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0061'), 2, speak_to_elder).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0061'), xp, 218).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0061'), supplies, 290).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0061'), id(ent, 'insimul:world:alderforest', 'q0002')).
quest(id(ent, 'insimul:world:alderforest', 'q0062'), 'Track the Poacher', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0062'), id(ent, 'insimul:world:alderforest', 'npc_0068')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0062'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0062'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0062'), renown, 542).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0062'), supplies, 790).
quest(id(ent, 'insimul:world:alderforest', 'q0063'), 'Track the Poacher', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0063'), id(ent, 'insimul:world:alderforest', 'npc_0029')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0063'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0063'), 1, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0063'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0063'), supplies, 625).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0063'), xp, 317).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0063'), id(ent, 'insimul:world:alderforest', 'q0015')).
quest(id(ent, 'insimul:world:alderforest', 'q0064'), 'Gather Herbs', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0064'), id(ent, 'insimul:world:alderforest', 'npc_0033')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0064'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0064'), 1, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0064'), renown, 217).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0064'), supplies, 351).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0064'), id(ent, 'insimul:world:alderforest', 'q0007')).
quest(id(ent, 'insimul:world:alderforest', 'q0065'), 'Rescue the Merchant', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0065'), id(ent, 'insimul:world:alderforest', 'npc_0006')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0065'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0065'), 1, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0065'), supplies, 228).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0065'), xp, 99).
quest(id(ent, 'insimul:world:alderforest', 'q0066'), 'Find the Lost Ledger', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0066'), id(ent, 'insimul:world:alderforest', 'npc_0077')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0066'), 0, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0066'), 1, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0066'), renown, 677).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0066'), gold, 238).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0066'), id(ent, 'insimul:world:alderforest', 'q0005')).
quest(id(ent, 'insimul:world:alderforest', 'q0067'), 'Rescue the Merchant', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0067'), id(ent, 'insimul:world:alderforest', 'npc_0058')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0067'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0067'), 1, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0067'), 2, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0067'), xp, 214).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0067'), renown, 706).
quest(id(ent, 'insimul:world:alderforest', 'q0068'), 'Gather Herbs', side, normal, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0068'), id(ent, 'insimul:world:alderforest', 'npc_0002')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0068'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0068'), 1, repair_weir).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0068'), 2, free_merchant).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0068'), xp, 566).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0068'), gold, 446).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0068'), id(ent, 'insimul:world:alderforest', 'q0047')).
quest(id(ent, 'insimul:world:alderforest', 'q0069'), 'Douse the Beacon', main, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0069'), id(ent, 'insimul:world:alderforest', 'npc_0007')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0069'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0069'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0069'), supplies, 613).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0069'), renown, 791).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0069'), id(ent, 'insimul:world:alderforest', 'q0043')).
quest(id(ent, 'insimul:world:alderforest', 'q0070'), 'Track the Poacher', main, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0070'), id(ent, 'insimul:world:alderforest', 'npc_0114')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0070'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0070'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0070'), gold, 267).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0070'), supplies, 795).
quest(id(ent, 'insimul:world:alderforest', 'q0071'), 'Clear the Cellar', side, easy, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0071'), id(ent, 'insimul:world:alderforest', 'npc_0008')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0071'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0071'), 1, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0071'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0071'), renown, 267).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0071'), renown, 545).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0071'), id(ent, 'insimul:world:alderforest', 'q0036')).
quest(id(ent, 'insimul:world:alderforest', 'q0072'), 'Track the Poacher', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0072'), id(ent, 'insimul:world:alderforest', 'npc_0024')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0072'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0072'), 1, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0072'), gold, 282).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0072'), gold, 822).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0072'), id(ent, 'insimul:world:alderforest', 'q0031')).
quest(id(ent, 'insimul:world:alderforest', 'q0073'), 'Track the Poacher', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0073'), id(ent, 'insimul:world:alderforest', 'npc_0081')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0073'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0073'), 1, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0073'), supplies, 217).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0073'), gold, 406).
quest(id(ent, 'insimul:world:alderforest', 'q0074'), 'Douse the Beacon', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0074'), id(ent, 'insimul:world:alderforest', 'npc_0060')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0074'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0074'), 1, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0074'), renown, 601).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0074'), renown, 408).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0074'), id(ent, 'insimul:world:alderforest', 'q0058')).
quest(id(ent, 'insimul:world:alderforest', 'q0075'), 'Gather Herbs', main, normal, locked).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0075'), id(ent, 'insimul:world:alderforest', 'npc_0037')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0075'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0075'), 1, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0075'), xp, 665).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0075'), gold, 835).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0075'), id(ent, 'insimul:world:alderforest', 'q0026')).
quest(id(ent, 'insimul:world:alderforest', 'q0076'), 'Slay the Dragon', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0076'), id(ent, 'insimul:world:alderforest', 'npc_0054')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0076'), 0, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0076'), 1, gather_herbs).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0076'), 2, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0076'), supplies, 260).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0076'), supplies, 458).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0076'), id(ent, 'insimul:world:alderforest', 'q0055')).
quest(id(ent, 'insimul:world:alderforest', 'q0077'), 'Douse the Beacon', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0077'), id(ent, 'insimul:world:alderforest', 'npc_0035')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0077'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0077'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0077'), gold, 780).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0077'), supplies, 133).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0077'), id(ent, 'insimul:world:alderforest', 'q0051')).
quest(id(ent, 'insimul:world:alderforest', 'q0078'), 'Sing the Elegy', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0078'), id(ent, 'insimul:world:alderforest', 'npc_0002')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0078'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0078'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0078'), xp, 771).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0078'), gold, 777).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0078'), id(ent, 'insimul:world:alderforest', 'q0035')).
quest(id(ent, 'insimul:world:alderforest', 'q0079'), 'Mend the Weir', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0079'), id(ent, 'insimul:world:alderforest', 'npc_0115')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0079'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0079'), 1, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0079'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0079'), xp, 121).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0079'), supplies, 341).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0079'), id(ent, 'insimul:world:alderforest', 'q0013')).
quest(id(ent, 'insimul:world:alderforest', 'q0080'), 'Slay the Dragon', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0080'), id(ent, 'insimul:world:alderforest', 'npc_0086')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0080'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0080'), 1, open_gate).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0080'), supplies, 768).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0080'), supplies, 711).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0080'), id(ent, 'insimul:world:alderforest', 'q0035')).
quest(id(ent, 'insimul:world:alderforest', 'q0081'), 'Find the Lost Ledger', side, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0081'), id(ent, 'insimul:world:alderforest', 'npc_0006')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0081'), 0, open_gate).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0081'), 1, speak_to_elder).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0081'), supplies, 355).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0081'), supplies, 351).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0081'), id(ent, 'insimul:world:alderforest', 'q0043')).
quest(id(ent, 'insimul:world:alderforest', 'q0082'), 'Escort the Caravan', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0082'), id(ent, 'insimul:world:alderforest', 'npc_0113')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0082'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0082'), 1, light_beacon).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0082'), 2, follow_tracks).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0082'), gold, 709).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0082'), gold, 156).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0082'), id(ent, 'insimul:world:alderforest', 'q0055')).
quest(id(ent, 'insimul:world:alderforest', 'q0083'), 'Gather Herbs', main, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0083'), id(ent, 'insimul:world:alderforest', 'npc_0114')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0083'), 0, speak_to_elder).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0083'), 1, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0083'), 2, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0083'), gold, 466).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0083'), renown, 795).
quest(id(ent, 'insimul:world:alderforest', 'q0084'), 'Sing the Elegy', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0084'), id(ent, 'insimul:world:alderforest', 'npc_0044')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0084'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0084'), 1, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0084'), 2, slay_beast).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0084'), gold, 406).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0084'), xp, 824).
quest(id(ent, 'insimul:world:alderforest', 'q0085'), 'Clear the Cellar', main, normal, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0085'), id(ent, 'insimul:world:alderforest', 'npc_0093')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0085'), 0, slay_beast).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0085'), 1, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0085'), 2, gather_herbs).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0085'), xp, 793).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0085'), renown, 204).
quest(id(ent, 'insimul:world:alderforest', 'q0086'), 'Douse the Beacon', side, hard, done).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0086'), id(ent, 'insimul:world:alderforest', 'npc_0069')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0086'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0086'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0086'), renown, 860).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0086'), renown, 784).
quest(id(ent, 'insimul:world:alderforest', 'q0087'), 'Gather Herbs', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0087'), id(ent, 'insimul:world:alderforest', 'npc_0053')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0087'), 0, recover_ledger).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0087'), 1, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0087'), 2, repair_weir).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0087'), gold, 302).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0087'), gold, 529).
quest(id(ent, 'insimul:world:alderforest', 'q0088'), 'Slay the Dragon', side, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0088'), id(ent, 'insimul:world:alderforest', 'npc_0023')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0088'), 0, follow_tracks).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0088'), 1, reach_camp).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0088'), renown, 508).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0088'), xp, 827).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0088'), id(ent, 'insimul:world:alderforest', 'q0060')).
quest(id(ent, 'insimul:world:alderforest', 'q0089'), 'Sing the Elegy', side, easy, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0089'), id(ent, 'insimul:world:alderforest', 'npc_0010')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0089'), 0, reach_camp).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0089'), 1, recover_ledger).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0089'), gold, 77).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0089'), xp, 59).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0089'), id(ent, 'insimul:world:alderforest', 'q0018')).
quest(id(ent, 'insimul:world:alderforest', 'q0090'), 'Find the Lost Ledger', main, hard, active).
quest_giver(id(ent, 'insimul:world:alderforest', 'q0090'), id(ent, 'insimul:world:alderforest', 'npc_0071')).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0090'), 0, free_merchant).
quest_objective(id(ent, 'insimul:world:alderforest', 'q0090'), 1, light_beacon).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0090'), xp, 733).
quest_reward(id(ent, 'insimul:world:alderforest', 'q0090'), supplies, 268).
quest_prerequisite(id(ent, 'insimul:world:alderforest', 'q0090'), id(ent, 'insimul:world:alderforest', 'q0016')).

completed(id(ent, 'insimul:world:alderforest', 'hero'), id(ent, 'insimul:world:alderforest', 'q0001'), 0).
completed(id(ent, 'insimul:world:alderforest', 'hero'), id(ent, 'insimul:world:alderforest', 'q0002'), 1).
