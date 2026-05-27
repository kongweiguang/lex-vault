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

    /**
     * 汇总用户在指定固定周期内的成功 token 总量。
     *
     * @param userId 用户主键
     * @param startAt 周期开始时间
     * @param endAt 周期结束时间
     * @return token 总量
     */
    @Select("""
        SELECT COALESCE(SUM(total_tokens), 0)
          FROM ai_usage_record
         WHERE user_id = #{userId}
           AND request_status = 'success'
           AND occurred_at >= #{startAt}
           AND occurred_at < #{endAt}
        """)
    Long sumSuccessTokensBetween(@Param("userId") Long userId,
                                 @Param("startAt") LocalDateTime startAt,
                                 @Param("endAt") LocalDateTime endAt);

    /**
     * 查询用户在当前套餐绑定内的第一条成功用量。
     *
     * @param userId 用户主键
     * @param startAt 绑定开始时间
     * @param endAt 查询截止时间
     * @return 第一条成功用量
     */
    @Select("""
        SELECT id,
               request_id,
               user_id,
               package_id,
               upstream_id,
               streaming,
               input_tokens,
               output_tokens,
               total_tokens,
               usage_source,
               request_status,
               reject_reason,
               occurred_at,
               create_time,
               update_time
          FROM ai_usage_record
         WHERE user_id = #{userId}
           AND request_status = 'success'
           AND occurred_at >= #{startAt}
           AND occurred_at < #{endAt}
         ORDER BY occurred_at ASC, id ASC
         LIMIT 1
        """)
    AiUsageRecord selectFirstSuccessRecordBetween(@Param("userId") Long userId,
                                                  @Param("startAt") LocalDateTime startAt,
                                                  @Param("endAt") LocalDateTime endAt);
}
