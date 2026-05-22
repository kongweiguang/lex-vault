export interface AiPackageVO extends BaseEntity {
  id: string | number;
  packageCode: string;
  packageName: string;
  status: string;
  fiveHourTokenLimit: number;
  weeklyTokenLimit: number;
  monthlyTokenLimit: number;
  remark: string;
}

export interface AiPackageQuery extends PageQuery {
  packageName?: string;
  packageCode?: string;
  status?: string;
}

export interface AiPackageForm {
  id?: string | number;
  packageCode: string;
  packageName: string;
  fiveHourTokenLimit: number;
  weeklyTokenLimit: number;
  monthlyTokenLimit: number;
  remark?: string;
}

export interface AiPackageOptionVO {
  id: string | number;
  packageCode: string;
  packageName: string;
}

export interface AiPackageUpstreamVO extends BaseEntity {
  id: string | number;
  packageId: string | number;
  upstreamName: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  reasoningJson?: string;
  weight: number;
  priority: number;
  status: string;
  remark?: string;
}

export interface AiPackageUpstreamQuery extends PageQuery {
  packageId?: string | number;
  upstreamName?: string;
  status?: string;
}

export interface AiPackageUpstreamForm {
  id?: string | number;
  packageId: string | number;
  upstreamName: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  reasoningJson?: string;
  weight: number;
  priority: number;
  remark?: string;
}
