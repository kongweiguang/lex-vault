package org.dromara.web.ai.mapper;

import com.baomidou.mybatisplus.annotation.InterceptorIgnore;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;

import java.time.LocalDateTime;

/**
 * AI 用户套餐绑定 Mapper。
 *
 * @author kongweiguang
 */
@Mapper
@InterceptorIgnore(tenantLine = "true")
public interface AiUserPackageBindingMapper extends BaseMapper<AiUserPackageBinding> {

    /**
     * 查询用户当前生效的绑定记录。
     *
     * @param userId 用户主键
     * @param nowUtc 当前 UTC 时间
     * @return 绑定记录
     */
    @Select("""
        SELECT id,
               user_id,
               package_id,
               status,
               effective_from,
               effective_to,
               remark,
               create_time,
               update_time
          FROM ai_user_package_binding
         WHERE user_id = #{userId}
           AND status = '0'
           AND effective_from <= #{nowUtc}
           AND (effective_to IS NULL OR effective_to > #{nowUtc})
         ORDER BY effective_from DESC, update_time DESC
         LIMIT 1
        """)
    AiUserPackageBinding selectCurrentBinding(@Param("userId") Long userId, @Param("nowUtc") LocalDateTime nowUtc);
}
