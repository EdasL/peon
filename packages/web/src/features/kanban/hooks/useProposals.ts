import { useState, useEffect, useCallback } from 'react';
import { useOpenClaw } from '@/contexts/OpenClawContext';
import type { GatewayEvent } from '@/lib/openclaw-types';

export interface KanbanProposal {
  id: string;
  type: 'create' | 'update';
  payload: Record<string, unknown>;
  sourceSessionKey?: string;
  proposedBy: string;
  proposedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  version: number;
  resolvedAt?: number;
  resolvedBy?: string;
  reason?: string;
  resultTaskId?: string;
}

export function useProposals() {
  const { rpc, subscribe, connectionState } = useOpenClaw();
  const [proposals, setProposals] = useState<KanbanProposal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProposals = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (connectionState !== 'connected') return;
    if (!silent) setLoading(true);
    try {
      const res = await rpc('proposals.list', { status: 'pending' }) as { proposals: KanbanProposal[] };
      setProposals(res.proposals ?? []);
    } catch {
      // Silent — proposals are non-critical
    } finally {
      if (!silent) setLoading(false);
    }
  }, [rpc, connectionState]);

  useEffect(() => {
    if (connectionState === 'connected') fetchProposals();
  }, [connectionState, fetchProposals]);

  useEffect(() => {
    return subscribe((event: GatewayEvent) => {
      if (
        event.event === 'proposal.created' ||
        event.event === 'proposal.resolved' ||
        event.event === 'proposals.changed'
      ) {
        fetchProposals({ silent: true });
      }
    });
  }, [subscribe, fetchProposals]);

  const pendingCount = proposals.length;

  const approveProposal = useCallback(async (id: string) => {
    const res = await rpc('proposals.approve', { id });
    setProposals((prev) => prev.filter((p) => p.id !== id));
    return res;
  }, [rpc]);

  const rejectProposal = useCallback(async (id: string, reason?: string) => {
    await rpc('proposals.reject', { id, ...(reason ? { reason } : {}) });
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }, [rpc]);

  return {
    proposals,
    pendingCount,
    loading,
    approveProposal,
    rejectProposal,
    refetch: fetchProposals,
  };
}
