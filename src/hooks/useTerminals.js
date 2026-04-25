import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export const TERMINALS_QUERY_KEY = ['terminals'];

export function useTerminals({ enabled = true } = {}) {
  return useQuery({
    queryKey: TERMINALS_QUERY_KEY,
    queryFn: () => base44.entities.Terminal.list('-updated_date'),
    enabled,
    refetchInterval: 30000,
  });
}