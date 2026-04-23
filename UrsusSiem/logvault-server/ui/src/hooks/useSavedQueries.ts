import { useState, useCallback } from "react";

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  pdql: string;
  timeRange: string;
  starred: boolean;
  created_at: string;
}

const STORAGE_KEY = "ursus_saved_queries";

function load(): SavedQuery[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persist(queries: SavedQuery[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
}

export function useSavedQueries() {
  const [queries, setQueries] = useState<SavedQuery[]>(load);

  const save = useCallback((pdql: string, name: string, description = "", timeRange = "1h") => {
    const q: SavedQuery = {
      id: `uq-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      pdql,
      timeRange,
      starred: false,
      created_at: new Date().toISOString(),
    };
    setQueries((prev) => {
      const next = [q, ...prev];
      persist(next);
      return next;
    });
    return q;
  }, []);

  const remove = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.filter((q) => q.id !== id);
      persist(next);
      return next;
    });
  }, []);

  const toggleStar = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.map((q) => (q.id === id ? { ...q, starred: !q.starred } : q));
      persist(next);
      return next;
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<SavedQuery>) => {
    setQueries((prev) => {
      const next = prev.map((q) => (q.id === id ? { ...q, ...patch } : q));
      persist(next);
      return next;
    });
  }, []);

  return { queries, save, remove, toggleStar, update };
}
