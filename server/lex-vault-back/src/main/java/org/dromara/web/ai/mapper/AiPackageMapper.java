package org.dromara.web.ai.mapper;

import com.baomidou.mybatisplus.annotation.InterceptorIgnore;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.dromara.web.ai.domain.entity.AiPackage;

/**
 * AI 套餐 Mapper。
 *
 * @author kongweiguang
 */
@Mapper
@InterceptorIgnore(tenantLine = "true")
public interface AiPackageMapper extends BaseMapper<AiPackage> {
}
