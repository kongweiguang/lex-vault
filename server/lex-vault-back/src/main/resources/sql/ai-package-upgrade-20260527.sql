-- AI 套餐旧库升级脚本：补齐上游节点扩展参数字段。
-- 报错 Unknown column 'extra_params_json' in 'field list' 时，在目标业务库执行本脚本。
ALTER TABLE ai_package_upstream
    ADD COLUMN extra_params_json TEXT NULL COMMENT '扩展请求参数 JSON，会合并到上游请求体顶层' AFTER model;
