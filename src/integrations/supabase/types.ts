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
  public: {
    Tables: {
      analytics_events: {
        Row: {
          event_type: string
          id: string
          payload: Json | null
          session_id: string
          ts: string
        }
        Insert: {
          event_type: string
          id?: string
          payload?: Json | null
          session_id: string
          ts?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json | null
          session_id?: string
          ts?: string
        }
        Relationships: []
      }
      chunks: {
        Row: {
          char_from: number | null
          char_to: number | null
          citation_label: string
          embedding: string | null
          embedding_model_id: string | null
          framework_id: string
          hierarchy_path: string[]
          id: string
          parent_id: string
          snapshot_id: string
          text: string
          tsv: unknown
        }
        Insert: {
          char_from?: number | null
          char_to?: number | null
          citation_label: string
          embedding?: string | null
          embedding_model_id?: string | null
          framework_id: string
          hierarchy_path: string[]
          id?: string
          parent_id: string
          snapshot_id: string
          text: string
          tsv?: unknown
        }
        Update: {
          char_from?: number | null
          char_to?: number | null
          citation_label?: string
          embedding?: string | null
          embedding_model_id?: string | null
          framework_id?: string
          hierarchy_path?: string[]
          id?: string
          parent_id?: string
          snapshot_id?: string
          text?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "chunks_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "corpus_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      conflicts: {
        Row: {
          chunk_id_a: string
          chunk_id_b: string
          id: string
          note: string
          snapshot_id: string
        }
        Insert: {
          chunk_id_a: string
          chunk_id_b: string
          id?: string
          note: string
          snapshot_id: string
        }
        Update: {
          chunk_id_a?: string
          chunk_id_b?: string
          id?: string
          note?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflicts_chunk_id_a_fkey"
            columns: ["chunk_id_a"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflicts_chunk_id_b_fkey"
            columns: ["chunk_id_b"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflicts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "corpus_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_snapshots: {
        Row: {
          created_at: string
          id: string
          snapshot_date: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          snapshot_date: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          snapshot_date?: string
          status?: string
        }
        Relationships: []
      }
      eval_results: {
        Row: {
          judge_prompt_version: string | null
          metric: string
          run_date: string
          run_id: string
          snapshot_id: string | null
          target: number | null
          value: number
        }
        Insert: {
          judge_prompt_version?: string | null
          metric: string
          run_date?: string
          run_id?: string
          snapshot_id?: string | null
          target?: number | null
          value: number
        }
        Update: {
          judge_prompt_version?: string | null
          metric?: string
          run_date?: string
          run_id?: string
          snapshot_id?: string | null
          target?: number | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "eval_results_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "corpus_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      framework_versions: {
        Row: {
          framework_id: string
          snapshot_id: string
          source_url: string | null
          version_label: string
        }
        Insert: {
          framework_id: string
          snapshot_id: string
          source_url?: string | null
          version_label: string
        }
        Update: {
          framework_id?: string
          snapshot_id?: string
          source_url?: string | null
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "framework_versions_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "framework_versions_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "corpus_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      frameworks: {
        Row: {
          dimension: string
          id: string
          name: string
        }
        Insert: {
          dimension: string
          id: string
          name: string
        }
        Update: {
          dimension?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      parents: {
        Row: {
          citation_label: string
          framework_id: string
          hierarchy_path: string[]
          id: string
          page_from: number | null
          page_to: number | null
          snapshot_id: string
          source_url: string | null
          text: string
        }
        Insert: {
          citation_label: string
          framework_id: string
          hierarchy_path: string[]
          id?: string
          page_from?: number | null
          page_to?: number | null
          snapshot_id: string
          source_url?: string | null
          text: string
        }
        Update: {
          citation_label?: string
          framework_id?: string
          hierarchy_path?: string[]
          id?: string
          page_from?: number | null
          page_to?: number | null
          snapshot_id?: string
          source_url?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "parents_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parents_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "corpus_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_chunks_by_citation: {
        Args: {
          match_count?: number
          p_framework_id?: string
          p_snapshot_id: string
          patterns: string[]
        }
        Returns: {
          citation_label: string
          framework_id: string
          hierarchy_path: string[]
          id: string
          parent_id: string
          text: string
        }[]
      }
      match_chunks_dense: {
        Args: {
          match_count?: number
          p_framework_id?: string
          p_snapshot_id: string
          query_embedding: string
        }
        Returns: {
          citation_label: string
          framework_id: string
          hierarchy_path: string[]
          id: string
          parent_id: string
          similarity: number
          text: string
        }[]
      }
      match_chunks_keyword: {
        Args: {
          match_count?: number
          p_framework_id?: string
          p_snapshot_id: string
          query_text: string
        }
        Returns: {
          citation_label: string
          framework_id: string
          hierarchy_path: string[]
          id: string
          parent_id: string
          rank: number
          text: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
