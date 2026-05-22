-- =========================================================
-- AI 套餐后台菜单初始化脚本
-- 说明：
-- 1. 该脚本用于把 plus-ui 中已实现的 AI 套餐页面挂到动态菜单。
-- 2. 页面路径对应：
--    - system/aiPackage/index
--    - system/aiUsage/index
-- 3. 同时补充用户列表中的“绑定 AI 套餐”按钮权限点。
-- 4. 脚本兼容非自增 menu_id 的 RuoYi-Vue-Plus 初始化库结构。
-- =========================================================

-- ---------------------------------------------------------
-- 预处理：定位默认创建人和创建部门
-- 说明：
-- 1. 当前库的 create_by / update_by / create_dept 均为数值字段。
-- 2. 因此这里优先读取 admin 账号信息；若不存在则分别回退到 1 / 103。
-- ---------------------------------------------------------
SET @system_create_by = (
    SELECT user_id
      FROM sys_user
     WHERE user_name = 'admin'
     ORDER BY user_id
     LIMIT 1
);

SET @system_create_by = IFNULL(@system_create_by, 1);

SET @system_create_dept = (
    SELECT dept_id
      FROM sys_user
     WHERE user_id = @system_create_by
     LIMIT 1
);

SET @system_create_dept = IFNULL(@system_create_dept, 103);

-- ---------------------------------------------------------
-- 第 1 步：定位基础父菜单
-- ---------------------------------------------------------
SET @system_menu_id = (
    SELECT menu_id
      FROM sys_menu
     WHERE menu_name = '系统管理'
       AND parent_id = 0
     ORDER BY menu_id
     LIMIT 1
);

SET @user_menu_id = (
    SELECT menu_id
      FROM sys_menu
     WHERE path = 'user'
       AND menu_type = 'C'
     ORDER BY menu_id
     LIMIT 1
);

-- ---------------------------------------------------------
-- 第 2 步：为本次新增菜单预留主键
-- 说明：
-- 1. 当前 sys_menu.menu_id 不是自增字段，必须显式写入主键。
-- 2. 这里基于当前最大 menu_id 预分配连续编号，避免和现有菜单冲突。
-- ---------------------------------------------------------
SET @menu_seed = (
    SELECT IFNULL(MAX(menu_id), 0)
      FROM sys_menu
);

SET @ai_package_menu_new_id = @menu_seed + 1;
SET @ai_package_query_new_id = @menu_seed + 2;
SET @ai_package_add_new_id = @menu_seed + 3;
SET @ai_package_edit_new_id = @menu_seed + 4;
SET @ai_package_remove_new_id = @menu_seed + 5;
SET @ai_usage_menu_new_id = @menu_seed + 6;
SET @ai_usage_list_new_id = @menu_seed + 7;
SET @ai_usage_query_new_id = @menu_seed + 8;
SET @ai_user_package_edit_new_id = @menu_seed + 9;
SET @ai_user_package_query_new_id = @menu_seed + 10;

-- ---------------------------------------------------------
-- 第 3 步：创建 AI 套餐管理菜单和按钮
-- ---------------------------------------------------------
INSERT INTO sys_menu (
    menu_id,
    menu_name,
    parent_id,
    order_num,
    path,
    component,
    query_param,
    is_frame,
    is_cache,
    menu_type,
    visible,
    status,
    perms,
    icon,
    create_dept,
    create_by,
    create_time,
    update_by,
    update_time,
    remark
)
SELECT
    @ai_package_menu_new_id,
    'AI套餐管理',
    @system_menu_id,
    96,
    'aiPackage',
    'system/aiPackage/index',
    '',
    1,
    0,
    'C',
    '0',
    '0',
    'system:aiPackage:list',
    'Guide',
    @system_create_dept,
    @system_create_by,
    NOW(),
    NULL,
    NULL,
    'AI 套餐管理页面'
FROM dual
WHERE @system_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE path = 'aiPackage'
          OR perms = 'system:aiPackage:list'
  );

SET @ai_package_menu_id = (
    SELECT menu_id
      FROM sys_menu
     WHERE path = 'aiPackage'
     ORDER BY menu_id DESC
     LIMIT 1
);

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_package_query_new_id, 'AI套餐查询', @ai_package_menu_id, 1, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiPackage:query', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 套餐查询按钮'
FROM dual
WHERE @ai_package_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_package_menu_id
         AND perms = 'system:aiPackage:query'
  );

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_package_add_new_id, 'AI套餐新增', @ai_package_menu_id, 2, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiPackage:add', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 套餐新增按钮'
FROM dual
WHERE @ai_package_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_package_menu_id
         AND perms = 'system:aiPackage:add'
  );

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_package_edit_new_id, 'AI套餐修改', @ai_package_menu_id, 3, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiPackage:edit', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 套餐修改按钮'
FROM dual
WHERE @ai_package_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_package_menu_id
         AND perms = 'system:aiPackage:edit'
  );

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_package_remove_new_id, 'AI套餐删除', @ai_package_menu_id, 4, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiPackage:remove', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 套餐删除按钮'
FROM dual
WHERE @ai_package_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_package_menu_id
         AND perms = 'system:aiPackage:remove'
  );

-- ---------------------------------------------------------
-- 第 4 步：创建 AI 用量查询菜单和按钮
-- ---------------------------------------------------------
INSERT INTO sys_menu (
    menu_id,
    menu_name,
    parent_id,
    order_num,
    path,
    component,
    query_param,
    is_frame,
    is_cache,
    menu_type,
    visible,
    status,
    perms,
    icon,
    create_dept,
    create_by,
    create_time,
    update_by,
    update_time,
    remark
)
SELECT
    @ai_usage_menu_new_id,
    'AI用量查询',
    @system_menu_id,
    97,
    'aiUsage',
    'system/aiUsage/index',
    '',
    1,
    0,
    'C',
    '0',
    '0',
    'system:aiUsage:list',
    'Histogram',
    @system_create_dept,
    @system_create_by,
    NOW(),
    NULL,
    NULL,
    'AI 用量查询页面'
FROM dual
WHERE @system_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE path = 'aiUsage'
          OR perms = 'system:aiUsage:list'
  );

SET @ai_usage_menu_id = (
    SELECT menu_id
      FROM sys_menu
     WHERE path = 'aiUsage'
     ORDER BY menu_id DESC
     LIMIT 1
);

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_usage_list_new_id, 'AI用量列表', @ai_usage_menu_id, 1, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiUsage:list', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 用量流水列表权限'
FROM dual
WHERE @ai_usage_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_usage_menu_id
         AND perms = 'system:aiUsage:list'
         AND menu_type = 'F'
  );

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_usage_query_new_id, 'AI用量汇总', @ai_usage_menu_id, 2, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiUsage:query', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, 'AI 用户窗口汇总权限'
FROM dual
WHERE @ai_usage_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @ai_usage_menu_id
         AND perms = 'system:aiUsage:query'
  );

-- ---------------------------------------------------------
-- 第 5 步：在用户管理下补充 AI 套餐绑定按钮权限
-- ---------------------------------------------------------
INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_user_package_edit_new_id, 'AI套餐绑定', @user_menu_id, 99, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiUserPackage:edit', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, '用户列表中的 AI 套餐绑定按钮'
FROM dual
WHERE @user_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @user_menu_id
         AND perms = 'system:aiUserPackage:edit'
  );

INSERT INTO sys_menu (
    menu_id, menu_name, parent_id, order_num, path, component, query_param, is_frame, is_cache,
    menu_type, visible, status, perms, icon, create_dept, create_by, create_time, update_by, update_time, remark
)
SELECT @ai_user_package_query_new_id, 'AI套餐绑定查询', @user_menu_id, 100, '', '', '', 1, 0, 'F', '0', '0',
       'system:aiUserPackage:query', '#', @system_create_dept, @system_create_by, NOW(), NULL, NULL, '查询用户当前 AI 套餐绑定权限'
FROM dual
WHERE @user_menu_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
        FROM sys_menu
       WHERE parent_id = @user_menu_id
         AND perms = 'system:aiUserPackage:query'
  );

-- ---------------------------------------------------------
-- 第 6 步：授权给超级管理员角色
-- 说明：
-- 1. 兼容 role_key 为 superadmin 或 admin 的两种项目初始化方式。
-- 2. 如果两者都存在，优先使用 superadmin。
-- ---------------------------------------------------------
SET @system_role_id = (
    SELECT role_id
      FROM sys_role
     WHERE role_key IN ('superadmin', 'admin')
     ORDER BY CASE role_key
                  WHEN 'superadmin' THEN 0
                  WHEN 'admin' THEN 1
                  ELSE 2
              END,
              role_id
     LIMIT 1
);

INSERT INTO sys_role_menu (role_id, menu_id)
SELECT @system_role_id, menu_id
  FROM sys_menu
 WHERE @system_role_id IS NOT NULL
   AND (
       perms IN (
           'system:aiPackage:list',
           'system:aiPackage:query',
           'system:aiPackage:add',
           'system:aiPackage:edit',
           'system:aiPackage:remove',
           'system:aiUsage:list',
           'system:aiUsage:query',
           'system:aiUserPackage:edit',
           'system:aiUserPackage:query'
       )
       OR path IN ('aiPackage', 'aiUsage')
   )
   AND NOT EXISTS (
       SELECT 1
         FROM sys_role_menu rm
        WHERE rm.role_id = @system_role_id
          AND rm.menu_id = sys_menu.menu_id
   );

-- ---------------------------------------------------------
-- 第 7 步：校验结果
-- ---------------------------------------------------------
SELECT menu_id, parent_id, menu_name, path, component, menu_type, perms, icon, status
  FROM sys_menu
 WHERE perms IN (
        'system:aiPackage:list',
        'system:aiPackage:query',
        'system:aiPackage:add',
        'system:aiPackage:edit',
        'system:aiPackage:remove',
        'system:aiUsage:list',
        'system:aiUsage:query',
        'system:aiUserPackage:edit',
        'system:aiUserPackage:query'
    )
    OR path IN ('aiPackage', 'aiUsage')
 ORDER BY parent_id, order_num, menu_id;
