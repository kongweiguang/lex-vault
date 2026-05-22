<template>
  <div class="p-2">
    <transition :enter-active-class="proxy?.animate.searchAnimate.enter" :leave-active-class="proxy?.animate.searchAnimate.leave">
      <div v-show="showSearch" class="mb-[10px]">
        <el-card shadow="hover">
          <el-form ref="queryFormRef" :model="queryParams" :inline="true">
            <el-form-item label="用户ID" prop="userId">
              <el-input v-model="queryParams.userId" placeholder="请输入用户ID" clearable />
            </el-form-item>
            <el-form-item label="用户名" prop="userName">
              <el-input v-model="queryParams.userName" placeholder="请输入用户名" clearable @keyup.enter="handleQuery" />
            </el-form-item>
            <el-form-item label="套餐" prop="packageId">
              <el-select v-model="queryParams.packageId" placeholder="请选择套餐" clearable style="width: 180px">
                <el-option v-for="item in packageOptions" :key="item.id" :label="item.packageName" :value="item.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态" prop="requestStatus">
              <el-select v-model="queryParams.requestStatus" placeholder="请选择状态" clearable style="width: 180px">
                <el-option label="成功" value="success" />
                <el-option label="失败" value="failed" />
                <el-option label="不完整" value="incomplete" />
                <el-option label="拒绝" value="rejected" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" icon="Search" @click="handleQuery">搜索</el-button>
              <el-button icon="Refresh" @click="resetQuery">重置</el-button>
              <el-button type="success" plain icon="Histogram" :disabled="!queryParams.userId && !queryParams.userName" @click="loadSummary">查看窗口汇总</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>
    </transition>

    <el-card v-if="summary" shadow="hover" class="mb-[10px]">
      <template #header>
        <div class="flex items-center justify-between">
          <span>用户 {{ summary.userName || summary.userId }} 当前窗口汇总</span>
          <span class="text-[13px] text-[var(--el-text-color-secondary)]">{{ summary.packageName }} / {{ summary.packageCode }}</span>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :md="8" :xs="24">
          <el-statistic title="5小时已用 / 限额" :value="`${summary.fiveHourUsedTokens} / ${summary.fiveHourTokenLimit}`" />
        </el-col>
        <el-col :md="8" :xs="24">
          <el-statistic title="7天已用 / 限额" :value="`${summary.weeklyUsedTokens} / ${summary.weeklyTokenLimit}`" />
        </el-col>
        <el-col :md="8" :xs="24">
          <el-statistic title="月已用 / 限额" :value="`${summary.monthlyUsedTokens} / ${summary.monthlyTokenLimit}`" />
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="hover">
      <template #header>
        <right-toolbar v-model:show-search="showSearch" @query-table="getList"></right-toolbar>
      </template>

      <el-table v-loading="loading" border :data="usageList">
        <el-table-column label="请求ID" align="center" prop="requestId" min-width="220" :show-overflow-tooltip="true" />
        <el-table-column label="用户ID" align="center" prop="userId" width="120" />
        <el-table-column label="用户名" align="center" prop="userName" min-width="120" :show-overflow-tooltip="true" />
        <el-table-column label="套餐" align="center" prop="packageName" min-width="120" />
        <el-table-column label="上游节点" align="center" prop="upstreamName" min-width="140" />
        <el-table-column label="流式" align="center" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.streaming ? 'success' : 'info'">{{ scope.row.streaming ? '是' : '否' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="输入" align="center" prop="inputTokens" width="100" />
        <el-table-column label="输出" align="center" prop="outputTokens" width="100" />
        <el-table-column label="总量" align="center" prop="totalTokens" width="100" />
        <el-table-column label="状态" align="center" prop="requestStatus" width="120" />
        <el-table-column label="原因" align="center" prop="rejectReason" min-width="180" :show-overflow-tooltip="true" />
        <el-table-column label="发生时间" align="center" prop="occurredAt" width="180" />
      </el-table>

      <pagination v-show="total > 0" v-model:page="queryParams.pageNum" v-model:limit="queryParams.pageSize" :total="total" @pagination="getList" />
    </el-card>
  </div>
</template>

<script setup name="AiUsage" lang="ts">
import { listAiPackageOptions } from '@/api/system/aiPackage';
import { AiPackageOptionVO } from '@/api/system/aiPackage/types';
import { getAiUsageSummaryByQuery, listAiUsage } from '@/api/system/aiUsage';
import { AiUsageQuery, AiUsageRecordVO, AiUsageSummaryVO } from '@/api/system/aiUsage/types';

const { proxy } = getCurrentInstance() as ComponentInternalInstance;
const route = useRoute();

const loading = ref(false);
const showSearch = ref(true);
const total = ref(0);
const usageList = ref<AiUsageRecordVO[]>([]);
const packageOptions = ref<AiPackageOptionVO[]>([]);
const summary = ref<AiUsageSummaryVO>();

const queryFormRef = ref<ElFormInstance>();

const queryParams = ref<AiUsageQuery>({
  pageNum: 1,
  pageSize: 10,
  userId: '',
  userName: '',
  packageId: '',
  requestStatus: ''
});

const getList = async () => {
  loading.value = true;
  const res = await listAiUsage(queryParams.value);
  usageList.value = res.rows;
  total.value = res.total;
  loading.value = false;
};

const handleQuery = () => {
  queryParams.value.pageNum = 1;
  getList();
};

const resetQuery = () => {
  queryFormRef.value?.resetFields();
  summary.value = undefined;
  handleQuery();
};

const loadSummary = async () => {
  if (!queryParams.value.userId && !queryParams.value.userName) return;
  const res = await getAiUsageSummaryByQuery({
    userId: queryParams.value.userId,
    userName: queryParams.value.userName
  });
  summary.value = res.data;
};

const loadPackageOptions = async () => {
  const res = await listAiPackageOptions();
  packageOptions.value = res.data;
};

onMounted(() => {
  if (route.query.userId) {
    queryParams.value.userId = route.query.userId as string;
  }
  if (route.query.userName) {
    queryParams.value.userName = route.query.userName as string;
  }
  getList();
  loadPackageOptions();
  if (queryParams.value.userId || queryParams.value.userName) {
    loadSummary();
  }
});
</script>
