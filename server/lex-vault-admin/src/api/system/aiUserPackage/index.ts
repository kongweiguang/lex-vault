import request from '@/utils/request';
import { AxiosPromise } from 'axios';
import { AiUserPackageBindingForm, AiUserPackageBindingVO } from './types';

export function getCurrentAiUserPackage(userId: string | number): AxiosPromise<AiUserPackageBindingVO> {
  return request({
    url: '/system/ai/user-package/current/' + userId,
    method: 'get'
  });
}

export function bindAiUserPackage(data: AiUserPackageBindingForm) {
  return request({
    url: '/system/ai/user-package/bind',
    method: 'post',
    data
  });
}

export function unbindAiUserPackage(userId: string | number) {
  return request({
    url: '/system/ai/user-package/unbind/' + userId,
    method: 'delete'
  });
}
