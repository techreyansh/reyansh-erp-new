-- FIX: crm_pipeline_activity RLS only allowed the account OWNER (or super-admin)
-- to log/edit activities, but the parent crm_pipeline is visible to owner OR
-- unassigned OR COLLABORATOR OR super-admin. So a collaborator who can SEE an
-- account could not log an activity on it ("new row violates RLS"). Align the
-- activity policy to the account's visibility: if you can see it, you can log on it.
drop policy if exists crm_pipeline_activity_all on public.crm_pipeline_activity;
create policy crm_pipeline_activity_all on public.crm_pipeline_activity
  for all
  using (
    public.is_super_admin() OR exists (
      select 1 from public.crm_pipeline p
      where p.id = crm_pipeline_activity.pipeline_id
        and ( lower(coalesce(p.owner_email,'')) = public.rbac_current_email()
              or p.owner_email is null
              or public.crm_is_collaborator(p.id) )
    )
  )
  with check (
    public.is_super_admin() OR exists (
      select 1 from public.crm_pipeline p
      where p.id = crm_pipeline_activity.pipeline_id
        and ( lower(coalesce(p.owner_email,'')) = public.rbac_current_email()
              or p.owner_email is null
              or public.crm_is_collaborator(p.id) )
    )
  );
