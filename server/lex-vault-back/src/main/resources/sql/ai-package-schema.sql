CREATE TABLE IF NOT EXISTS ai_package (
    id BIGINT NOT NULL PRIMARY KEY COMMENT '主键',
    package_code VARCHAR(32) NOT NULL COMMENT '套餐编码，固定支持 plus/pro/max',
    package_name VARCHAR(64) NOT NULL COMMENT '套餐名称',
    status CHAR(1) NOT NULL DEFAULT '0' COMMENT '状态，0 启用，1 停用',
    five_hour_token_limit BIGINT NOT NULL DEFAULT 0 COMMENT '最近 5 小时滚动窗口 token 限额',
    weekly_token_limit BIGINT NOT NULL DEFAULT 0 COMMENT '最近 7 天滚动窗口 token 限额',
    monthly_token_limit BIGINT NOT NULL DEFAULT 0 COMMENT '废弃字段：旧版 30 天 token 限额，保留兼容历史库',
    remark VARCHAR(500) NULL COMMENT '备注',
    create_time DATETIME NULL COMMENT '创建时间',
    update_time DATETIME NULL COMMENT '更新时间',
    UNIQUE KEY uk_ai_package_code (package_code) COMMENT '套餐编码唯一索引'
) COMMENT='AI 套餐主表';

CREATE TABLE IF NOT EXISTS ai_package_upstream (
    id BIGINT NOT NULL PRIMARY KEY COMMENT '主键',
    package_id BIGINT NOT NULL COMMENT '所属套餐主键',
    upstream_name VARCHAR(128) NOT NULL COMMENT '上游节点名称',
    base_url VARCHAR(500) NOT NULL COMMENT 'OpenAI-compatible responses 完整地址',
    api_key VARCHAR(500) NULL COMMENT '上游 API Key',
    model VARCHAR(128) NOT NULL COMMENT '强制覆盖使用的模型名称',
    extra_params_json TEXT NULL COMMENT '扩展请求参数 JSON，会合并到上游请求体顶层',
    weight INT NOT NULL DEFAULT 1 COMMENT '同优先级下的调度权重，必须大于 0',
    priority INT NOT NULL DEFAULT 0 COMMENT '优先级，值越小越优先',
    status CHAR(1) NOT NULL DEFAULT '0' COMMENT '状态，0 启用，1 停用',
    remark VARCHAR(500) NULL COMMENT '备注',
    create_time DATETIME NULL COMMENT '创建时间',
    update_time DATETIME NULL COMMENT '更新时间',
    KEY idx_ai_package_upstream_package_id (package_id) COMMENT '按套餐查询上游节点索引',
    CONSTRAINT fk_ai_package_upstream_package FOREIGN KEY (package_id) REFERENCES ai_package (id)
) COMMENT='AI 套餐上游节点表';

CREATE TABLE IF NOT EXISTS ai_user_package_binding (
    id BIGINT NOT NULL PRIMARY KEY COMMENT '主键',
    user_id BIGINT NOT NULL COMMENT '用户主键',
    package_id BIGINT NOT NULL COMMENT '套餐主键',
    status CHAR(1) NOT NULL DEFAULT '0' COMMENT '状态，0 启用，1 停用',
    effective_from DATETIME NOT NULL COMMENT '生效开始时间，按 UTC 存储',
    effective_to DATETIME NULL COMMENT '生效结束时间，为空表示长期有效',
    remark VARCHAR(500) NULL COMMENT '备注',
    create_time DATETIME NULL COMMENT '创建时间',
    update_time DATETIME NULL COMMENT '更新时间',
    KEY idx_ai_user_package_binding_effective (user_id, status, effective_from, effective_to) COMMENT '用户当前生效绑定查询索引',
    CONSTRAINT fk_ai_user_package_binding_package FOREIGN KEY (package_id) REFERENCES ai_package (id)
) COMMENT='AI 用户套餐绑定表';

CREATE TABLE IF NOT EXISTS ai_usage_record (
    id BIGINT NOT NULL PRIMARY KEY COMMENT '主键',
    request_id VARCHAR(64) NOT NULL COMMENT '请求唯一标识',
    user_id BIGINT NOT NULL COMMENT '用户主键',
    package_id BIGINT NULL COMMENT '本次请求命中的套餐主键',
    upstream_id BIGINT NULL COMMENT '本次请求命中的上游节点主键',
    streaming TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否流式请求，0 否，1 是',
    input_tokens BIGINT NOT NULL DEFAULT 0 COMMENT '输入 token 数',
    output_tokens BIGINT NOT NULL DEFAULT 0 COMMENT '输出 token 数',
    total_tokens BIGINT NOT NULL DEFAULT 0 COMMENT '总 token 数',
    usage_source VARCHAR(64) NULL COMMENT '用量来源，例如 upstream_usage',
    request_status VARCHAR(32) NOT NULL COMMENT '请求状态：success/failed/incomplete/rejected',
    reject_reason VARCHAR(500) NULL COMMENT '失败、拒绝或不完整原因',
    occurred_at DATETIME NOT NULL COMMENT '发生时间，统一按 UTC 存储',
    create_time DATETIME NULL COMMENT '创建时间',
    update_time DATETIME NULL COMMENT '更新时间',
    UNIQUE KEY uk_ai_usage_record_request_id (request_id) COMMENT '请求唯一索引',
    KEY idx_ai_usage_record_user_occurred_at (user_id, occurred_at) COMMENT '用户维度时间窗口统计索引',
    KEY idx_ai_usage_record_package_occurred_at (package_id, occurred_at) COMMENT '套餐维度时间窗口统计索引',
    CONSTRAINT fk_ai_usage_record_package FOREIGN KEY (package_id) REFERENCES ai_package (id),
    CONSTRAINT fk_ai_usage_record_upstream FOREIGN KEY (upstream_id) REFERENCES ai_package_upstream (id)
) COMMENT='AI 请求用量流水表';

-- 初始化默认 Plus 套餐。
INSERT INTO ai_package (id, package_code, package_name, status, five_hour_token_limit, weekly_token_limit, monthly_token_limit, remark, create_time, update_time)
SELECT 2000000000000000001, 'plus', 'Plus', '0', 500000, 2000000, 8000000, '默认 Plus 套餐', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM ai_package WHERE package_code = 'plus');

-- 初始化默认 Pro 套餐。
INSERT INTO ai_package (id, package_code, package_name, status, five_hour_token_limit, weekly_token_limit, monthly_token_limit, remark, create_time, update_time)
SELECT 2000000000000000002, 'pro', 'Pro', '0', 1500000, 6000000, 24000000, '默认 Pro 套餐', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM ai_package WHERE package_code = 'pro');

-- 初始化默认 Max 套餐。
INSERT INTO ai_package (id, package_code, package_name, status, five_hour_token_limit, weekly_token_limit, monthly_token_limit, remark, create_time, update_time)
SELECT 2000000000000000003, 'max', 'Max', '0', 3000000, 12000000, 48000000, '默认 Max 套餐', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM ai_package WHERE package_code = 'max');
