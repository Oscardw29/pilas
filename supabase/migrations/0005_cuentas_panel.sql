-- ¡Pilas! · Panel del creador: todas las cuentas registradas y eliminar cuentas
--
-- Requiere 0002_social.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run. Se puede volver a ejecutar.
--
-- - `admin_accounts`: lista todas las cuentas de `auth.users`, tengan o no perfil público (el creador incluido).
-- - `admin_delete_account`: elimina la cuenta de otra persona y, en cascada, todos sus datos.
-- - Una cuenta de creador no se puede eliminar por ningún camino: tampoco con `delete_my_account`.

create or replace function public.admin_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at, 'has_profile', p.user_id is not null, 'alias', p.alias,
      'display_name', p.display_name, 'avatar_path', p.avatar_path, 'banned', public.is_banned(u.id),
      'is_admin', exists (select 1 from public.app_admins a where a.user_id = u.id)
    ) order by u.created_at desc)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_delete_account(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := public.assert_admin();
  why text := btrim(coalesce(p_reason, ''));
begin
  if why = '' or char_length(why) > 500 then
    raise exception 'Escribe el motivo (hasta 500 caracteres)' using errcode = '22023';
  end if;
  if exists (select 1 from public.app_admins a where a.user_id = p_user) then
    raise exception 'Una cuenta de creador no se puede eliminar desde aquí' using errcode = '42501';
  end if;
  delete from auth.users where id = p_user;
  if not found then
    raise exception 'Esa cuenta ya no existe' using errcode = 'P0002';
  end if;
  -- El registro conserva solo el id: el correo y el nombre se van con la cuenta
  insert into public.moderation_actions (admin_id, action, reason, data)
  values (admin_id, 'delete_account', why, jsonb_build_object('user_id', p_user));
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if exists (select 1 from public.app_admins a where a.user_id = uid) then
    raise exception 'La cuenta del creador no se puede eliminar' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.admin_accounts() from public, anon;
revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_accounts() to authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;
