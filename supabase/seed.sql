-- Local development seed (applied by `supabase db reset`).
-- An instructor invite code you can redeem on the instructor page after creating
-- an e-mail account. NEVER ship this code to production — create your own with:
--   insert into public.instructor_invites (code) values ('<long random code>');
insert into public.instructor_invites (code) values ('LOCAL-DEV-INVITE') on conflict do nothing;
