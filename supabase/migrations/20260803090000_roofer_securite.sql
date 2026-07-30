-- ============================================================================
-- saas-vitalis — Verrous du module 4 (le roofer)
--
-- Deux trous laissés ouverts par les modules précédents, que ce module referme :
--
--   1. Les politiques du bucket `photos` (module 0) sont à l'échelle du BUCKET :
--      `using (bucket_id = 'photos')`. N'importe quel utilisateur authentifié
--      peut donc lire, déposer et surtout SUPPRIMER les photos de n'importe quel
--      chantier. Le module 0 reportait explicitement ce resserrage « quand la
--      convention de nommage sera figée ». Elle l'est : `<opportunite_id>/<uuid>`.
--
--   2. `opportunites_update_roofer` (module 1) autorise le roofer à modifier
--      TOUTE colonne de ses jobs — donc `statut = 'paye'`, mais aussi
--      `montant_contrat` ou `depot_recu`. La RLS ne sait pas restreindre par
--      colonne ni par valeur : il faut un trigger.
--
-- Aucune table, aucune colonne. Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. CHEMIN D'OBJET → OPPORTUNITÉ
-- ----------------------------------------------------------------------------
-- Les photos sont rangées sous `<opportunite_id>/<uuid>.jpg`. Cette fonction
-- extrait l'identifiant du premier segment.
--
-- Renvoie NULL si le chemin ne commence pas par un UUID (objet déposé hors
-- convention). Les politiques ci-dessous refusent alors l'accès : c'est le bon
-- défaut — un objet non rattachable n'appartient à personne.
--
-- `immutable` : le résultat ne dépend que de l'argument, Postgres peut donc
-- l'évaluer une fois par ligne sans surcoût.
-- ============================================================================

create or replace function public.opportunite_du_chemin(chemin text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(chemin, '/', 1)::uuid;
exception
  when others then
    return null;
end;
$$;

comment on function public.opportunite_du_chemin(text) is
  'Extrait l''opportunite_id du premier segment d''un chemin d''objet Storage. NULL si le chemin est hors convention.';

revoke all on function public.opportunite_du_chemin(text) from public;
grant execute on function public.opportunite_du_chemin(text) to authenticated;


-- ============================================================================
-- 2. BUCKET photos — accès aligné sur l'accès au chantier
-- ----------------------------------------------------------------------------
-- LECTURE  : la sous-requête sur `opportunites` est elle-même soumise à la RLS.
--            Voir la photo revient donc exactement à voir le chantier — un
--            roofer ne voit que les siens, un knocker voit tout (sa politique
--            SELECT est large), un closer voit les siens et tout ce qui a
--            atteint `rdv`.
-- ÉCRITURE : `peut_modifier_opportunite()` — le même prédicat que les tables
--            `photos`, `extras` et `notes`. Une seule règle à faire évoluer.
-- ============================================================================

drop policy if exists photos_bucket_authenticated_select on storage.objects;
drop policy if exists photos_bucket_authenticated_insert on storage.objects;
drop policy if exists photos_bucket_authenticated_delete on storage.objects;

drop policy if exists photos_bucket_select on storage.objects;
create policy photos_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and exists (
      select 1
      from public.opportunites o
      where o.id = public.opportunite_du_chemin(name)
    )
  );

drop policy if exists photos_bucket_insert on storage.objects;
create policy photos_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and public.peut_modifier_opportunite(public.opportunite_du_chemin(name))
  );

drop policy if exists photos_bucket_delete on storage.objects;
create policy photos_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and public.peut_modifier_opportunite(public.opportunite_du_chemin(name))
  );

-- Pas de politique UPDATE : une photo se remplace par suppression + dépôt, ce
-- qui garde l'objet du bucket et la ligne `photos` alignés (même règle qu'au
-- module 1 pour la table).


-- ============================================================================
-- 3. TRIGGER — ce qu'un roofer a le droit de changer
-- ----------------------------------------------------------------------------
-- Le roofer exécute, il ne facture pas. Il ne peut donc toucher QUE `statut`,
-- et seulement le long de la chaîne d'exécution, une étape à la fois — en avant
-- comme en arrière (CLAUDE.md §6).
--
--   vendu → planifie → en_cours → complete
--
-- `facture`, `paye`, `perdu` lui sont fermés, ainsi que tous les montants, les
-- dates cibles et les assignations.
--
-- Ne s'applique QU'au rôle roofer : admin, service_role et migrations
-- (`role_actuel()` à NULL) passent librement.
-- ============================================================================

create or replace function public.opportunites_restreindre_maj_roofer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_temoin public.opportunites%rowtype;
begin
  if public.role_actuel() is distinct from 'roofer' then
    return new;
  end if;

  -- Copie de NEW ramenée aux valeurs d'origine pour les deux seuls champs dont
  -- le changement est légitime. Si quoi que ce soit d'AUTRE a bougé, la copie
  -- diffère de OLD.
  --
  -- Comparer la ligne entière plutôt qu'énumérer 28 colonnes : une colonne
  -- ajoutée plus tard est protégée d'office, sans que personne ait à y penser.
  v_temoin := new;
  v_temoin.statut := old.statut;
  -- `set_updated_at` (module 0) est aussi un BEFORE UPDATE : selon l'ordre
  -- d'exécution, NEW.updated_at peut déjà avoir été réécrit.
  v_temoin.updated_at := old.updated_at;

  if v_temoin is distinct from old then
    raise exception
      'Un roofer ne peut modifier que le statut d''exécution de ses chantiers.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.statut is distinct from old.statut
     and not (
       (old.statut = 'vendu'    and new.statut = 'planifie')
       or (old.statut = 'planifie' and new.statut = 'en_cours')
       or (old.statut = 'en_cours' and new.statut in ('planifie', 'complete'))
       or (old.statut = 'complete' and new.statut = 'en_cours')
     ) then
    raise exception
      'Transition de statut non autorisée pour un roofer : % → %.', old.statut, new.statut
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.opportunites_restreindre_maj_roofer() is
  'Trigger : limite un roofer au seul champ statut, et aux transitions de la chaîne d''exécution.';

drop trigger if exists trg_opportunites_restreindre_maj_roofer on public.opportunites;
create trigger trg_opportunites_restreindre_maj_roofer
  before update on public.opportunites
  for each row
  execute function public.opportunites_restreindre_maj_roofer();


-- ============================================================================
-- 4. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- Les politiques de `public.photos`, `public.opportunites`, `public.extras` et
-- `public.notes` sont intactes. Le trigger ne remplace pas la RLS : il la
-- complète là où elle ne sait pas descendre (colonne, valeur).
-- ============================================================================
