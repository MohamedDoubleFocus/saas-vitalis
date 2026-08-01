export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      extras: {
        Row: {
          created_at: string
          description: string
          facturable: boolean
          id: string
          montant: number
          opportunite_id: string
        }
        Insert: {
          created_at?: string
          description: string
          facturable?: boolean
          id?: string
          montant: number
          opportunite_id: string
        }
        Update: {
          created_at?: string
          description?: string
          facturable?: boolean
          id?: string
          montant?: number
          opportunite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extras_opportunite_id_fkey"
            columns: ["opportunite_id"]
            isOneToOne: false
            referencedRelation: "opportunites"
            referencedColumns: ["id"]
          },
        ]
      }
      google_credentials: {
        Row: {
          connecte_le: string
          courriel: string | null
          id: string
          maj_le: string
          portee: string | null
          refresh_token: string
        }
        Insert: {
          connecte_le?: string
          courriel?: string | null
          id?: string
          maj_le?: string
          portee?: string | null
          refresh_token: string
        }
        Update: {
          connecte_le?: string
          courriel?: string | null
          id?: string
          maj_le?: string
          portee?: string | null
          refresh_token?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          auteur: string | null
          created_at: string
          id: string
          opportunite_id: string
          texte: string
        }
        Insert: {
          auteur?: string | null
          created_at?: string
          id?: string
          opportunite_id: string
          texte: string
        }
        Update: {
          auteur?: string | null
          created_at?: string
          id?: string
          opportunite_id?: string
          texte?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_opportunite_id_fkey"
            columns: ["opportunite_id"]
            isOneToOne: false
            referencedRelation: "opportunites"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunite_travaux: {
        Row: {
          created_at: string
          deuxieme_couche_fortify: boolean
          id: string
          montant: number
          opportunite_id: string
          produit_gonano: Database["public"]["Enums"]["produit_gonano"] | null
          type: Database["public"]["Enums"]["type_travail"]
        }
        Insert: {
          created_at?: string
          deuxieme_couche_fortify?: boolean
          id?: string
          montant: number
          opportunite_id: string
          produit_gonano?: Database["public"]["Enums"]["produit_gonano"] | null
          type: Database["public"]["Enums"]["type_travail"]
        }
        Update: {
          created_at?: string
          deuxieme_couche_fortify?: boolean
          id?: string
          montant?: number
          opportunite_id?: string
          produit_gonano?: Database["public"]["Enums"]["produit_gonano"] | null
          type?: Database["public"]["Enums"]["type_travail"]
        }
        Relationships: [
          {
            foreignKeyName: "opportunite_travaux_opportunite_id_fkey"
            columns: ["opportunite_id"]
            isOneToOne: false
            referencedRelation: "opportunites"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunites: {
        Row: {
          adresse: string
          client_courriel: string | null
          client_nom: string | null
          client_tel: string | null
          closer_id: string | null
          code_postal: string | null
          created_at: string
          date_cible_debut: string | null
          date_cible_fin: string | null
          date_confirmee: string | null
          date_rdv: string | null
          depot_recu: number
          derniere_visite: string
          google_event_id: string | null
          id: string
          knocker_id: string | null
          latitude: number | null
          longitude: number | null
          montant_contrat: number | null
          nb_reports: number
          nb_visites: number
          rappel_sms_envoye_le: string | null
          roofer_id: string | null
          statut: Database["public"]["Enums"]["statut_opp"]
          statut_paiement: Database["public"]["Enums"]["statut_paiement"]
          superficie_pi2: number | null
          territoire_id: string | null
          updated_at: string
          vendu_le: string | null
          ville: string | null
        }
        Insert: {
          adresse: string
          client_courriel?: string | null
          client_nom?: string | null
          client_tel?: string | null
          closer_id?: string | null
          code_postal?: string | null
          created_at?: string
          date_cible_debut?: string | null
          date_cible_fin?: string | null
          date_confirmee?: string | null
          date_rdv?: string | null
          depot_recu?: number
          derniere_visite?: string
          google_event_id?: string | null
          id?: string
          knocker_id?: string | null
          latitude?: number | null
          longitude?: number | null
          montant_contrat?: number | null
          nb_reports?: number
          nb_visites?: number
          rappel_sms_envoye_le?: string | null
          roofer_id?: string | null
          statut?: Database["public"]["Enums"]["statut_opp"]
          statut_paiement?: Database["public"]["Enums"]["statut_paiement"]
          superficie_pi2?: number | null
          territoire_id?: string | null
          updated_at?: string
          vendu_le?: string | null
          ville?: string | null
        }
        Update: {
          adresse?: string
          client_courriel?: string | null
          client_nom?: string | null
          client_tel?: string | null
          closer_id?: string | null
          code_postal?: string | null
          created_at?: string
          date_cible_debut?: string | null
          date_cible_fin?: string | null
          date_confirmee?: string | null
          date_rdv?: string | null
          depot_recu?: number
          derniere_visite?: string
          google_event_id?: string | null
          id?: string
          knocker_id?: string | null
          latitude?: number | null
          longitude?: number | null
          montant_contrat?: number | null
          nb_reports?: number
          nb_visites?: number
          rappel_sms_envoye_le?: string | null
          roofer_id?: string | null
          statut?: Database["public"]["Enums"]["statut_opp"]
          statut_paiement?: Database["public"]["Enums"]["statut_paiement"]
          superficie_pi2?: number | null
          territoire_id?: string | null
          updated_at?: string
          vendu_le?: string | null
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunites_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_roofer_id_fkey"
            columns: ["roofer_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_roofer_id_fkey"
            columns: ["roofer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunites_territoire_id_fkey"
            columns: ["territoire_id"]
            isOneToOne: false
            referencedRelation: "territoires"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          id: string
          opportunite_id: string
          photo_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          opportunite_id: string
          photo_url: string
        }
        Update: {
          created_at?: string
          id?: string
          opportunite_id?: string
          photo_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_opportunite_id_fkey"
            columns: ["opportunite_id"]
            isOneToOne: false
            referencedRelation: "opportunites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          actif: boolean
          closer_id: string | null
          created_at: string
          google_calendar_id: string | null
          est_manager: boolean
          fait_du_terrain: boolean
          id: string
          manager_id: string | null
          nom_complet: string | null
          openphone_number: string | null
          role: Database["public"]["Enums"]["role_user"]
        }
        Insert: {
          actif?: boolean
          closer_id?: string | null
          created_at?: string
          google_calendar_id?: string | null
          est_manager?: boolean
          fait_du_terrain?: boolean
          id: string
          manager_id?: string | null
          nom_complet?: string | null
          openphone_number?: string | null
          role: Database["public"]["Enums"]["role_user"]
        }
        Update: {
          actif?: boolean
          closer_id?: string | null
          created_at?: string
          google_calendar_id?: string | null
          est_manager?: boolean
          fait_du_terrain?: boolean
          id?: string
          manager_id?: string | null
          nom_complet?: string | null
          openphone_number?: string | null
          role?: Database["public"]["Enums"]["role_user"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      secteurs: {
        Row: {
          created_at: string
          cree_par: string | null
          id: string
          knocker_id: string | null
          nom: string
          notes: string | null
          polygone: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          cree_par?: string | null
          id?: string
          knocker_id?: string | null
          nom: string
          notes?: string | null
          polygone: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          cree_par?: string | null
          id?: string
          knocker_id?: string | null
          nom?: string
          notes?: string | null
          polygone?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "secteurs_cree_par_fkey"
            columns: ["cree_par"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secteurs_cree_par_fkey"
            columns: ["cree_par"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secteurs_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secteurs_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      territoires: {
        Row: {
          complete: boolean
          complete_le: string | null
          complete_par: string | null
          created_at: string
          geometrie: Json | null
          id: string
          knocker_id: string | null
          nom_normalise: string | null
          nom_rue: string
          secteur_id: string | null
          ville: string | null
        }
        Insert: {
          complete?: boolean
          complete_le?: string | null
          complete_par?: string | null
          created_at?: string
          geometrie?: Json | null
          id?: string
          knocker_id?: string | null
          nom_normalise?: string | null
          nom_rue: string
          secteur_id?: string | null
          ville?: string | null
        }
        Update: {
          complete?: boolean
          complete_le?: string | null
          complete_par?: string | null
          created_at?: string
          geometrie?: Json | null
          id?: string
          knocker_id?: string | null
          nom_normalise?: string | null
          nom_rue?: string
          secteur_id?: string | null
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "territoires_complete_par_fkey"
            columns: ["complete_par"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territoires_complete_par_fkey"
            columns: ["complete_par"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territoires_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "annuaire_profils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territoires_knocker_id_fkey"
            columns: ["knocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territoires_secteur_id_fkey"
            columns: ["secteur_id"]
            isOneToOne: false
            referencedRelation: "secteurs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      annuaire_profils: {
        Row: {
          fait_du_terrain: boolean | null
          id: string | null
          nom_complet: string | null
          role: Database["public"]["Enums"]["role_user"] | null
        }
        Insert: {
          fait_du_terrain?: boolean | null
          id?: string | null
          nom_complet?: string | null
          role?: Database["public"]["Enums"]["role_user"] | null
        }
        Update: {
          fait_du_terrain?: boolean | null
          id?: string | null
          nom_complet?: string | null
          role?: Database["public"]["Enums"]["role_user"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      conclure_vente: {
        Args: {
          p_client_courriel: string
          p_client_nom: string
          p_client_tel: string
          p_date_cible_debut: string
          p_date_cible_fin: string
          p_depot_recu: number
          p_extras: Json
          p_opportunite_id: string
          p_precisions?: string
          p_superficie_pi2: number
          p_volets: Json
        }
        Returns: number
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      est_admin: { Args: never; Returns: boolean }
      opportunite_du_chemin: { Args: { chemin: string }; Returns: string }
      peut_modifier_opportunite: {
        Args: { p_opportunite_id: string }
        Returns: boolean
      }
      role_actuel: {
        Args: never
        Returns: Database["public"]["Enums"]["role_user"]
      }
    }
    Enums: {
      produit_gonano: "fortify" | "revive" | "bio_boost"
      role_user: "knocker" | "closer" | "roofer" | "admin"
      statut_opp:
        | "absent"
        | "refus"
        | "repasser"
        | "rdv"
        | "vendu"
        | "planifie"
        | "en_cours"
        | "complete"
        | "facture"
        | "paye"
        | "perdu"
      statut_paiement: "non_paye" | "depot" | "complet"
      type_travail:
        | "traitement_gonano"
        | "refection_bardeaux"
        | "refection_metal"
        | "gouttieres"
        | "autre"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      produit_gonano: ["fortify", "revive", "bio_boost"],
      role_user: ["knocker", "closer", "roofer", "admin"],
      statut_opp: [
        "absent",
        "refus",
        "repasser",
        "rdv",
        "vendu",
        "planifie",
        "en_cours",
        "complete",
        "facture",
        "paye",
        "perdu",
      ],
      statut_paiement: ["non_paye", "depot", "complet"],
      type_travail: [
        "traitement_gonano",
        "refection_bardeaux",
        "refection_metal",
        "gouttieres",
        "autre",
      ],
    },
  },
} as const
