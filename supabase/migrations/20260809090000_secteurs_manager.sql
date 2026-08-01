-- ============================================================================
-- saas-vitalis — Le field manager découpe et attribue ses secteurs
--
-- CE QUI CHANGE, ET POURQUOI ÇA MÉRITE UNE RELECTURE ATTENTIVE.
--
-- Jusqu'ici le manager était STRICTEMENT EN LECTURE SEULE : la migration
-- `manager` ne lui accordait que des politiques SELECT. Cette migration revient
-- sur cette décision, volontairement et de façon bornée : il peut désormais
-- créer des secteurs et les attribuer à SES knockers.
--
-- Le périmètre est tenu par une seule fonction, `peut_gerer_secteur()` :
--   • l'admin gère tout ;
--   • un manager actif gère les secteurs QU'IL A CRÉÉS (`cree_par = lui`).
--
-- Il ne peut donc pas toucher au secteur d'un autre manager, ni attribuer une
-- rue à un knocker qui n'est pas dans son équipe.
--
-- Ce qu'il ne gagne PAS : aucun droit sur `opportunites`. Superviser les leads
-- de son équipe reste une lecture seule (migration `manager`, section 3).
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. peut_gerer_secteur()
-- ----------------------------------------------------------------------------
-- `security definer` : la fonction lit `secteurs` et `profiles` sans repasser
-- par leur RLS, ce qui casserait en récursion depuis une politique de
-- `secteurs`.
-- ============================================================================

create or replace function public.peut_gerer_secteur(p_secteur_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.est_admin()
    or (
      public.est_manager()
      and exists (
        select 1
        from public.secteurs s
        where s.id = p_secteur_id
          and s.cree_par = auth.uid()
      )
    )
$$;

comment on function public.peut_gerer_secteur(uuid) is
  'Vrai si l''utilisateur courant peut modifier ce secteur : admin, ou manager actif qui l''a créé.';

revoke all on function public.peut_gerer_secteur(uuid) from public;
grant execute on function public.peut_gerer_secteur(uuid) to authenticated;


-- ============================================================================
-- 2. secteurs — LE MANAGER CRÉE ET GÈRE LES SIENS
-- ----------------------------------------------------------------------------
-- Politiques ADDITIVES : `secteurs_admin_tout` et `secteurs_select_terrain`
-- restent en place et se combinent en OU.
-- ============================================================================

-- SELECT : ses propres secteurs. On ne peut pas passer par
-- `peut_gerer_secteur()` ici — la fonction relit `secteurs`, ce qui coûterait
-- une sous-requête par ligne pour tester ce que la ligne elle-même porte déjà.
drop policy if exists secteurs_select_manager on public.secteurs;
create policy secteurs_select_manager on public.secteurs
  for select to authenticated
  using (
    (select public.est_manager())
    and cree_par = (select auth.uid())
  );

-- INSERT : il doit se déclarer créateur. Sans ce `with check`, un manager
-- pourrait créer un secteur au nom de quelqu'un d'autre — et le perdre aussitôt,
-- puisqu'il ne le reverrait plus.
drop policy if exists secteurs_insert_manager on public.secteurs;
create policy secteurs_insert_manager on public.secteurs
  for insert to authenticated
  with check (
    (select public.est_manager())
    and cree_par = (select auth.uid())
    and (
      knocker_id is null
      or knocker_id in (select public.knockers_geres())
    )
  );

-- UPDATE : c'est ici que se fait l'attribution (`knocker_id`).
-- Le `with check` interdit deux choses : donner le secteur à quelqu'un hors de
-- son équipe, et le « refiler » à un autre créateur pour s'en défaire.
drop policy if exists secteurs_update_manager on public.secteurs;
create policy secteurs_update_manager on public.secteurs
  for update to authenticated
  using (
    (select public.est_manager())
    and cree_par = (select auth.uid())
  )
  with check (
    (select public.est_manager())
    and cree_par = (select auth.uid())
    and (
      knocker_id is null
      or knocker_id in (select public.knockers_geres())
    )
  );

drop policy if exists secteurs_delete_manager on public.secteurs;
create policy secteurs_delete_manager on public.secteurs
  for delete to authenticated
  using (
    (select public.est_manager())
    and cree_par = (select auth.uid())
  );


-- ============================================================================
-- 3. territoires — LES RUES DE SES SECTEURS
-- ----------------------------------------------------------------------------
-- Le manager n'écrit jamais une rue « libre » : toujours à travers un secteur
-- qu'il a créé. `secteur_id` est donc obligatoire dans ses écritures — c'est ce
-- qui borne le tout.
-- ============================================================================

drop policy if exists territoires_select_manager_secteur on public.territoires;
create policy territoires_select_manager_secteur on public.territoires
  for select to authenticated
  using (secteur_id is not null and public.peut_gerer_secteur(secteur_id));

drop policy if exists territoires_insert_manager on public.territoires;
create policy territoires_insert_manager on public.territoires
  for insert to authenticated
  with check (secteur_id is not null and public.peut_gerer_secteur(secteur_id));

drop policy if exists territoires_update_manager on public.territoires;
create policy territoires_update_manager on public.territoires
  for update to authenticated
  using (secteur_id is not null and public.peut_gerer_secteur(secteur_id))
  with check (secteur_id is not null and public.peut_gerer_secteur(secteur_id));

-- DELETE : sert au réimport, qui vide les rues avant de les réécrire.
drop policy if exists territoires_delete_manager on public.territoires;
create policy territoires_delete_manager on public.territoires
  for delete to authenticated
  using (secteur_id is not null and public.peut_gerer_secteur(secteur_id));


-- ============================================================================
-- 4. LE TRIGGER QUI AURAIT TOUT BLOQUÉ
-- ----------------------------------------------------------------------------
-- ⚠️ SANS CETTE SECTION, LA FONCTIONNALITÉ NE MARCHERAIT PAS DU TOUT.
--
-- `territoires_restreindre_maj_knocker` refuse toute modification autre que
-- « cocher complétée » dès que `peut_cogner()` est vrai. Or Billal cogne. Il
-- serait donc bloqué sur SES PROPRES rues, au moment même où il essaie de les
-- attribuer — et le message d'erreur parlerait de knocker, ce qui ne l'aiderait
-- pas.
--
-- On laisse passer quiconque gère le secteur : l'admin (déjà exempté) et le
-- manager propriétaire. La restriction continue de s'appliquer pleinement au
-- knocker qui coche ses rues.
-- ============================================================================

create or replace function public.territoires_restreindre_maj_knocker()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_temoin public.territoires%rowtype;
begin
  -- Qui a la main sur la rue passe sans restriction.
  if public.est_admin() then
    return new;
  end if;

  if new.secteur_id is not null and public.peut_gerer_secteur(new.secteur_id) then
    return new;
  end if;

  -- Personne d'autre que le terrain n'est concerné.
  if not public.peut_cogner() then
    return new;
  end if;

  -- Comparaison de la ligne ENTIÈRE : toute colonne ajoutée plus tard est
  -- protégée par défaut, sans qu'on ait à penser à ce trigger.
  v_temoin := new;
  v_temoin.complete := old.complete;
  v_temoin.complete_le := old.complete_le;
  v_temoin.complete_par := old.complete_par;

  if v_temoin is distinct from old then
    raise exception
      'Sur le terrain, on ne peut que cocher une rue comme complétée.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Traçabilité : on sait qui a coché et quand, sans faire confiance au client.
  if new.complete is distinct from old.complete then
    if new.complete then
      new.complete_le := now();
      new.complete_par := auth.uid();
    else
      new.complete_le := null;
      new.complete_par := null;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.territoires_restreindre_maj_knocker() is
  'Trigger : limite quiconque cogne au marquage « complétée ». Laisse passer l''admin et le manager propriétaire du secteur.';


-- ============================================================================
-- 5. TRAÇABILITÉ DE L'ORIGINE OSM
-- ----------------------------------------------------------------------------
-- Le secteur ne vient plus d'un tracé à la main mais d'un quartier
-- OpenStreetMap ou d'un rayon autour d'une adresse. On garde d'où il vient :
-- sans ça, impossible de rejouer un import à l'identique, ni de savoir pourquoi
-- un contour est approximatif.
--
-- `polygone` reste NOT NULL et sert toujours à l'affichage sur la carte.
-- ============================================================================

alter table public.secteurs
  add column if not exists osm_zone_id  bigint,
  add column if not exists osm_type     text,
  add column if not exists centre       jsonb,
  add column if not exists rayon_metres integer;

comment on column public.secteurs.osm_zone_id is
  'Identifiant OpenStreetMap de la zone choisie (relation ou way). NULL pour un secteur défini par rayon.';

comment on column public.secteurs.osm_type is
  'Type OSM de la zone : « relation » ou « way ». Nécessaire pour recalculer l''area id d''Overpass.';

comment on column public.secteurs.centre is
  'Adresse de départ {lat,lng}. Renseignée pour un secteur défini par rayon, et conservée pour recentrer la carte.';

comment on column public.secteurs.rayon_metres is
  'Rayon en mètres quand le secteur est un cercle autour de `centre`. NULL pour un quartier OSM.';


-- ============================================================================
-- 6. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • `secteurs_admin_tout` : l'admin garde tout, y compris les secteurs des
--   managers.
-- • `secteurs_select_terrain` / `territoires_*_terrain` : le knocker voit et
--   coche ses rues exactement comme avant.
-- • `opportunites` : le manager y reste en LECTURE SEULE.
-- • Les secteurs déjà en base gardent leur `cree_par`. Un manager ne verra donc
--   PAS les secteurs créés par l'admin avant cette migration. Pour les lui
--   confier :
--       update public.secteurs set cree_par = '<uuid du manager>' where id = '…';
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
