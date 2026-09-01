"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type MyProject = {
  id: string;
  status: string;
  updated_at: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
};

/** Every secondary page (Cover Designer, Formatter, Research, Metadata, Compliance Check, My Books) needs this same list. */
export function useMyProjects() {
  const supabase = createClient();
  const [projects, setProjects] = useState<MyProject[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("projects")
        .select("id, status, updated_at, project_identity(working_title, subtitle)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (!cancelled) setProjects((data as unknown as MyProject[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return projects;
}
