import request from '@/utils/request';
import { AxiosPromise } from 'axios';
import { AiUsageQuery, AiUsageRecordVO, AiUsageSummaryVO, AiUsageTotalVO } from './types';

export function listAiUsage(query: AiUsageQuery): AxiosPromise<AiUsageRecordVO[]> {
  return request({
    url: '/system/ai/usage/list',
    method: 'get',
    params: query
  });
}

export function getAiUsageSummary(userId: string | number): AxiosPromise<AiUsageSummaryVO> {
  return request({
    url: '/system/ai/usage/summary/' + userId,
    method: 'get'
  });
}

export function getAiUsageSummaryByQuery(query: Pick<AiUsageQuery, 'userId' | 'userName'>): AxiosPromise<AiUsageSummaryVO> {
  return request({
    url: '/system/ai/usage/summary',
    method: 'get',
    params: query
  });
}

export function getAiUsageTotals(query: AiUsageQuery): AxiosPromise<AiUsageTotalVO> {
  return request({
    url: '/system/ai/usage/totals',
    method: 'get',
    params: query
  });
}
