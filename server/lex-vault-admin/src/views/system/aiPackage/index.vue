<template>
  <div class="p-2">
    <transition :enter-active-class="proxy?.animate.searchAnimate.enter" :leave-active-class="proxy?.animate.searchAnimate.leave">
      <div v-show="showSearch" class="mb-[10px]">
        <el-card shadow="hover">
          <el-form ref="queryFormRef" :model="queryParams" :inline="true">
            <el-form-item label="套餐名称" prop="packageName">
              <el-input v-model="queryParams.packageName" placeholder="请输入套餐名称" clearable @keyup.enter="handleQuery" />
            </el-form-item>
            <el-form-item label="套餐编码" prop="packageCode">
              <el-select v-model="queryParams.packageCode" placeholder="请选择套餐编码" clearable style="width: 180px">
                <el-option label="Plus" value="plus" />
                <el-option label="Pro" value="pro" />
                <el-option label="Max" value="max" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" icon="Search" @click="handleQuery">搜索</el-button>
              <el-button icon="Refresh" @click="resetQuery">重置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>
    </transition>

    <el-card shadow="hover">
      <template #header>
        <el-row :gutter="10">
          <el-col :span="1.5">
            <el-button v-hasPermi="['system:aiPackage:add']" type="primary" plain icon="Plus" @click="handleAdd">新增套餐</el-button>
          </el-col>
          <right-toolbar v-model:show-search="showSearch" @query-table="getList"></right-toolbar>
        </el-row>
      </template>

      <el-table v-loading="loading" border :data="packageList">
        <el-table-column label="套餐编码" align="center" prop="packageCode" width="120" />
        <el-table-column label="套餐名称" align="center" prop="packageName" min-width="140" />
        <el-table-column label="5小时限额" align="center" prop="fiveHourTokenLimit" min-width="120" />
        <el-table-column label="周限额" align="center" prop="weeklyTokenLimit" min-width="120" />
        <el-table-column label="状态" align="center" width="100">
          <template #default="scope">
            <el-switch v-model="scope.row.status" active-value="0" inactive-value="1" @change="handleStatusChange(scope.row)"></el-switch>
          </template>
        </el-table-column>
        <el-table-column label="备注" align="center" prop="remark" min-width="160" :show-overflow-tooltip="true" />
        <el-table-column label="操作" align="center" width="220" class-name="small-padding fixed-width">
          <template #default="scope">
            <el-tooltip content="编辑套餐" placement="top">
              <el-button v-hasPermi="['system:aiPackage:edit']" link type="primary" icon="Edit" @click="handleUpdate(scope.row)"></el-button>
            </el-tooltip>
            <el-tooltip content="上游池" placement="top">
              <el-button v-hasPermi="['system:aiPackage:edit']" link type="primary" icon="Connection" @click="openUpstreamDrawer(scope.row)"></el-button>
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <el-button v-hasPermi="['system:aiPackage:remove']" link type="primary" icon="Delete" @click="handleDelete(scope.row)"></el-button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <pagination v-show="total > 0" v-model:page="queryParams.pageNum" v-model:limit="queryParams.pageSize" :total="total" @pagination="getList" />
    </el-card>

    <el-dialog v-model="dialog.visible" :title="dialog.title" width="560px" append-to-body>
      <el-form ref="packageFormRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="套餐编码" prop="packageCode">
          <el-select v-model="form.packageCode" :disabled="!!form.id" placeholder="请选择套餐编码" style="width: 100%">
            <el-option label="Plus" value="plus" />
            <el-option label="Pro" value="pro" />
            <el-option label="Max" value="max" />
          </el-select>
        </el-form-item>
        <el-form-item label="套餐名称" prop="packageName">
          <el-input v-model="form.packageName" placeholder="请输入套餐名称" />
        </el-form-item>
        <el-form-item label="5小时限额" prop="fiveHourTokenLimit">
          <el-input-number v-model="form.fiveHourTokenLimit" :min="0" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="周限额" prop="weeklyTokenLimit">
          <el-input-number v-model="form.weeklyTokenLimit" :min="0" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :loading="buttonLoading" type="primary" @click="submitForm">确 定</el-button>
          <el-button @click="cancel">取 消</el-button>
        </div>
      </template>
    </el-dialog>

    <el-drawer v-model="upstreamDrawerVisible" :title="upstreamDrawerTitle" size="68%">
      <div class="mb-[10px] flex items-center justify-between gap-3">
        <div class="text-[13px] text-[var(--el-text-color-secondary)]">
          当前套餐：{{ currentPackage?.packageName }}（{{ currentPackage?.packageCode }}）
        </div>
        <el-button v-hasPermi="['system:aiPackage:edit']" type="primary" plain icon="Plus" @click="handleUpstreamAdd">新增上游节点</el-button>
      </div>

      <el-table v-loading="upstreamLoading" border :data="upstreamList">
        <el-table-column label="名称" align="center" prop="upstreamName" min-width="150" />
        <el-table-column label="地址" align="center" prop="baseUrl" min-width="240" :show-overflow-tooltip="true" />
        <el-table-column label="模型" align="center" prop="model" min-width="130" />
        <el-table-column label="优先级" align="center" prop="priority" width="100" />
        <el-table-column label="权重" align="center" prop="weight" width="100" />
        <el-table-column label="状态" align="center" width="100">
          <template #default="scope">
            <el-switch v-model="scope.row.status" active-value="0" inactive-value="1" @change="handleUpstreamStatusChange(scope.row)"></el-switch>
          </template>
        </el-table-column>
        <el-table-column label="操作" align="center" width="180">
          <template #default="scope">
            <el-button link type="primary" icon="Edit" @click="handleUpstreamUpdate(scope.row)"></el-button>
            <el-button link type="primary" icon="Delete" @click="handleUpstreamDelete(scope.row)"></el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-dialog v-model="upstreamDialog.visible" :title="upstreamDialog.title" width="700px" append-to-body>
        <el-form ref="upstreamFormRef" :model="upstreamForm" :rules="upstreamRules" label-width="110px">
          <el-form-item label="上游名称" prop="upstreamName">
            <el-input v-model="upstreamForm.upstreamName" placeholder="请输入节点名称" />
          </el-form-item>
          <el-form-item label="上游地址" prop="baseUrl">
            <el-input v-model="upstreamForm.baseUrl" placeholder="请输入完整 responses 地址" />
          </el-form-item>
          <el-form-item label="模型" prop="model">
            <el-input v-model="upstreamForm.model" placeholder="请输入模型名称" />
          </el-form-item>
          <el-form-item label="API Key" prop="apiKey">
            <el-input v-model="upstreamForm.apiKey" type="password" show-password placeholder="请输入 API Key" />
          </el-form-item>
          <el-form-item label="扩展参数 JSON" prop="extraParamsJson">
            <el-input v-model="upstreamForm.extraParamsJson" type="textarea" :rows="4" placeholder='例如 {"reasoning":{"effort":"medium"},"reasoning_split":true}' />
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="优先级" prop="priority">
                <el-input-number v-model="upstreamForm.priority" :min="0" controls-position="right" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="权重" prop="weight">
                <el-input-number v-model="upstreamForm.weight" :min="1" controls-position="right" style="width: 100%" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="备注" prop="remark">
            <el-input v-model="upstreamForm.remark" type="textarea" placeholder="请输入备注" />
          </el-form-item>
        </el-form>
        <template #footer>
          <div class="dialog-footer">
            <el-button :loading="upstreamButtonLoading" type="primary" @click="submitUpstreamForm">确 定</el-button>
            <el-button @click="cancelUpstreamDialog">取 消</el-button>
          </div>
        </template>
      </el-dialog>
    </el-drawer>
  </div>
</template>

<script setup name="AiPackage" lang="ts">
import {
  addAiPackage,
  addAiPackageUpstream,
  changeAiPackageStatus,
  changeAiPackageUpstreamStatus,
  delAiPackage,
  delAiPackageUpstream,
  getAiPackage,
  getAiPackageUpstream,
  listAiPackage,
  listAiPackageUpstream,
  updateAiPackage,
  updateAiPackageUpstream
} from '@/api/system/aiPackage';
import {
  AiPackageForm,
  AiPackageQuery,
  AiPackageUpstreamForm,
  AiPackageUpstreamQuery,
  AiPackageUpstreamVO,
  AiPackageVO
} from '@/api/system/aiPackage/types';

const { proxy } = getCurrentInstance() as ComponentInternalInstance;

const loading = ref(false);
const buttonLoading = ref(false);
const upstreamLoading = ref(false);
const upstreamButtonLoading = ref(false);
const showSearch = ref(true);
const total = ref(0);
const packageList = ref<AiPackageVO[]>([]);
const upstreamList = ref<AiPackageUpstreamVO[]>([]);
const currentPackage = ref<AiPackageVO>();
const upstreamDrawerVisible = ref(false);
const upstreamDrawerTitle = ref('套餐上游池');

const queryFormRef = ref<ElFormInstance>();
const packageFormRef = ref<ElFormInstance>();
const upstreamFormRef = ref<ElFormInstance>();

const dialog = reactive<DialogOption>({
  visible: false,
  title: ''
});

const upstreamDialog = reactive<DialogOption>({
  visible: false,
  title: ''
});

const initFormData: AiPackageForm = {
  packageCode: 'plus',
  packageName: '',
  fiveHourTokenLimit: 0,
  weeklyTokenLimit: 0,
  remark: ''
};

const initUpstreamFormData: AiPackageUpstreamForm = {
  packageId: '',
  upstreamName: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  extraParamsJson: '',
  weight: 1,
  priority: 0,
  remark: ''
};

const data = reactive<PageData<AiPackageForm, AiPackageQuery>>({
  form: { ...initFormData },
  queryParams: {
    pageNum: 1,
    pageSize: 10,
    packageName: '',
    packageCode: ''
  },
  rules: {
    packageCode: [{ required: true, message: '套餐编码不能为空', trigger: 'change' }],
    packageName: [{ required: true, message: '套餐名称不能为空', trigger: 'blur' }],
    fiveHourTokenLimit: [{ required: true, message: '5小时限额不能为空', trigger: 'blur' }],
    weeklyTokenLimit: [{ required: true, message: '周限额不能为空', trigger: 'blur' }]
  }
});

const upstreamQuery = reactive<AiPackageUpstreamQuery>({
  pageNum: 1,
  pageSize: 100,
  packageId: ''
});

const upstreamForm = ref<AiPackageUpstreamForm>({ ...initUpstreamFormData });
const upstreamRules = reactive<FormRules>({
  upstreamName: [{ required: true, message: '上游名称不能为空', trigger: 'blur' }],
  baseUrl: [{ required: true, message: '上游地址不能为空', trigger: 'blur' }],
  model: [{ required: true, message: '模型不能为空', trigger: 'blur' }],
  weight: [{ required: true, message: '权重不能为空', trigger: 'blur' }],
  priority: [{ required: true, message: '优先级不能为空', trigger: 'blur' }]
});

const { queryParams, form, rules } = toRefs(data);

const getList = async () => {
  loading.value = true;
  const res = await listAiPackage(queryParams.value);
  packageList.value = res.rows;
  total.value = res.total;
  loading.value = false;
};

const handleQuery = () => {
  queryParams.value.pageNum = 1;
  getList();
};

const resetQuery = () => {
  queryFormRef.value?.resetFields();
  handleQuery();
};

const reset = () => {
  form.value = { ...initFormData };
  packageFormRef.value?.resetFields();
};

const handleAdd = () => {
  reset();
  dialog.visible = true;
  dialog.title = '新增 AI 套餐';
};

const handleUpdate = async (row: AiPackageVO) => {
  reset();
  const res = await getAiPackage(row.id);
  form.value = { ...res.data };
  dialog.visible = true;
  dialog.title = '编辑 AI 套餐';
};

const submitForm = () => {
  packageFormRef.value?.validate(async (valid) => {
    if (!valid) return;
    buttonLoading.value = true;
    try {
      if (form.value.id) {
        await updateAiPackage(form.value);
      } else {
        await addAiPackage(form.value);
      }
      proxy?.$modal.msgSuccess('操作成功');
      dialog.visible = false;
      await getList();
    } finally {
      buttonLoading.value = false;
    }
  });
};

const cancel = () => {
  dialog.visible = false;
  reset();
};

const handleStatusChange = async (row: AiPackageVO) => {
  const text = row.status === '0' ? '启用' : '停用';
  try {
    await proxy?.$modal.confirm(`确认要"${text}""${row.packageName}"套餐吗？`);
    await changeAiPackageStatus(row.id, row.status);
    proxy?.$modal.msgSuccess(text + '成功');
  } catch {
    row.status = row.status === '0' ? '1' : '0';
  }
};

const handleDelete = async (row: AiPackageVO) => {
  await proxy?.$modal.confirm(`是否确认删除"${row.packageName}"套餐？`);
  await delAiPackage(row.id);
  proxy?.$modal.msgSuccess('删除成功');
  await getList();
};

const openUpstreamDrawer = async (row: AiPackageVO) => {
  currentPackage.value = row;
  upstreamDrawerTitle.value = `上游池管理 - ${row.packageName}`;
  upstreamQuery.packageId = row.id;
  upstreamDrawerVisible.value = true;
  await getUpstreamList();
};

const getUpstreamList = async () => {
  if (!upstreamQuery.packageId) return;
  upstreamLoading.value = true;
  const res = await listAiPackageUpstream(upstreamQuery);
  upstreamList.value = res.rows;
  upstreamLoading.value = false;
};

const resetUpstreamForm = () => {
  upstreamForm.value = {
    ...initUpstreamFormData,
    packageId: currentPackage.value?.id || ''
  };
  upstreamFormRef.value?.resetFields();
};

const handleUpstreamAdd = () => {
  resetUpstreamForm();
  upstreamDialog.visible = true;
  upstreamDialog.title = '新增上游节点';
};

const handleUpstreamUpdate = async (row: AiPackageUpstreamVO) => {
  resetUpstreamForm();
  const res = await getAiPackageUpstream(row.id);
  upstreamForm.value = { ...res.data };
  upstreamDialog.visible = true;
  upstreamDialog.title = '编辑上游节点';
};

const submitUpstreamForm = () => {
  upstreamFormRef.value?.validate(async (valid) => {
    if (!valid) return;
    upstreamButtonLoading.value = true;
    try {
      if (upstreamForm.value.id) {
        await updateAiPackageUpstream(upstreamForm.value);
      } else {
        await addAiPackageUpstream(upstreamForm.value);
      }
      proxy?.$modal.msgSuccess('操作成功');
      upstreamDialog.visible = false;
      await getUpstreamList();
    } finally {
      upstreamButtonLoading.value = false;
    }
  });
};

const cancelUpstreamDialog = () => {
  upstreamDialog.visible = false;
  resetUpstreamForm();
};

const handleUpstreamStatusChange = async (row: AiPackageUpstreamVO) => {
  const text = row.status === '0' ? '启用' : '停用';
  try {
    await proxy?.$modal.confirm(`确认要"${text}""${row.upstreamName}"节点吗？`);
    await changeAiPackageUpstreamStatus(row.id, row.status);
    proxy?.$modal.msgSuccess(text + '成功');
  } catch {
    row.status = row.status === '0' ? '1' : '0';
  }
};

const handleUpstreamDelete = async (row: AiPackageUpstreamVO) => {
  await proxy?.$modal.confirm(`是否确认删除"${row.upstreamName}"节点？`);
  await delAiPackageUpstream(row.id);
  proxy?.$modal.msgSuccess('删除成功');
  await getUpstreamList();
};

onMounted(() => {
  getList();
});
</script>
