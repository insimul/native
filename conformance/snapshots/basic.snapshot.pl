age(alice,30).
friend(alice,pet(dog)).
inventory(bob,[sword,shield,3]).
knows(A,B):-likes(A,B).
knows(A,B):-likes(A,C),knows(C,B).
likes(alice,bob).
person(alice).
person(bob).
score(carol,4.5).
title(alice,'Grand Duchess').
