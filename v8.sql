-- HullHub 1.2.1: PDF e file grandi dei documenti condivisi con la barca (bucket privato "boatdocs")
-- Percorso: <boat_id>/<id documento>.<ext>. Leggono e scrivono solo i membri della barca (non i fornitori).
insert into storage.buckets (id, name, public, file_size_limit)
values ('boatdocs', 'boatdocs', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists boatdocs_sel on storage.objects;
create policy boatdocs_sel on storage.objects for select to authenticated
  using (bucket_id = 'boatdocs' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists boatdocs_ins on storage.objects;
create policy boatdocs_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'boatdocs' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists boatdocs_upd on storage.objects;
create policy boatdocs_upd on storage.objects for update to authenticated
  using (bucket_id = 'boatdocs' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'boatdocs' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists boatdocs_del on storage.objects;
create policy boatdocs_del on storage.objects for delete to authenticated
  using (bucket_id = 'boatdocs' and public.is_member(((storage.foldername(name))[1])::uuid));
