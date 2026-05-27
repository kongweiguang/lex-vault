package org.dromara.web.ai.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.exception.ServiceException;
import org.dromara.common.core.utils.StringUtils;
import org.dromara.system.domain.SysUser;
import org.dromara.system.mapper.SysUserMapper;
import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.form.AiPackageForm;
import org.dromara.web.ai.domain.form.AiPackageUpstreamForm;
import org.dromara.web.ai.domain.form.AiUserPackageBindingForm;
import org.dromara.web.ai.domain.query.AiPackageQuery;
import org.dromara.web.ai.domain.query.AiPackageUpstreamQuery;
import org.dromara.web.ai.domain.query.AiUsageQuery;
import org.dromara.web.ai.domain.vo.AiPackageOptionVo;
import org.dromara.web.ai.domain.vo.AiUsageRecordVo;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.domain.vo.AiUsageTotalVo;
import org.dromara.web.ai.domain.vo.AiUserPackageBindingVo;
import org.dromara.web.ai.mapper.AiPackageMapper;
import org.dromara.web.ai.mapper.AiPackageUpstreamMapper;
import org.dromara.web.ai.mapper.AiUsageRecordMapper;
import org.dromara.web.ai.mapper.AiUserPackageBindingMapper;
import org.dromara.web.ai.service.IAiAdminService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.function.Function;
import java.util.*;
import java.util.stream.Collectors;

/**
 * AI 管理域服务实现。
 *
 * @author kongweiguang
 */
@Service
@RequiredArgsConstructor
public class AiAdminServiceImpl implements IAiAdminService {

    /**
     * 启用状态。
     */
    private static final String STATUS_ENABLED = "0";

    /**
     * 停用状态。
     */
    private static final String STATUS_DISABLED = "1";

    /**
     * 时间格式化器。
     */
    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * 套餐编码白名单。
     */
    private static final Set<String> ALLOWED_PACKAGE_CODES = Set.of("plus", "pro", "max");

    /**
     * 5 小时套餐额度周期。
     */
    private static final Duration FIVE_HOUR_PACKAGE_CYCLE = Duration.ofHours(5);

    /**
     * 7 天套餐额度周期。
     */
    private static final Duration WEEKLY_PACKAGE_CYCLE = Duration.ofDays(7);

    private final AiPackageMapper packageMapper;
    private final AiPackageUpstreamMapper upstreamMapper;
    private final AiUserPackageBindingMapper bindingMapper;
    private final AiUsageRecordMapper usageRecordMapper;
    private final SysUserMapper userMapper;
    private final Clock aiBusinessClock;

    @Override
    public AiPageResult<AiPackage> listPackages(AiPackageQuery query) {
        Page<AiPackage> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiPackage> wrapper = new LambdaQueryWrapper<AiPackage>()
            .like(StringUtils.isNotBlank(query.getPackageName()), AiPackage::getPackageName, query.getPackageName())
            .eq(StringUtils.isNotBlank(query.getPackageCode()), AiPackage::getPackageCode, normalizeCode(query.getPackageCode()))
            .eq(StringUtils.isNotBlank(query.getStatus()), AiPackage::getStatus, query.getStatus())
            .orderByAsc(AiPackage::getId);
        Page<AiPackage> result = packageMapper.selectPage(page, wrapper);
        AiPageResult<AiPackage> pageResult = new AiPageResult<>();
        pageResult.setRows(result.getRecords());
        pageResult.setTotal(result.getTotal());
        return pageResult;
    }

    @Override
    public AiPackage getPackage(Long id) {
        AiPackage aiPackage = packageMapper.selectById(id);
        if (aiPackage == null) {
            throw new ServiceException("套餐不存在");
        }
        return aiPackage;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void savePackage(AiPackageForm form) {
        String packageCode = normalizeCode(form.getPackageCode());
        validatePackageCode(packageCode);
        validateTokenLimit(form.getFiveHourTokenLimit(), "5 小时限额");
        validateTokenLimit(form.getWeeklyTokenLimit(), "7 天限额");
        ensurePackageCodeUnique(packageCode, form.getId());

        LocalDateTime now = now();
        AiPackage entity = form.getId() == null ? new AiPackage() : getPackage(form.getId());
        entity.setPackageCode(packageCode);
        entity.setPackageName(form.getPackageName());
        entity.setFiveHourTokenLimit(form.getFiveHourTokenLimit());
        entity.setWeeklyTokenLimit(form.getWeeklyTokenLimit());
        entity.setRemark(form.getRemark());
        entity.setUpdateTime(now);
        if (entity.getId() == null) {
            entity.setStatus(STATUS_ENABLED);
            entity.setCreateTime(now);
            packageMapper.insert(entity);
        } else {
            packageMapper.updateById(entity);
        }
    }

    @Override
    public void changePackageStatus(Long id, String status) {
        AiPackage entity = getPackage(id);
        entity.setStatus(status);
        entity.setUpdateTime(now());
        packageMapper.updateById(entity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deletePackage(Long id) {
        long bindingCount = bindingMapper.selectCount(new LambdaQueryWrapper<AiUserPackageBinding>()
            .eq(AiUserPackageBinding::getPackageId, id));
        if (bindingCount > 0) {
            throw new ServiceException("当前套餐已存在绑定记录，不能删除");
        }
        upstreamMapper.delete(new LambdaQueryWrapper<AiPackageUpstream>().eq(AiPackageUpstream::getPackageId, id));
        packageMapper.deleteById(id);
    }

    @Override
    public List<AiPackageOptionVo> listEnabledPackageOptions() {
        return packageMapper.selectList(new LambdaQueryWrapper<AiPackage>()
                .eq(AiPackage::getStatus, STATUS_ENABLED)
                .orderByAsc(AiPackage::getId))
            .stream()
            .map(item -> {
                AiPackageOptionVo option = new AiPackageOptionVo();
                option.setId(item.getId());
                option.setPackageCode(item.getPackageCode());
                option.setPackageName(item.getPackageName());
                return option;
            })
            .toList();
    }

    @Override
    public AiPageResult<AiPackageUpstream> listUpstreams(AiPackageUpstreamQuery query) {
        Page<AiPackageUpstream> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiPackageUpstream> wrapper = new LambdaQueryWrapper<AiPackageUpstream>()
            .eq(query.getPackageId() != null, AiPackageUpstream::getPackageId, query.getPackageId())
            .like(StringUtils.isNotBlank(query.getUpstreamName()), AiPackageUpstream::getUpstreamName, query.getUpstreamName())
            .eq(StringUtils.isNotBlank(query.getStatus()), AiPackageUpstream::getStatus, query.getStatus())
            .orderByAsc(AiPackageUpstream::getPriority)
            .orderByAsc(AiPackageUpstream::getId);
        Page<AiPackageUpstream> result = upstreamMapper.selectPage(page, wrapper);
        AiPageResult<AiPackageUpstream> pageResult = new AiPageResult<>();
        pageResult.setRows(result.getRecords());
        pageResult.setTotal(result.getTotal());
        return pageResult;
    }

    @Override
    public AiPackageUpstream getUpstream(Long id) {
        AiPackageUpstream upstream = upstreamMapper.selectById(id);
        if (upstream == null) {
            throw new ServiceException("上游节点不存在");
        }
        return upstream;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void saveUpstream(AiPackageUpstreamForm form) {
        getPackage(form.getPackageId());
        if (form.getWeight() == null || form.getWeight() <= 0) {
            throw new ServiceException("权重必须大于 0");
        }
        if (form.getPriority() == null || form.getPriority() < 0) {
            throw new ServiceException("优先级不能小于 0");
        }
        LocalDateTime now = now();
        AiPackageUpstream entity = form.getId() == null ? new AiPackageUpstream() : getUpstream(form.getId());
        entity.setPackageId(form.getPackageId());
        entity.setUpstreamName(form.getUpstreamName());
        entity.setBaseUrl(form.getBaseUrl());
        entity.setApiKey(form.getApiKey());
        entity.setModel(form.getModel());
        entity.setExtraParamsJson(form.getExtraParamsJson());
        entity.setWeight(form.getWeight());
        entity.setPriority(form.getPriority());
        entity.setRemark(form.getRemark());
        entity.setUpdateTime(now);
        if (entity.getId() == null) {
            entity.setStatus(STATUS_ENABLED);
            entity.setCreateTime(now);
            upstreamMapper.insert(entity);
        } else {
            upstreamMapper.updateById(entity);
        }
    }

    @Override
    public void changeUpstreamStatus(Long id, String status) {
        AiPackageUpstream upstream = getUpstream(id);
        upstream.setStatus(status);
        upstream.setUpdateTime(now());
        upstreamMapper.updateById(upstream);
    }

    @Override
    public void deleteUpstream(Long id) {
        upstreamMapper.deleteById(id);
    }

    @Override
    public AiUserPackageBindingVo getCurrentBinding(Long userId) {
        AiUserPackageBinding entity = getCurrentBindingEntity(userId, now());
        if (entity == null) {
            return null;
        }
        AiPackage aiPackage = packageMapper.selectById(entity.getPackageId());
        if (!isPackageUsable(aiPackage)) {
            return null;
        }
        AiUserPackageBindingVo vo = new AiUserPackageBindingVo();
        vo.setId(entity.getId());
        vo.setUserId(entity.getUserId());
        vo.setPackageId(entity.getPackageId());
        vo.setPackageCode(aiPackage == null ? null : aiPackage.getPackageCode());
        vo.setPackageName(aiPackage == null ? null : aiPackage.getPackageName());
        vo.setStatus(entity.getStatus());
        vo.setEffectiveFrom(formatDateTime(entity.getEffectiveFrom()));
        vo.setEffectiveTo(formatDateTime(entity.getEffectiveTo()));
        vo.setRemark(entity.getRemark());
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void bindUserPackage(AiUserPackageBindingForm form) {
        AiPackage aiPackage = getPackage(form.getPackageId());
        if (!STATUS_ENABLED.equals(aiPackage.getStatus())) {
            throw new ServiceException("目标套餐已停用，不能绑定");
        }
        LocalDateTime now = now();
        LocalDateTime effectiveFrom = parseDateTimeRequired(form.getEffectiveFrom(), "开始时间不能为空");
        LocalDateTime effectiveTo = parseDateTimeRequired(form.getEffectiveTo(), "结束时间不能为空");
        if (!effectiveTo.isAfter(effectiveFrom)) {
            throw new ServiceException("结束时间必须晚于开始时间");
        }
        bindingMapper.update(null, new LambdaUpdateWrapper<AiUserPackageBinding>()
            .eq(AiUserPackageBinding::getUserId, form.getUserId())
            .eq(AiUserPackageBinding::getStatus, STATUS_ENABLED)
            .set(AiUserPackageBinding::getStatus, STATUS_DISABLED)
            .set(AiUserPackageBinding::getEffectiveTo, now)
            .set(AiUserPackageBinding::getUpdateTime, now));

        AiUserPackageBinding entity = new AiUserPackageBinding();
        entity.setUserId(form.getUserId());
        entity.setPackageId(form.getPackageId());
        entity.setStatus(STATUS_ENABLED);
        entity.setEffectiveFrom(effectiveFrom);
        entity.setEffectiveTo(effectiveTo);
        entity.setRemark(form.getRemark());
        entity.setCreateTime(now);
        entity.setUpdateTime(now);
        bindingMapper.insert(entity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void unbindUserPackage(Long userId) {
        LocalDateTime now = now();
        bindingMapper.update(null, new LambdaUpdateWrapper<AiUserPackageBinding>()
            .eq(AiUserPackageBinding::getUserId, userId)
            .eq(AiUserPackageBinding::getStatus, STATUS_ENABLED)
            .set(AiUserPackageBinding::getStatus, STATUS_DISABLED)
            .set(AiUserPackageBinding::getEffectiveTo, now)
            .set(AiUserPackageBinding::getUpdateTime, now));
    }

    @Override
    public AiPageResult<AiUsageRecordVo> listUsageRecords(AiUsageQuery query) {
        List<Long> userIds = resolveUsageQueryUserIds(query);
        if (userIds != null && userIds.isEmpty()) {
            return emptyPageResult();
        }
        Page<AiUsageRecord> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiUsageRecord> wrapper = buildUsageRecordQueryWrapper(query, userIds)
            .orderByDesc(AiUsageRecord::getOccurredAt)
            .orderByDesc(AiUsageRecord::getId);
        Page<AiUsageRecord> result = usageRecordMapper.selectPage(page, wrapper);

        List<AiUsageRecord> records = result.getRecords();
        Map<Long, AiPackage> packageMap = selectEntityMapByIds(records.stream()
            .map(AiUsageRecord::getPackageId)
            .filter(Objects::nonNull)
            .distinct()
            .toList(), packageMapper::selectBatchIds, AiPackage::getId);
        Map<Long, AiPackageUpstream> upstreamMap = selectEntityMapByIds(records.stream()
            .map(AiUsageRecord::getUpstreamId)
            .filter(Objects::nonNull)
            .distinct()
            .toList(), this::selectUsageUpstreamsByIds, AiPackageUpstream::getId);
        Map<Long, SysUser> userMap = selectEntityMapByIds(records.stream()
            .map(AiUsageRecord::getUserId)
            .filter(Objects::nonNull)
            .distinct()
            .toList(), userMapper::selectBatchIds, SysUser::getUserId);

        List<AiUsageRecordVo> rows = records.stream()
            .map(record -> {
                AiUsageRecordVo vo = new AiUsageRecordVo();
                vo.setId(record.getId());
                vo.setRequestId(record.getRequestId());
                vo.setUserId(record.getUserId());
                SysUser user = userMap.get(record.getUserId());
                vo.setUserName(user == null ? null : user.getUserName());
                vo.setPackageId(record.getPackageId());
                AiPackage aiPackage = packageMap.get(record.getPackageId());
                vo.setPackageName(aiPackage == null ? null : aiPackage.getPackageName());
                vo.setUpstreamId(record.getUpstreamId());
                AiPackageUpstream upstream = upstreamMap.get(record.getUpstreamId());
                vo.setUpstreamName(upstream == null ? null : upstream.getUpstreamName());
                vo.setStreaming(record.getStreaming());
                vo.setInputTokens(record.getInputTokens());
                vo.setOutputTokens(record.getOutputTokens());
                vo.setTotalTokens(record.getTotalTokens());
                vo.setUsageSource(record.getUsageSource());
                vo.setRequestStatus(record.getRequestStatus());
                vo.setRejectReason(record.getRejectReason());
                vo.setOccurredAt(formatDateTime(record.getOccurredAt()));
                return vo;
            })
            .toList();

        AiPageResult<AiUsageRecordVo> pageResult = new AiPageResult<>();
        pageResult.setRows(rows);
        pageResult.setTotal(result.getTotal());
        return pageResult;
    }

    @Override
    public AiUsageTotalVo getUsageTotals(AiUsageQuery query) {
        List<Long> userIds = resolveUsageQueryUserIds(query);
        if (userIds != null && userIds.isEmpty()) {
            return emptyUsageTotal();
        }
        QueryWrapper<AiUsageRecord> wrapper = buildUsageTotalQueryWrapper(query, userIds);
        wrapper.select("COUNT(*) AS requestCount",
            "COALESCE(SUM(CASE WHEN request_status = 'success' THEN 1 ELSE 0 END), 0) AS successCount",
            "COALESCE(SUM(input_tokens), 0) AS inputTokens",
            "COALESCE(SUM(output_tokens), 0) AS outputTokens",
            "COALESCE(SUM(total_tokens), 0) AS totalTokens");
        List<Map<String, Object>> rows = usageRecordMapper.selectMaps(wrapper);
        if (rows == null || rows.isEmpty()) {
            return emptyUsageTotal();
        }
        Map<String, Object> row = rows.get(0);
        AiUsageTotalVo totalVo = new AiUsageTotalVo();
        totalVo.setRequestCount(toLong(row.get("requestCount")));
        totalVo.setSuccessCount(toLong(row.get("successCount")));
        totalVo.setInputTokens(toLong(row.get("inputTokens")));
        totalVo.setOutputTokens(toLong(row.get("outputTokens")));
        totalVo.setTotalTokens(toLong(row.get("totalTokens")));
        return totalVo;
    }

    @Override
    public AiUsageSummaryVo getUsageSummary(AiUsageQuery query) {
        Long userId = resolveSingleUsageSummaryUserId(query);
        if (userId == null) {
            return null;
        }
        return getUsageSummary(userId);
    }

    @Override
    public AiUsageSummaryVo getUsageSummary(Long userId) {
        LocalDateTime now = now();
        AiUserPackageBinding binding = getCurrentBindingEntity(userId, now);
        if (binding == null) {
            return null;
        }
        AiPackage aiPackage = packageMapper.selectById(binding.getPackageId());
        if (!isPackageUsable(aiPackage)) {
            return null;
        }
        SysUser user = userMapper.selectById(userId);
        AiUsageSnapshot snapshot = getUsageSnapshot(userId, now, binding);
        AiUsageSummaryVo summaryVo = new AiUsageSummaryVo();
        summaryVo.setUserId(userId);
        summaryVo.setUserName(user == null ? null : user.getUserName());
        summaryVo.setPackageId(aiPackage.getId());
        summaryVo.setPackageCode(aiPackage.getPackageCode());
        summaryVo.setPackageName(aiPackage.getPackageName());
        summaryVo.setPackageEffectiveFrom(formatDateTime(binding.getEffectiveFrom()));
        summaryVo.setPackageEffectiveTo(formatDateTime(binding.getEffectiveTo()));
        summaryVo.setFiveHourUsedTokens(snapshot.getFiveHourUsedTokens());
        summaryVo.setFiveHourTokenLimit(aiPackage.getFiveHourTokenLimit());
        summaryVo.setWeeklyUsedTokens(snapshot.getWeeklyUsedTokens());
        summaryVo.setWeeklyTokenLimit(aiPackage.getWeeklyTokenLimit());
        summaryVo.setFiveHourQuotaPercent(calculateQuotaPercent(snapshot.getFiveHourUsedTokens(), aiPackage.getFiveHourTokenLimit()));
        summaryVo.setWeeklyQuotaPercent(calculateQuotaPercent(snapshot.getWeeklyUsedTokens(), aiPackage.getWeeklyTokenLimit()));
        LocalDateTime bindingLimitAt = binding.getEffectiveTo();
        LocalDateTime fiveHourCycleStartAt = calculateFiveHourCycleStartAt(userId, binding, now);
        LocalDateTime weeklyCycleStartAt = calculateFixedCycleStartAt(binding.getEffectiveFrom(), now, WEEKLY_PACKAGE_CYCLE);
        LocalDateTime fiveHourNextRefreshAt = capAtBindingEnd(
            calculateFixedCycleNextRefreshAt(fiveHourCycleStartAt, FIVE_HOUR_PACKAGE_CYCLE),
            bindingLimitAt
        );
        LocalDateTime weeklyNextRefreshAt = capAtBindingEnd(
            calculateFixedCycleNextRefreshAt(weeklyCycleStartAt, WEEKLY_PACKAGE_CYCLE),
            bindingLimitAt
        );
        LocalDateTime fiveHourAvailableAt = capAtBindingEnd(
            calculateFixedCycleQuotaAvailableAt(snapshot.getFiveHourUsedTokens(), aiPackage.getFiveHourTokenLimit(), fiveHourNextRefreshAt),
            bindingLimitAt
        );
        LocalDateTime weeklyAvailableAt = capAtBindingEnd(
            calculateFixedCycleQuotaAvailableAt(snapshot.getWeeklyUsedTokens(), aiPackage.getWeeklyTokenLimit(), weeklyNextRefreshAt),
            bindingLimitAt
        );
        LocalDateTime quotaAvailableAt = maxDateTime(fiveHourAvailableAt, weeklyAvailableAt);
        summaryVo.setFiveHourQuotaAvailableAt(formatDateTime(fiveHourAvailableAt));
        summaryVo.setFiveHourNextRefreshAt(formatDateTime(fiveHourNextRefreshAt));
        summaryVo.setWeeklyQuotaAvailableAt(formatDateTime(weeklyAvailableAt));
        summaryVo.setWeeklyNextRefreshAt(formatDateTime(weeklyNextRefreshAt));
        summaryVo.setQuotaAvailableAt(formatDateTime(quotaAvailableAt));
        return summaryVo;
    }

    @Override
    public AiUsageSummaryVo getCurrentUserPackageSummary(Long userId) {
        return getUsageSummary(userId);
    }

    @Override
    public AiUserPackageBinding getCurrentBindingEntity(Long userId, LocalDateTime now) {
        return bindingMapper.selectCurrentBinding(userId, now);
    }

    @Override
    public AiUsageSnapshot getUsageSnapshot(Long userId, LocalDateTime now) {
        AiUserPackageBinding binding = getCurrentBindingEntity(userId, now);
        return getUsageSnapshot(userId, now, binding);
    }

    private AiUsageSnapshot getUsageSnapshot(Long userId, LocalDateTime now, AiUserPackageBinding binding) {
        AiUsageSnapshot snapshot = new AiUsageSnapshot();
        LocalDateTime fiveHourCycleStartAt = calculateFiveHourCycleStartAt(userId, binding, now);
        LocalDateTime weeklyCycleStartAt = calculateFixedCycleStartAt(binding == null ? null : binding.getEffectiveFrom(), now, WEEKLY_PACKAGE_CYCLE);
        snapshot.setFiveHourUsedTokens(fiveHourCycleStartAt == null ? 0L : defaultZero(usageRecordMapper.sumSuccessTokensBetween(userId, fiveHourCycleStartAt, now)));
        snapshot.setWeeklyUsedTokens(weeklyCycleStartAt == null ? 0L : defaultZero(usageRecordMapper.sumSuccessTokensBetween(userId, weeklyCycleStartAt, now)));
        return snapshot;
    }

    private List<Long> resolveUsageQueryUserIds(AiUsageQuery query) {
        if (StringUtils.isBlank(query.getUserName())) {
            return null;
        }
        List<Long> matchedUserIds = userMapper.selectList(new LambdaQueryWrapper<SysUser>()
                .like(SysUser::getUserName, query.getUserName().trim()))
            .stream()
            .map(SysUser::getUserId)
            .toList();
        if (query.getUserId() == null) {
            return matchedUserIds;
        }
        return matchedUserIds.contains(query.getUserId()) ? null : Collections.emptyList();
    }

    private Long resolveSingleUsageSummaryUserId(AiUsageQuery query) {
        if (query.getUserId() != null) {
            return query.getUserId();
        }
        if (StringUtils.isBlank(query.getUserName())) {
            return null;
        }
        return userMapper.selectList(new LambdaQueryWrapper<SysUser>()
                .like(SysUser::getUserName, query.getUserName().trim())
                .orderByAsc(SysUser::getUserId))
            .stream()
            .map(SysUser::getUserId)
            .findFirst()
            .orElse(null);
    }

    private AiPageResult<AiUsageRecordVo> emptyPageResult() {
        AiPageResult<AiUsageRecordVo> pageResult = new AiPageResult<>();
        pageResult.setRows(Collections.emptyList());
        pageResult.setTotal(0L);
        return pageResult;
    }

    private AiUsageTotalVo emptyUsageTotal() {
        AiUsageTotalVo totalVo = new AiUsageTotalVo();
        totalVo.setRequestCount(0L);
        totalVo.setSuccessCount(0L);
        totalVo.setInputTokens(0L);
        totalVo.setOutputTokens(0L);
        totalVo.setTotalTokens(0L);
        return totalVo;
    }

    private void validatePackageCode(String packageCode) {
        if (!ALLOWED_PACKAGE_CODES.contains(packageCode)) {
            throw new ServiceException("套餐编码只允许 plus、pro、max");
        }
    }

    private boolean isPackageUsable(AiPackage aiPackage) {
        return aiPackage != null && STATUS_ENABLED.equals(aiPackage.getStatus());
    }

    private void validateTokenLimit(Long value, String fieldName) {
        if (value == null || value < 0) {
            throw new ServiceException(fieldName + "不能小于 0");
        }
    }

    private void ensurePackageCodeUnique(String packageCode, Long currentId) {
        long count = packageMapper.selectCount(new LambdaQueryWrapper<AiPackage>()
            .eq(AiPackage::getPackageCode, packageCode)
            .ne(currentId != null, AiPackage::getId, currentId));
        if (count > 0) {
            throw new ServiceException("套餐编码已存在");
        }
    }

    private String normalizeCode(String packageCode) {
        return packageCode == null ? null : packageCode.trim().toLowerCase(Locale.ROOT);
    }

    private Long defaultZero(Long value) {
        return value == null ? 0L : value;
    }

    private Long toLong(Object value) {
        if (value == null) {
            return 0L;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.parseLong(String.valueOf(value));
    }

    /**
     * 计算额度使用百分比；限额为空、非正数时统一返回 0，避免前端再处理异常除零。
     *
     * @param usedTokens 已用 token
     * @param tokenLimit token 限额
     * @return 百分比
     */
    private Double calculateQuotaPercent(Long usedTokens, Long tokenLimit) {
        if (usedTokens == null || tokenLimit == null || tokenLimit <= 0) {
            return 0D;
        }
        return BigDecimal.valueOf(usedTokens)
            .multiply(BigDecimal.valueOf(100))
            .divide(BigDecimal.valueOf(tokenLimit), 2, RoundingMode.HALF_UP)
            .doubleValue();
    }

    /**
     * 固定周期额度只在当前周期结束时恢复。
     */
    private LocalDateTime calculateFixedCycleQuotaAvailableAt(Long usedTokens, Long tokenLimit, LocalDateTime nextRefreshAt) {
        if (!isQuotaExceeded(usedTokens, tokenLimit)) {
            return null;
        }
        return nextRefreshAt;
    }

    private boolean isQuotaExceeded(Long usedTokens, Long tokenLimit) {
        return usedTokens != null && tokenLimit != null && tokenLimit > 0 && usedTokens >= tokenLimit;
    }

    private LocalDateTime maxDateTime(LocalDateTime... values) {
        return Arrays.stream(values)
            .filter(Objects::nonNull)
            .max(LocalDateTime::compareTo)
            .orElse(null);
    }

    private LocalDateTime capAtBindingEnd(LocalDateTime candidate, LocalDateTime bindingEnd) {
        if (candidate == null) {
            return null;
        }
        if (bindingEnd == null || !bindingEnd.isBefore(candidate)) {
            return candidate;
        }
        return bindingEnd;
    }

    /**
     * 按 ID 集合批量查询实体并转换为键值映射；空集合时直接返回空映射，避免拼接非法 IN () SQL。
     *
     * @param ids ID 集合
     * @param batchLoader 批量查询函数
     * @param idExtractor 实体 ID 提取函数
     * @param <T> 实体类型
     * @return 以实体 ID 为键的映射
     */
    private <T> Map<Long, T> selectEntityMapByIds(List<Long> ids,
                                                  Function<List<Long>, List<T>> batchLoader,
                                                  Function<T, Long> idExtractor) {
        if (ids == null || ids.isEmpty()) {
            return Collections.emptyMap();
        }
        return batchLoader.apply(ids).stream()
            .collect(Collectors.toMap(idExtractor, Function.identity()));
    }

    /**
     * 用量列表只需要回填上游名称，避免旧库缺少上游扩展字段时全字段查询失败。
     */
    private List<AiPackageUpstream> selectUsageUpstreamsByIds(List<Long> ids) {
        return upstreamMapper.selectList(new LambdaQueryWrapper<AiPackageUpstream>()
            .select(AiPackageUpstream::getId, AiPackageUpstream::getUpstreamName)
            .in(AiPackageUpstream::getId, ids));
    }

    private LambdaQueryWrapper<AiUsageRecord> buildUsageRecordQueryWrapper(AiUsageQuery query, List<Long> userIds) {
        return new LambdaQueryWrapper<AiUsageRecord>()
            .eq(query.getUserId() != null, AiUsageRecord::getUserId, query.getUserId())
            .in(query.getUserId() == null && userIds != null, AiUsageRecord::getUserId, userIds)
            .eq(query.getPackageId() != null, AiUsageRecord::getPackageId, query.getPackageId())
            .eq(StringUtils.isNotBlank(query.getRequestStatus()), AiUsageRecord::getRequestStatus, query.getRequestStatus())
            .ge(StringUtils.isNotBlank(query.getOccurredFrom()), AiUsageRecord::getOccurredAt, parseDateTimeOrNull(query.getOccurredFrom()))
            .le(StringUtils.isNotBlank(query.getOccurredTo()), AiUsageRecord::getOccurredAt, parseDateTimeOrNull(query.getOccurredTo()));
    }

    private QueryWrapper<AiUsageRecord> buildUsageTotalQueryWrapper(AiUsageQuery query, List<Long> userIds) {
        return new QueryWrapper<AiUsageRecord>()
            .eq(query.getUserId() != null, "user_id", query.getUserId())
            .in(query.getUserId() == null && userIds != null, "user_id", userIds)
            .eq(query.getPackageId() != null, "package_id", query.getPackageId())
            .eq(StringUtils.isNotBlank(query.getRequestStatus()), "request_status", query.getRequestStatus())
            .ge(StringUtils.isNotBlank(query.getOccurredFrom()), "occurred_at", parseDateTimeOrNull(query.getOccurredFrom()))
            .le(StringUtils.isNotBlank(query.getOccurredTo()), "occurred_at", parseDateTimeOrNull(query.getOccurredTo()));
    }

    private LocalDateTime parseDateTimeOrNull(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        return LocalDateTime.parse(value);
    }

    private LocalDateTime parseDateTimeRequired(String value, String message) {
        if (StringUtils.isBlank(value)) {
            throw new ServiceException(message);
        }
        return LocalDateTime.parse(value);
    }

    private String formatDateTime(LocalDateTime value) {
        if (value == null) {
            return null;
        }
        return value.format(DATE_TIME_FORMATTER);
    }

    private LocalDateTime now() {
        return LocalDateTime.now(aiBusinessClock);
    }

    private LocalDateTime calculateFiveHourCycleStartAt(Long userId, AiUserPackageBinding binding, LocalDateTime now) {
        if (binding == null || binding.getEffectiveFrom() == null || binding.getEffectiveFrom().isAfter(now)) {
            return null;
        }
        AiUsageRecord firstSuccessRecord = usageRecordMapper.selectFirstSuccessRecordBetween(userId, binding.getEffectiveFrom(), now);
        if (firstSuccessRecord == null || firstSuccessRecord.getOccurredAt() == null) {
            return null;
        }
        return calculateFixedCycleStartAt(firstSuccessRecord.getOccurredAt(), now, FIVE_HOUR_PACKAGE_CYCLE);
    }

    private LocalDateTime calculateFixedCycleStartAt(LocalDateTime anchorAt, LocalDateTime now, Duration cycle) {
        if (anchorAt == null || anchorAt.isAfter(now)) {
            return null;
        }
        long cycleMillis = cycle.toMillis();
        long elapsedMillis = Duration.between(anchorAt, now).toMillis();
        long cycleIndex = Math.max(0L, elapsedMillis / cycleMillis);
        LocalDateTime cycleStart = anchorAt.plus(cycle.multipliedBy(cycleIndex));
        while (!cycleStart.plus(cycle).isAfter(now)) {
            cycleStart = cycleStart.plus(cycle);
        }
        return cycleStart;
    }

    private LocalDateTime calculateFixedCycleNextRefreshAt(LocalDateTime cycleStartAt, Duration cycle) {
        return cycleStartAt == null ? null : cycleStartAt.plus(cycle);
    }
}
