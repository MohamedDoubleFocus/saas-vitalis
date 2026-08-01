-- ============================================================================
-- saas-vitalis — CORRECTIF : conclure_vente() ne pouvait pas écrire
--                            `statut_paiement`
--
-- LE BUG.
--
--   column "statut_paiement" is of type public.statut_paiement
--   but expression is of type text
--
-- Toute conclusion de vente échouait, en base, à la dernière étape. Le module 3
-- écrivait :
--
--   statut_paiement = case
--                       when v_depot <= 0 then 'non_paye'
--                       when v_depot >= v_total_contrat then 'complet'
--                       else 'depot'
--                     end
--
-- POURQUOI ÇA CASSE, alors que `statut = 'vendu'` juste en dessous fonctionne.
--
-- Un littéral seul est de type `unknown` : Postgres le coerce vers le type de la
-- colonne au moment de l'affectation. Mais dès qu'il entre dans un CASE,
-- l'analyseur doit donner UN type au résultat de l'expression, et faute d'autre
-- indice il choisit `text`. Or il n'existe aucune conversion implicite de `text`
-- vers un enum — c'est délibéré du côté de Postgres. L'affectation est donc
-- refusée.
--
-- Le bug n'a pas pu être vu plus tôt : il ne se déclenche qu'à une vraie
-- conclusion de vente, et l'erreur remonte de Postgres, pas de TypeScript.
--
-- LE CORRECTIF : un cast explicite du résultat du CASE.
--
-- La fonction est recréée intégralement — `create or replace function` n'accepte
-- pas de correctif partiel. Ce corps remplace celui de
-- `20260802090000_conclure_vente.sql`. **Seule** la ligne `statut_paiement`
-- change ; tout le reste est identique, à la virgule près.
--
-- Migration idempotente.
-- ============================================================================

create or replace function public.conclure_vente(
  p_opportunite_id   uuid,
  p_client_nom       text,
  p_client_tel       text,
  p_client_courriel  text,
  p_superficie_pi2   integer,
  p_depot_recu       numeric,
  p_date_cible_debut date,
  p_date_cible_fin   date,
  p_volets           jsonb,
  p_extras           jsonb,
  p_precisions       text default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statut         public.statut_opp;
  v_role           public.role_user;
  v_total_volets   numeric(12, 2);
  v_total_extras   numeric(12, 2);
  v_total_contrat  numeric(12, 2);
  v_nb_volets      integer;
  v_nb_extras      integer;
  v_depot          numeric(12, 2);
begin
  -- --- Rôle -----------------------------------------------------------------
  -- Un knocker a le droit de modifier SES opportunités : sans ce garde-fou, il
  -- pourrait conclure une vente lui-même. Conclure est l'acte du closer.
  v_role := public.role_actuel();

  if v_role is distinct from 'closer' and v_role is distinct from 'admin' then
    raise exception 'Seul un closer peut conclure une vente.'
      using errcode = 'insufficient_privilege';
  end if;

  -- --- L'opportunité doit être visible ET verrouillable ----------------------
  -- `for update` sérialise deux closes concurrents sur le même rendez-vous.
  select o.statut
  into v_statut
  from public.opportunites o
  where o.id = p_opportunite_id
  for update;

  if not found then
    raise exception 'Rendez-vous introuvable ou non autorisé.'
      using errcode = 'insufficient_privilege';
  end if;

  -- --- Infos client ---------------------------------------------------------
  -- CLAUDE.md §4.7 : le nom est nullable au stade lead, obligatoire au close, et
  -- « validé côté serveur, pas seulement dans l'UI ». C'est ici.
  if coalesce(btrim(p_client_nom), '') = ''
     or coalesce(btrim(p_client_tel), '') = ''
     or coalesce(btrim(p_client_courriel), '') = '' then
    raise exception 'Nom, téléphone et courriel du client sont obligatoires pour conclure.'
      using errcode = 'check_violation';
  end if;

  -- --- Contenu de la vente --------------------------------------------------
  v_nb_volets := coalesce(jsonb_array_length(coalesce(p_volets, '[]'::jsonb)), 0);
  v_nb_extras := coalesce(jsonb_array_length(coalesce(p_extras, '[]'::jsonb)), 0);

  if v_nb_volets + v_nb_extras = 0 then
    raise exception 'Une vente doit contenir au moins un volet de travaux ou un extra.'
      using errcode = 'check_violation';
  end if;

  -- Les totaux sont RECALCULÉS ici : le montant affiché au client ne fait pas
  -- foi, seul celui dérivé des lignes compte.
  select coalesce(sum((v ->> 'montant')::numeric), 0)
  into v_total_volets
  from jsonb_array_elements(coalesce(p_volets, '[]'::jsonb)) v;

  select coalesce(sum((x ->> 'montant')::numeric), 0)
  into v_total_extras
  from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) x;

  v_total_contrat := v_total_volets + v_total_extras;

  if v_total_contrat <= 0 then
    raise exception 'Le total de la vente doit être supérieur à zéro.'
      using errcode = 'check_violation';
  end if;

  v_depot := coalesce(p_depot_recu, 0);

  if v_depot < 0 then
    raise exception 'Le dépôt ne peut pas être négatif.'
      using errcode = 'check_violation';
  end if;

  if p_date_cible_debut is not null
     and p_date_cible_fin is not null
     and p_date_cible_fin < p_date_cible_debut then
    raise exception 'La fin de la fenêtre cible précède son début.'
      using errcode = 'check_violation';
  end if;

  -- --- Détail : on remplace, on n'empile pas --------------------------------
  -- Rend la fonction rejouable. La file de résilience peut réémettre la même
  -- vente (coupure réseau après l'envoi mais avant la réponse) : sans ce
  -- remplacement, les volets seraient insérés deux fois et le contrat doublerait.
  delete from public.opportunite_travaux where opportunite_id = p_opportunite_id;
  delete from public.extras where opportunite_id = p_opportunite_id;

  insert into public.opportunite_travaux (
    opportunite_id, type, produit_gonano, deuxieme_couche_fortify, montant
  )
  select
    p_opportunite_id,
    (v ->> 'type')::public.type_travail,
    nullif(v ->> 'produit_gonano', '')::public.produit_gonano,
    coalesce((v ->> 'deuxieme_couche_fortify')::boolean, false),
    (v ->> 'montant')::numeric
  from jsonb_array_elements(coalesce(p_volets, '[]'::jsonb)) v;

  -- `facturable = true` par défaut : un extra vendu au close est facturé. Ceux
  -- que l'entreprise absorbe sont saisis plus tard, au chantier.
  insert into public.extras (opportunite_id, description, montant, facturable)
  select
    p_opportunite_id,
    x ->> 'description',
    (x ->> 'montant')::numeric,
    true
  from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) x;

  -- --- L'opportunité --------------------------------------------------------
  -- `montant_contrat` ne contient QUE les volets : l'invariant §4.8 calcule le
  -- solde par `montant_contrat + Σ(extras facturables) − depot_recu`. Y inclure
  -- les extras les compterait deux fois, et le calcul se casserait dès qu'un
  -- roofer ajoute un extra en cours de chantier.
  update public.opportunites
  set client_nom       = btrim(p_client_nom),
      client_tel       = btrim(p_client_tel),
      client_courriel  = btrim(p_client_courriel),
      superficie_pi2   = p_superficie_pi2,
      montant_contrat  = v_total_volets,
      depot_recu       = v_depot,
      -- ⚠️ LE CAST N'EST PAS DÉCORATIF. Un littéral seul est `unknown` et se
      -- coerce vers le type de la colonne ; dans un CASE, l'analyseur résout le
      -- résultat en `text`, et `text` → enum n'a pas de conversion implicite.
      -- Sans ce `::public.statut_paiement`, tout close échoue.
      statut_paiement  = (case
                            when v_depot <= 0 then 'non_paye'
                            when v_depot >= v_total_contrat then 'complet'
                            else 'depot'
                          end)::public.statut_paiement,
      date_cible_debut = p_date_cible_debut,
      date_cible_fin   = p_date_cible_fin,
      statut           = 'vendu',
      -- Un re-close corrige une vente, il ne la redate pas.
      vendu_le         = coalesce(vendu_le, now())
  where id = p_opportunite_id;

  if not found then
    raise exception 'Modification refusée : ce rendez-vous ne t’est pas assigné.'
      using errcode = 'insufficient_privilege';
  end if;

  -- --- Piste d'audit --------------------------------------------------------
  -- Uniquement à la PREMIÈRE conclusion : les notes forment un fil jamais
  -- écrasé (§4.10), et un rejeu ne doit pas le polluer.
  --
  -- Montant formaté sans séparateur de milliers : `to_char` avec 'G' dépend de
  -- la locale du serveur, qui n'est pas fr-CA sur Supabase.
  if v_statut is distinct from 'vendu' then
    insert into public.notes (opportunite_id, texte, auteur)
    values (
      p_opportunite_id,
      'Vente conclue — '
        || replace(to_char(v_total_contrat, 'FM9999999990.00'), '.', ',')
        || ' $'
        || case
             when coalesce(btrim(p_precisions), '') <> ''
             then chr(10) || btrim(p_precisions)
             else ''
           end,
      'Système'
    );
  end if;

  return v_total_volets;
end;
$$;

comment on function public.conclure_vente(
  uuid, text, text, text, integer, numeric, date, date, jsonb, jsonb, text
) is
  'Conclut une vente en une transaction : volets, extras, opportunité et note d''audit. Valide côté serveur. Soumise à la RLS de l''appelant.';


-- ============================================================================
-- DROITS — réaffirmés
-- ----------------------------------------------------------------------------
-- `create or replace` peut réinitialiser le propriétaire selon le contexte
-- d'exécution. C'est idempotent, et ça évite une fonction qui redevient
-- injoignable après un correctif.
-- ============================================================================

revoke all on function public.conclure_vente(
  uuid, text, text, text, integer, numeric, date, date, jsonb, jsonb, text
) from public;

revoke all on function public.conclure_vente(
  uuid, text, text, text, integer, numeric, date, date, jsonb, jsonb, text
) from anon;

grant execute on function public.conclure_vente(
  uuid, text, text, text, integer, numeric, date, date, jsonb, jsonb, text
) to authenticated;


-- ============================================================================
-- APRÈS LE PUSH
-- ----------------------------------------------------------------------------
-- La vente en attente n'est PAS perdue : la file de résilience l'a gardée en
-- local (« 1 enregistrement n'a pas pu être envoyé »). Une fois cette migration
-- appliquée, le bouton « Réessayer » la fait passer.
--
-- Aucune donnée à réparer : la fonction est transactionnelle, l'échec a tout
-- annulé. Il n'existe pas de vente à moitié écrite.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
