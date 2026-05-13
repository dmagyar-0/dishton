// Placeholder. Replace with the output of:
//   supabase gen types typescript --local --schema app > src/lib/database.types.ts
// once the local Supabase stack is running.
//
// The permissive shape below loses per-query type-safety; that's intentional
// for the bootstrap and will tighten as soon as the stack is live.

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

type GenericRow = { [k: string]: Json | unknown };

type GenericTable = {
  Row: GenericRow;
  Insert: GenericRow;
  Update: GenericRow;
  Relationships: [];
};

export type Database = {
  app: {
    Tables: {
      profiles: GenericTable;
      households: GenericTable;
      household_members: GenericTable;
      follows: GenericTable;
      household_invites: GenericTable;
      household_follow_codes: GenericTable;
      recipes: GenericTable;
      recipe_ingredients: GenericTable;
      recipe_steps: GenericTable;
      recipe_tags: GenericTable;
      recipe_translations: GenericTable;
      import_jobs: GenericTable;
      ai_rate_budget: GenericTable;
      feature_flags: GenericTable;
      [k: string]: GenericTable;
    };
    Views: { [k: string]: { Row: GenericRow } };
    Functions: {
      redeem_invite: { Args: { p_code: string }; Returns: string };
      create_invite: { Args: { p_household: string }; Returns: string };
      add_follow: { Args: { p_code: string }; Returns: string };
      create_follow_code: { Args: { p_household: string }; Returns: string };
      leave_household: { Args: { p_household: string }; Returns: void };
      transfer_ownership: {
        Args: { p_household: string; p_new_owner: string };
        Returns: void;
      };
      search_recipes: { Args: { q: string; household_ids: string[] }; Returns: GenericRow[] };
      popular_tags: {
        Args: { p_household_ids: string[]; p_limit: number };
        Returns: { tag: string; n: number }[];
      };
      save_recipe: { Args: { p_household: string; p_draft: Json }; Returns: string };
      update_recipe: { Args: { p_id: string; p_draft: Json }; Returns: void };
      promote_hero_image: {
        Args: { p_recipe: string; p_import_path: string };
        Returns: void;
      };
      [k: string]: { Args: Record<string, unknown>; Returns: unknown };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
