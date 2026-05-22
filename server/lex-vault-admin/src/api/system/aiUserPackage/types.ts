export interface AiUserPackageBindingVO {
  id?: string | number;
  userId: string | number;
  userName?: string;
  packageId: string | number;
  packageCode?: string;
  packageName?: string;
  status?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  remark?: string;
}

export interface AiUserPackageBindingForm {
  userId: string | number;
  packageId: string | number;
  effectiveFrom?: string;
  effectiveTo?: string;
  remark?: string;
}
