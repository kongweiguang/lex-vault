<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="560px" append-to-body @close="handleClose">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
      <el-alert v-if="currentBinding?.packageName" type="info" :closable="false" class="mb-[12px]">
        <template #title>
          当前绑定：{{ currentBinding.packageName }}（{{ currentBinding.packageCode }}）
          <span v-if="currentBinding.effectiveFrom">，生效：{{ currentBinding.effectiveFrom }}</span>
          <span v-if="currentBinding.effectiveTo"> 至 {{ currentBinding.effectiveTo }}</span>
        </template>
      </el-alert>

      <el-form-item label="套餐" prop="packageId">
        <el-select v-model="form.packageId" placeholder="请选择套餐" clearable style="width: 100%">
          <el-option v-for="item in packageOptions" :key="item.id" :label="item.packageName" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="开始时间" prop="effectiveFrom">
        <el-date-picker v-model="form.effectiveFrom" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="不填默认立即生效" style="width: 100%" />
      </el-form-item>
      <el-form-item label="结束时间" prop="effectiveTo">
        <el-date-picker v-model="form.effectiveTo" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="不填表示长期有效" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" placeholder="请输入备注" />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="currentBinding?.packageId" type="danger" plain @click="handleUnbind">解除当前绑定</el-button>
        <el-button :loading="buttonLoading" type="primary" @click="submitForm">保 存</el-button>
        <el-button @click="handleClose">取 消</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { listAiPackageOptions } from '@/api/system/aiPackage';
import { AiPackageOptionVO } from '@/api/system/aiPackage/types';
import { bindAiUserPackage, getCurrentAiUserPackage, unbindAiUserPackage } from '@/api/system/aiUserPackage';
import { AiUserPackageBindingForm, AiUserPackageBindingVO } from '@/api/system/aiUserPackage/types';
import { UserVO } from '@/api/system/user/types';

const { proxy } = getCurrentInstance() as ComponentInternalInstance;
const emit = defineEmits(['success']);

const visible = ref(false);
const buttonLoading = ref(false);
const packageOptions = ref<AiPackageOptionVO[]>([]);
const currentBinding = ref<AiUserPackageBindingVO | null>(null);
const currentUser = ref<UserVO | null>(null);

const dialogTitle = computed(() => {
  return currentUser.value ? `绑定 AI 套餐 - ${currentUser.value.userName}` : '绑定 AI 套餐';
});

const initFormData: AiUserPackageBindingForm = {
  userId: '',
  packageId: '',
  effectiveFrom: '',
  effectiveTo: '',
  remark: ''
};

const form = ref<AiUserPackageBindingForm>({ ...initFormData });
const formRef = ref<ElFormInstance>();
const rules = reactive<FormRules>({
  packageId: [{ required: true, message: '请选择套餐', trigger: 'change' }]
});

const loadPackageOptions = async () => {
  const res = await listAiPackageOptions();
  packageOptions.value = res.data;
};

const loadCurrentBinding = async () => {
  if (!currentUser.value) return;
  const res = await getCurrentAiUserPackage(currentUser.value.userId);
  currentBinding.value = res.data || null;
};

const open = async (user: UserVO) => {
  currentUser.value = user;
  form.value = { ...initFormData, userId: user.userId };
  visible.value = true;
  await Promise.all([loadPackageOptions(), loadCurrentBinding()]);
};

const submitForm = () => {
  formRef.value?.validate(async (valid) => {
    if (!valid) return;
    buttonLoading.value = true;
    try {
      await bindAiUserPackage(form.value);
      proxy?.$modal.msgSuccess('绑定成功');
      visible.value = false;
      emit('success');
    } finally {
      buttonLoading.value = false;
    }
  });
};

const handleUnbind = async () => {
  if (!currentUser.value) return;
  await proxy?.$modal.confirm(`是否确认解除用户 "${currentUser.value.userName}" 的当前套餐绑定？`);
  await unbindAiUserPackage(currentUser.value.userId);
  proxy?.$modal.msgSuccess('解除绑定成功');
  visible.value = false;
  emit('success');
};

const handleClose = () => {
  visible.value = false;
  currentBinding.value = null;
  currentUser.value = null;
  form.value = { ...initFormData };
  formRef.value?.resetFields();
};

defineExpose({
  open
});
</script>
