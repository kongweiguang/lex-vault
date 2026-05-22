export interface AiUsageRecordVO extends BaseEntity {
  id: string | number;
  requestId: string;
  userId: string | number;
  userName?: string;
  packageId?: string | number;
  packageName?: string;
  upstreamId?: string | number;
  upstreamName?: string;
  streaming: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageSource: string;
  requestStatus: string;
  rejectReason?: string;
  occurredAt: string;
}

export interface AiUsageQuery extends PageQuery {
  userId?: string | number;
  userName?: string;
  packageId?: string | number;
  requestStatus?: string;
  occurredFrom?: string;
  occurredTo?: string;
}

export interface AiUsageSummaryVO {
  userId: string | number;
  userName?: string;
  packageId: string | number;
  packageCode: string;
  packageName: string;
  fiveHourUsedTokens: number;
  fiveHourTokenLimit: number;
  weeklyUsedTokens: number;
  weeklyTokenLimit: number;
  monthlyUsedTokens: number;
  monthlyTokenLimit: number;
}
