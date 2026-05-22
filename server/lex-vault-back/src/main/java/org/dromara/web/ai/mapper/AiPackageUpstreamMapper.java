package org.dromara.web.ai.mapper;

import com.baomidou.mybatisplus.annotation.InterceptorIgnore;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;

/**
 * AI 套餐上游节点 Mapper。
 *
 * @author kongweiguang
 */
@Mapper
@InterceptorIgnore(tenantLine = "true")
public interface AiPackageUpstreamMapper extends BaseMapper<AiPackageUpstream> {
}
