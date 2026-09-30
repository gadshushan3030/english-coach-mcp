export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      exercises: {
        Row: {
          answer: string
          attempt: number
          checked_by: string
          created_at: string
          expected: string | null
          id: string
          question: string
          request_id: string
          result: string
          session_id: string | null
          user_id: string
          word_id: string | null
        }
        Insert: {
          answer: string
          attempt?: number
          checked_by: string
          created_at?: string
          expected?: string | null
          id?: string
          question: string
          request_id: string
          result: string
          session_id?: string | null
          user_id?: string
          word_id?: string | null
        }
        Update: {
          answer?: string
          attempt?: number
          checked_by?: string
          created_at?: string
          expected?: string | null
          id?: string
          question?: string
          request_id?: string
          result?: string
          session_id?: string | null
          user_id?: string
          word_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercises_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "words"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          completed_at: string | null
          comprehension: number | null
          corrections: Json
          day: string
          feedback: string | null
          grammar: number | null
          id: string
          level: string
          mode: string
          new_words: Json
          pronunciation: number | null
          request_id: string
          sentences: Json
          source: string
          started_at: string
          topic: string
          user_id: string
          vocabulary: number | null
        }
        Insert: {
          completed_at?: string | null
          comprehension?: number | null
          corrections?: Json
          day?: string
          feedback?: string | null
          grammar?: number | null
          id?: string
          level: string
          mode?: string
          new_words?: Json
          pronunciation?: number | null
          request_id: string
          sentences?: Json
          source?: string
          started_at?: string
          topic: string
          user_id?: string
          vocabulary?: number | null
        }
        Update: {
          completed_at?: string | null
          comprehension?: number | null
          corrections?: Json
          day?: string
          feedback?: string | null
          grammar?: number | null
          id?: string
          level?: string
          mode?: string
          new_words?: Json
          pronunciation?: number | null
          request_id?: string
          sentences?: Json
          source?: string
          started_at?: string
          topic?: string
          user_id?: string
          vocabulary?: number | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: number
          knew: boolean
          reviewed_at: string
          user_id: string
          word_id: string
        }
        Insert: {
          id?: never
          knew: boolean
          reviewed_at?: string
          user_id?: string
          word_id: string
        }
        Update: {
          id?: never
          knew?: boolean
          reviewed_at?: string
          user_id?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "words"
            referencedColumns: ["id"]
          },
        ]
      }
      words: {
        Row: {
          box: number
          created_at: string
          due_at: string
          english: string
          example: string | null
          hebrew: string
          id: string
          last_reviewed_at: string | null
          review_count: number
          status: string
          user_id: string
        }
        Insert: {
          box?: number
          created_at?: string
          due_at?: string
          english: string
          example?: string | null
          hebrew: string
          id?: string
          last_reviewed_at?: string | null
          review_count?: number
          status?: string
          user_id?: string
        }
        Update: {
          box?: number
          created_at?: string
          due_at?: string
          english?: string
          example?: string | null
          hebrew?: string
          id?: string
          last_reviewed_at?: string | null
          review_count?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      box_interval: { Args: { p_box: number }; Returns: string }
      finish_practice: {
        Args: {
          p_checked_by?: string
          p_comprehension?: number
          p_corrections?: Json
          p_exercises?: Json
          p_feedback?: string
          p_grammar?: number
          p_new_words?: Json
          p_pronunciation?: number
          p_sentences?: Json
          p_session_id: string
          p_vocabulary?: number
        }
        Returns: string
      }
      record_exercise: {
        Args: {
          p_answer: string
          p_attempt?: number
          p_checked_by?: string
          p_expected?: string
          p_question: string
          p_request_id: string
          p_result: string
          p_session_id?: string
          p_word?: string
        }
        Returns: string
      }
      review_word: {
        Args: { p_knew: boolean; p_word_id: string }
        Returns: undefined
      }
      session_is_active: { Args: never; Returns: boolean }
      set_word_familiarity: {
        Args: { p_level: number; p_word: string }
        Returns: string
      }
      start_practice: {
        Args: {
          p_level: string
          p_mode?: string
          p_request_id: string
          p_source?: string
          p_topic: string
        }
        Returns: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

