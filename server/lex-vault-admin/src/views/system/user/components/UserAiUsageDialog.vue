<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="1080px" append-to-body @close="handleClose">
    <div v-loading="loading">
      <el-empty v-if="!summary && !usageList.length" description="当前用户暂无 AI 套餐绑定或用量记录" />

      <template v-else>
        <el-alert
          v-if="summary?.quotaAvailableAt"
          class="mb-[12px]"
          type="warning"
          :closable="false"
          show-icon
          :title="`当前额度受限，预计 ${summary.quotaAvailableAt} 后恢复可用`"
        />

        <el-card v-if="summary" shadow="never" class="mb-[12px]">
          <template #header>
            <div class="flex items-center justify-between gap-[12px]">
              <div class="text-[15px] font-semibold">{{ summary.packageName }}（{{ summary.packageCode }}）</div>
              <div class="text-[13px] text-[var(--el-text-color-secondary)]">
                {{ formatPackagePeriod(summary) }}
              </div>
            </div>
          </template>

          <el-row :gutter="16">
            <el-col :md="8" :xs="24">
              <div class="rounded-[8px] border border-[var(--el-border-color-lighter)] p-[14px]">
                <div class="mb-[10px] text-[14px] font-medium">累计总量</div>
                <div class="grid grid-cols-2 gap-[10px] text-[13px]">
                  <div>
                    <div class="text-[var(--el-text-color-secondary)]">请求数</div>
                    <div class="mt-[4px] text-[20px] font-semibold">{{ totals.requestCount }}</div>
                  </div>
                  <div>
                    <div class="text-[var(--el-text-color-secondary)]">成功数</div>
                    <div class="mt-[4px] text-[20px] font-semibold">{{ totals.successCount }}</div>
                  </div>
                  <div>
                    <div class="text-[var(--el-text-color-secondary)]">输入</div>
                    <div class="mt-[4px] text-[16px] font-semibold">{{ totals.inputTokens }}</div>
                  </div>
                  <div>
                    <div class="text-[var(--el-text-color-secondary)]">输出</div>
                    <div class="mt-[4px] text-[16px] font-semibold">{{ totals.outputTokens }}</div>
                  </div>
                </div>
                <div class="mt-[10px] border-t border-[var(--el-border-color-lighter)] pt-[10px]">
                  <div class="text-[var(--el-text-color-secondary)] text-[13px]">累计总 Token</div>
                  <div class="mt-[4px] text-[22px] font-semibold">{{ totals.totalTokens }}</div>
                </div>
              </div>
            </el-col>
            <el-col :md="8" :xs="24">
              <div class="rounded-[8px] border border-[var(--el-border-color-lighter)] p-[14px]">
                <div class="mb-[10px] flex items-center justify-between">
                  <span class="text-[14px] font-medium">最近 5 小时</span>
                  <span class="text-[13px] text-[var(--el-text-color-secondary)]">
                    {{ summary.fiveHourUsedTokens }} / {{ summary.fiveHourTokenLimit }}
                  </span>
                </div>
                <el-progress :percentage="normalizePercent(summary.fiveHourQuotaPercent)" :stroke-width="10" />
                <div class="mt-[10px] text-[13px] text-[var(--el-text-color-secondary)]">
                  {{ formatWindowHint(summary.fiveHourQuotaAvailableAt, summary.fiveHourNextRefreshAt) }}
                </div>
              </div>
            </el-col>
            <el-col :md="8" :xs="24">
              <div class="rounded-[8px] border border-[var(--el-border-color-lighter)] p-[14px]">
                <div class="mb-[10px] flex items-center justify-between">
                  <span class="text-[14px] font-medium">最近 7 天</span>
                  <span class="text-[13px] text-[var(--el-text-color-secondary)]">
                    {{ summary.weeklyUsedTokens }} / {{ summary.weeklyTokenLimit }}
                  </span>
                </div>
                <el-progress :percentage="normalizePercent(summary.weeklyQuotaPercent)" status="success" :stroke-width="10" />
                <div class="mt-[10px] text-[13px] text-[var(--el-text-color-secondary)]">
                  {{ formatWindowHint(summary.weeklyQuotaAvailableAt, summary.weeklyNextRefreshAt) }}
                </div>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="flex items-center justify-between gap-[12px]">
              <span class="text-[15px] font-semibold">请求流水</span>
              <el-form :inline="true" :model="queryParams">
                <el-form-item class="mb-0" label="状态">
                  <el-select v-model="queryParams.requestStatus" clearable placeholder="全部状态" style="width: 140px" @change="handleQuery">
                    <el-option label="成功" value="success" />
                    <el-option label="失败" value="failed" />
                    <el-option label="不完整" value="incomplete" />
                    <el-option label="拒绝" value="rejected" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>
          </template>

          <el-table border :data="usageList">
            <el-table-column label="发生时间" align="center" prop="occurredAt" width="168" />
            <el-table-column label="请求ID" align="center" prop="requestId" min-width="220" :show-overflow-tooltip="true" />
            <el-table-column label="套餐" align="center" prop="packageName" min-width="120" />
            <el-table-column label="上游节点" align="center" prop="upstreamName" min-width="140" />
            <el-table-column label="流式" align="center" width="84">
              <template #default="scope">
                <el-tag :type="scope.row.streaming ? 'success' : 'info'">{{ scope.row.streaming ? '是' : '否' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="输入" align="center" prop="inputTokens" width="90" />
            <el-table-column label="输出" align="center" prop="outputTokens" width="90" />
            <el-table-column label="总量" align="center" prop="totalTokens" width="90" />
            <el-table-column label="状态" align="center" prop="requestStatus" width="100" />
            <el-table-column label="原因" align="center" prop="rejectReason" min-width="180" :show-overflow-tooltip="true" />
          </el-table>

          <pagination
            v-show="total > 0"
            v-model:page="queryParams.pageNum"
            v-model:limit="queryParams.pageSize"
            :total="total"
            @pagination="getList"
          />
        </el-card>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关 闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { getAiUsageSummary, getAiUsageTotals, listAiUsage } from '@/api/system/aiUsage';
import { AiUsageQuery, AiUsageRecordVO, AiUsageSummaryVO, AiUsageTotalVO } from '@/api/system/aiUsage/types';
import { UserVO } from '@/api/system/user/types';

const visible = ref(false);
const loading = ref(false);
const total = ref(0);
const usageList = ref<AiUsageRecordVO[]>([]);
const summary = ref<AiUsageSummaryVO>();
const currentUser = ref<UserVO | null>(null);
const totals = ref<AiUsageTotalVO>({
  requestCount: 0,
  successCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0
});

const queryParams = reactive<AiUsageQuery>({
  pageNum: 1,
  pageSize: 10,
  userId: '',
  requestStatus: ''
});

const dialogTitle = computed(() => {
  return currentUser.value ? `查看 AI 用量 - ${currentUser.value.userName}` : '查看 AI 用量';
});

const getList = async () => {
  if (!queryParams.userId) return;
  loading.value = true;
  try {
    const res = await listAiUsage(queryParams);
    usageList.value = res.rows;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
};

const loadSummary = async () => {
  if (!queryParams.userId) return;
  const res = await getAiUsageSummary(queryParams.userId);
  summary.value = res.data;
};

const loadTotals = async () => {
  if (!queryParams.userId) return;
  const res = await getAiUsageTotals(queryParams);
  totals.value = res.data;
};

const handleQuery = () => {
  queryParams.pageNum = 1;
  Promise.all([getList(), loadTotals()]);
};

const open = async (user: UserVO) => {
  currentUser.value = user;
  queryParams.userId = user.userId;
  queryParams.requestStatus = '';
  queryParams.pageNum = 1;
  queryParams.pageSize = 10;
  summary.value = undefined;
  totals.value = {
    requestCount: 0,
    successCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  usageList.value = [];
  total.value = 0;
  visible.value = true;
  loading.value = true;
  try {
    await Promise.all([loadSummary(), loadTotals(), getList()]);
  } finally {
    loading.value = false;
  }
};

const normalizePercent = (value?: number) => {
  if (!value || value < 0) return 0;
  return Math.min(100, Number(value.toFixed(2)));
};

const formatWindowHint = (availableAt?: string, nextRefreshAt?: string) => {
  if (availableAt) {
    return `预计 ${availableAt} 后恢复可用`;
  }
  if (nextRefreshAt) {
    return `当前可用，下次刷新时间 ${nextRefreshAt}`;
  }
  return '当前可用，尚未形成固定周期';
};

const formatPackagePeriod = (data: AiUsageSummaryVO) => {
  if (data.packageEffectiveFrom && data.packageEffectiveTo) {
    return `${data.packageEffectiveFrom} 至 ${data.packageEffectiveTo}`;
  }
  if (data.packageEffectiveFrom) {
    return `生效时间 ${data.packageEffectiveFrom}`;
  }
  return '未配置生效时间';
};

const handleClose = () => {
  visible.value = false;
  currentUser.value = null;
  summary.value = undefined;
  totals.value = {
    requestCount: 0,
    successCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  usageList.value = [];
  total.value = 0;
  queryParams.userId = '';
  queryParams.requestStatus = '';
  queryParams.pageNum = 1;
  queryParams.pageSize = 10;
};

defineExpose({
  open
});
</script>
