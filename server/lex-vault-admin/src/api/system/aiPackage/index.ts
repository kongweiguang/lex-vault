import request from '@/utils/request';
import { AxiosPromise } from 'axios';
import {
  AiPackageForm,
  AiPackageOptionVO,
  AiPackageQuery,
  AiPackageUpstreamForm,
  AiPackageUpstreamQuery,
  AiPackageUpstreamVO,
  AiPackageVO
} from './types';

export function listAiPackage(query: AiPackageQuery): AxiosPromise<AiPackageVO[]> {
  return request({
    url: '/system/ai/package/list',
    method: 'get',
    params: query
  });
}

export function getAiPackage(id: string | number): AxiosPromise<AiPackageVO> {
  return request({
    url: '/system/ai/package/' + id,
    method: 'get'
  });
}

export function addAiPackage(data: AiPackageForm) {
  return request({
    url: '/system/ai/package',
    method: 'post',
    data
  });
}

export function updateAiPackage(data: AiPackageForm) {
  return request({
    url: '/system/ai/package',
    method: 'put',
    data
  });
}

export function changeAiPackageStatus(id: string | number, status: string) {
  return request({
    url: '/system/ai/package/changeStatus',
    method: 'put',
    data: { id, status }
  });
}

export function delAiPackage(id: string | number) {
  return request({
    url: '/system/ai/package/' + id,
    method: 'delete'
  });
}

export function listAiPackageOptions(): AxiosPromise<AiPackageOptionVO[]> {
  return request({
    url: '/system/ai/package/options',
    method: 'get'
  });
}

export function listAiPackageUpstream(query: AiPackageUpstreamQuery): AxiosPromise<AiPackageUpstreamVO[]> {
  return request({
    url: '/system/ai/package/upstream/list',
    method: 'get',
    params: query
  });
}

export function getAiPackageUpstream(id: string | number): AxiosPromise<AiPackageUpstreamVO> {
  return request({
    url: '/system/ai/package/upstream/' + id,
    method: 'get'
  });
}

export function addAiPackageUpstream(data: AiPackageUpstreamForm) {
  return request({
    url: '/system/ai/package/upstream',
    method: 'post',
    data
  });
}

export function updateAiPackageUpstream(data: AiPackageUpstreamForm) {
  return request({
    url: '/system/ai/package/upstream',
    method: 'put',
    data
  });
}

export function changeAiPackageUpstreamStatus(id: string | number, status: string) {
  return request({
    url: '/system/ai/package/upstream/changeStatus',
    method: 'put',
    data: { id, status }
  });
}

export function delAiPackageUpstream(id: string | number) {
  return request({
    url: '/system/ai/package/upstream/' + id,
    method: 'delete'
  });
}
