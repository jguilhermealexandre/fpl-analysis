-- One-time seed of the 8 predictions already collected by hand (from
-- data/predictions.json), so nobody has to re-submit once the self-serve
-- page goes live. Run once, after predictions-schema.sql, in the Supabase
-- SQL editor.

insert into predictions (name, predictions) values
    ('Viri', '{ARS,MUN,MCI,LIV,TOT,CHE,NFO,BOU,AVL,BHA,EVE,CRY,BRE,SUN,NEW,FUL,LEE,IPS,COV,HUL}'),
    ('Heldinho', '{ARS,MUN,MCI,LIV,TOT,CHE,NFO,BOU,AVL,BHA,EVE,CRY,BRE,SUN,NEW,FUL,LEE,IPS,COV,HUL}'),
    ('Shanay', '{ARS,MUN,MCI,LIV,TOT,CHE,NFO,BOU,AVL,BHA,EVE,CRY,BRE,SUN,NEW,FUL,LEE,IPS,COV,HUL}'),
    ('José', '{ARS,MUN,MCI,LIV,TOT,CHE,NFO,BOU,AVL,BHA,EVE,CRY,BRE,SUN,NEW,FUL,LEE,IPS,COV,HUL}'),
    ('Mau', '{ARS,LIV,CHE,MUN,MCI,TOT,AVL,BHA,BRE,BOU,NFO,FUL,CRY,EVE,NEW,SUN,LEE,IPS,COV,HUL}'),
    ('Leandro', '{ARS,LIV,CHE,MUN,AVL,TOT,MCI,BHA,BRE,BOU,NFO,FUL,CRY,EVE,NEW,SUN,LEE,IPS,COV,HUL}'),
    ('Rui', '{ARS,MCI,MUN,CHE,LIV,TOT,AVL,NEW,BHA,NFO,CRY,EVE,BOU,BRE,FUL,LEE,SUN,COV,IPS,HUL}'),
    ('Maitoco', '{ARS,MCI,MUN,CHE,LIV,TOT,AVL,NEW,BHA,NFO,CRY,EVE,BOU,BRE,FUL,LEE,SUN,COV,IPS,HUL}')
on conflict (name_key) do nothing;
