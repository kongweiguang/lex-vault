package org.dromara.web.ai.mapper;

import com.baomidou.mybatisplus.annotation.InterceptorIgnore;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.dromara.web.ai.domain.entity.AiUsageRecord;

import java.time.LocalDateTime;

/**
 * AI 用量流水 Mapper。
 *
 * @author kongweiguang
 */
@Mapper
@InterceptorIgnore(tenantLine = "true")
public interface AiUsageRecordMapper extends BaseMapper<AiUsageRecord> {

    /**
     * 汇总用户在指定窗口内的成功 token 总量。
     *
     * @param userId     用户主键
     * @param occurredAt 窗口开始时间
     * @return token 总量
     */
    @Select("""
        SELECT COALESCE(SUM(total_tokens), 0)
          FROM ai_usage_record
         WHERE user_id = #{userId}
           AND request_status = 'success'
           AND occurred_at >= #{occurredAt}
        """)
    Long sumSuccessTokensSince(@Param("userId") Long userId, @Param("occurredAt") LocalDateTime occurredAt);
}
