import { useQuery } from "@tanstack/react-query";
import { api, type SearchParams } from "../api/client";

export function useSearch(params: SearchParams, enabled = true) {
  return useQuery({
    queryKey: ["search", params],
    queryFn: () => api.search(params),
    enabled,
    staleTime: 10_000,
  });
}
