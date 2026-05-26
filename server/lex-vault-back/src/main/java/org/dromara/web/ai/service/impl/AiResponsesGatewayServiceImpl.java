package org.dromara.web.ai.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.github.kongweiguang.v1.json.Json;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import okhttp3.*;
import org.dromara.common.core.domain.model.LoginUser;
import org.dromara.common.core.exception.ServiceException;
import org.dromara.common.core.utils.StreamUtils;
import org.dromara.common.core.utils.StringUtils;
import org.dromara.common.satoken.utils.LoginHelper;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageStat;
import org.dromara.web.ai.domain.vo.OpenAiErrorBody;
import org.dromara.web.ai.domain.vo.QuotaCheckResult;
import org.dromara.web.ai.mapper.AiPackageMapper;
import org.dromara.web.ai.mapper.AiPackageUpstreamMapper;
import org.dromara.web.ai.mapper.AiUsageRecordMapper;
import org.dromara.web.ai.service.IAiAdminService;
import org.dromara.web.ai.service.IAiResponsesGatewayService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;

/**
 * OpenAI Responses 网关服务实现。
 *
 * @author kongweiguang
 */
@Service
@RequiredArgsConstructor
public class AiResponsesGatewayServiceImpl implements IAiResponsesGatewayService {

    /**
     * 临时固定的 Chat Completions 上游地址。
     */
    private static final String CHAT_COMPLETIONS_BASE_URL = "https://api.minimaxi.com/v1/chat/completions";

    /**
     * 临时固定的 Chat Completions 默认模型。
     */
    private static final String CHAT_COMPLETIONS_DEFAULT_MODEL = "MiniMax-M2.7";

    /**
     * 临时固定的 Chat Completions 上游 key。
     */
    private static final String CHAT_COMPLETIONS_API_KEY = "sk-cp-ot6hMt65zIx8rHYFzcmGxEYERsMXJ3Nj6OOqH2r3Plp9KsuTwu8zY30cL024Oud8Ge5iAQfEX8dngBxdbmiasy8DWPNl6axRjGqr1unJPwkq6pibDYBAXAc";

    /**
     * 临时固定的 Anthropic Messages 上游地址。
     */
    private static final String ANTHROPIC_MESSAGES_BASE_URL = "https://api.minimaxi.com/anthropic/v1/messages";

    /**
     * 临时固定的 Anthropic Messages 默认模型。
     */
    private static final String ANTHROPIC_MESSAGES_DEFAULT_MODEL = "MiniMax-M2.7";

    /**
     * 临时固定的 Anthropic Messages 上游 key。
     */
    private static final String ANTHROPIC_MESSAGES_API_KEY = "sk-cp-ot6hMt65zIx8rHYFzcmGxEYERsMXJ3Nj6OOqH2r3Plp9KsuTwu8zY30cL024Oud8Ge5iAQfEX8dngBxdbmiasy8DWPNl6axRjGqr1unJPwkq6pibDYBAXAc";

    /**
     * Anthropic 兼容协议版本。
     */
    private static final String ANTHROPIC_VERSION = "2023-06-01";

    /**
     * HTTP 429 状态码。
     */
    private static final int HTTP_TOO_MANY_REQUESTS = 429;

    /**
     * OpenAI 兼容限流类型。
     */
    private static final String OPENAI_RATE_LIMIT_TYPE = "rate_limit_exceeded";

    /**
     * 响应头白名单。
     */
    private static final List<String> RESPONSE_HEADERS = List.of(
        HttpHeaders.CONTENT_TYPE,
        HttpHeaders.CACHE_CONTROL,
        HttpHeaders.PRAGMA,
        HttpHeaders.EXPIRES
    );

    /**
     * 启用状态。
     */
    private static final String STATUS_ENABLED = "0";

    /**
     * HTTP 客户端。
     */
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.MINUTES)
        .writeTimeout(5, TimeUnit.MINUTES)
        .readTimeout(5, TimeUnit.MINUTES)
        .callTimeout(5, TimeUnit.MINUTES)
        .build();

    /**
     * JSON 请求体类型。
     */
    private static final okhttp3.MediaType JSON_MEDIA_TYPE = okhttp3.MediaType.get(MediaType.APPLICATION_JSON_VALUE);

    /**
     * 用户级本地锁，第一版用来保证额度检查与记账的原子性。
     */
    private static final Map<Long, ReentrantLock> USER_LOCKS = new ConcurrentHashMap<>();

    private final IAiAdminService aiAdminService;
    private final AiPackageMapper packageMapper;
    private final AiPackageUpstreamMapper upstreamMapper;
    private final AiUsageRecordMapper usageRecordMapper;

    @Override
    public void responses(String body, HttpServletRequest request, HttpServletResponse response) {
        LoginUser loginUser = LoginHelper.getLoginUser();
        if (loginUser == null || loginUser.getUserId() == null) {
            throw new ServiceException("未获取到当前登录用户");
        }
        Long userId = loginUser.getUserId();
//        ReentrantLock lock = USER_LOCKS.computeIfAbsent(userId, ignored -> new ReentrantLock());
//        lock.lock();
//        try {
            doResponses(body, request, response, userId);
//        } finally {
//            lock.unlock();
//        }
    }

    @Override
    public void chatCompletions(String body, HttpServletRequest request, HttpServletResponse response) {
        LoginUser loginUser = LoginHelper.getLoginUser();
        if (loginUser == null || loginUser.getUserId() == null) {
            throw new ServiceException("未获取到当前登录用户");
        }
        try {
            proxyFixedChatCompletions(body, request, response);
        } catch (IOException e) {
            throw new ServiceException("OpenAI Chat Completions 上游网络请求失败：{}", e.getMessage());
        }
    }

    @Override
    public void anthropicMessages(String body, HttpServletRequest request, HttpServletResponse response) {
        LoginUser loginUser = LoginHelper.getLoginUser();
        if (loginUser == null || loginUser.getUserId() == null) {
            throw new ServiceException("未获取到当前登录用户");
        }
        try {
            proxyFixedAnthropicMessages(body, request, response);
        } catch (IOException e) {
            throw new ServiceException("Anthropic Messages 上游网络请求失败：{}", e.getMessage());
        }
    }

    private void doResponses(String body, HttpServletRequest request, HttpServletResponse response, Long userId) {
        String requestId = UUID.randomUUID().toString();
        LocalDateTime nowUtc = LocalDateTime.now(ZoneOffset.UTC);
        AiUserPackageBinding binding = aiAdminService.getCurrentBindingEntity(userId, nowUtc);
        if (binding == null) {
            saveRejectedRecord(requestId, userId, null, null, isStreamRequest(body), "no_active_package_binding", "当前用户未绑定可用 AI 套餐");
            writeOpenAiRateLimit(response, "no_active_package_binding", "当前用户未绑定可用 AI 套餐");
            return;
        }
        AiPackage aiPackage = packageMapper.selectById(binding.getPackageId());
        if (aiPackage == null || !STATUS_ENABLED.equals(aiPackage.getStatus())) {
            saveRejectedRecord(requestId, userId, binding.getPackageId(), null, isStreamRequest(body), "package_unavailable", "当前绑定套餐不存在或已停用");
            writeOpenAiRateLimit(response, "package_unavailable", "当前绑定套餐不存在或已停用");
            return;
        }

        AiUsageSnapshot snapshot = aiAdminService.getUsageSnapshot(userId, nowUtc);
        QuotaCheckResult quotaCheckResult = AiGatewaySupport.checkQuota(aiPackage, snapshot);
        if (!quotaCheckResult.isAllowed()) {
            saveRejectedRecord(requestId, userId, aiPackage.getId(), null, isStreamRequest(body), quotaCheckResult.getErrorCode(), quotaCheckResult.getMessage());
            writeOpenAiRateLimit(response, quotaCheckResult.getErrorCode(), quotaCheckResult.getMessage());
            return;
        }

        List<AiPackageUpstream> upstreams = upstreamMapper.selectList(new LambdaQueryWrapper<AiPackageUpstream>()
            .eq(AiPackageUpstream::getPackageId, aiPackage.getId())
            .eq(AiPackageUpstream::getStatus, STATUS_ENABLED));
        List<AiPackageUpstream> orderedUpstreams = AiGatewaySupport.orderUpstreamsForAttempt(upstreams);
        if (orderedUpstreams.isEmpty()) {
            saveRejectedRecord(requestId, userId, aiPackage.getId(), null, isStreamRequest(body), "no_available_upstream", "当前套餐未配置可用上游节点");
            writeOpenAiRateLimit(response, "no_available_upstream", "当前套餐未配置可用上游节点");
            return;
        }

        IOException lastIoException = null;
        int maxAttempts = Math.min(2, orderedUpstreams.size());
        for (int index = 0; index < maxAttempts; index++) {
            AiPackageUpstream upstream = orderedUpstreams.get(index);
            try {
                proxyToUpstream(body, request, response, requestId, userId, aiPackage, upstream);
                return;
            } catch (IOException e) {
                lastIoException = e;
                if (index == maxAttempts - 1) {
                    saveFailureRecord(requestId, userId, aiPackage.getId(), upstream.getId(), isStreamRequest(body), "upstream_network_failure", e.getMessage());
                    throw new ServiceException("OpenAI Responses 上游网络请求失败：{}", e.getMessage());
                }
            }
        }
        if (lastIoException != null) {
            throw new ServiceException("OpenAI Responses 上游网络请求失败：{}", lastIoException.getMessage());
        }
    }

    private void proxyFixedChatCompletions(String body,
                                           HttpServletRequest request,
                                           HttpServletResponse response) throws IOException {
        String rewrittenBody = AiGatewaySupport.buildFixedChatCompletionsBody(body, CHAT_COMPLETIONS_DEFAULT_MODEL);
        Request upstreamRequest = buildFixedChatCompletionsRequest(rewrittenBody, request);
        try (Response upstreamResponse = HTTP_CLIENT.newCall(upstreamRequest).execute()) {
            response.setStatus(upstreamResponse.code());
            copyResponseHeaders(upstreamResponse, response);
            ResponseBody responseBody = upstreamResponse.body();
            if (responseBody == null) {
                response.flushBuffer();
                return;
            }
            try (InputStream inputStream = responseBody.byteStream();
                 OutputStream outputStream = response.getOutputStream()) {
                inputStream.transferTo(outputStream);
                outputStream.flush();
            }
            response.flushBuffer();
        }
    }

    private void proxyFixedAnthropicMessages(String body,
                                             HttpServletRequest request,
                                             HttpServletResponse response) throws IOException {
        String rewrittenBody = AiGatewaySupport.buildFixedAnthropicMessagesBody(body, ANTHROPIC_MESSAGES_DEFAULT_MODEL);
        Request upstreamRequest = buildFixedAnthropicMessagesRequest(rewrittenBody, request);
        try (Response upstreamResponse = HTTP_CLIENT.newCall(upstreamRequest).execute()) {
            response.setStatus(upstreamResponse.code());
            copyResponseHeaders(upstreamResponse, response);
            ResponseBody responseBody = upstreamResponse.body();
            if (responseBody == null) {
                response.flushBuffer();
                return;
            }
            try (InputStream inputStream = responseBody.byteStream();
                 OutputStream outputStream = response.getOutputStream()) {
                inputStream.transferTo(outputStream);
                outputStream.flush();
            }
            response.flushBuffer();
        }
    }

    private void proxyToUpstream(String body,
                                 HttpServletRequest request,
                                 HttpServletResponse response,
                                 String requestId,
                                 Long userId,
                                 AiPackage aiPackage,
                                 AiPackageUpstream upstream) throws IOException {
        String rewrittenBody = AiGatewaySupport.buildUpstreamBody(body, upstream);
        Request upstreamRequest = buildUpstreamRequest(upstream, rewrittenBody, request);
        try (Response upstreamResponse = HTTP_CLIENT.newCall(upstreamRequest).execute()) {
            response.setStatus(upstreamResponse.code());
            copyResponseHeaders(upstreamResponse, response);
            ResponseBody responseBody = upstreamResponse.body();
            if (responseBody == null) {
                saveIncompleteRecord(requestId, userId, aiPackage.getId(), upstream.getId(), isStreamRequest(body), "empty_response_body");
                response.flushBuffer();
                return;
            }
            String contentType = upstreamResponse.header(HttpHeaders.CONTENT_TYPE, "");
            boolean streaming = contentType.contains(MediaType.TEXT_EVENT_STREAM_VALUE);
            if (streaming) {
                proxySseResponse(responseBody, response, requestId, userId, aiPackage, upstream);
            } else {
                proxyJsonResponse(responseBody, response, requestId, userId, aiPackage, upstream);
            }
        }
    }

    private void proxyJsonResponse(ResponseBody responseBody,
                                   HttpServletResponse response,
                                   String requestId,
                                   Long userId,
                                   AiPackage aiPackage,
                                   AiPackageUpstream upstream) throws IOException {
        String responseText = responseBody.string();
        AiUsageStat usage = AiGatewaySupport.extractUsageFromJsonBody(responseText);
        if (usage != null) {
            saveSuccessRecord(requestId, userId, aiPackage.getId(), upstream.getId(), false, usage);
        } else {
            saveIncompleteRecord(requestId, userId, aiPackage.getId(), upstream.getId(), false, "upstream_usage_missing");
        }
        response.getOutputStream().write(responseText.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }

    private void proxySseResponse(ResponseBody responseBody,
                                  HttpServletResponse response,
                                  String requestId,
                                  Long userId,
                                  AiPackage aiPackage,
                                  AiPackageUpstream upstream) throws IOException {
        AiUsageStat usage = null;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(responseBody.byteStream(), StandardCharsets.UTF_8));
             OutputStream outputStream = response.getOutputStream()) {
            String line;
            while ((line = reader.readLine()) != null) {
                outputStream.write(line.getBytes(StandardCharsets.UTF_8));
                outputStream.write('\n');
                if (line.startsWith("data:")) {
                    String data = line.substring(5).trim();
                    if (StringUtils.isNotBlank(data) && !"[DONE]".equals(data)) {
                        AiUsageStat current = AiGatewaySupport.extractUsageFromSseData(data);
                        if (current != null) {
                            usage = current;
                        }
                    }
                }
                outputStream.flush();
            }
        }
        if (usage != null) {
            saveSuccessRecord(requestId, userId, aiPackage.getId(), upstream.getId(), true, usage);
        } else {
            saveIncompleteRecord(requestId, userId, aiPackage.getId(), upstream.getId(), true, "stream_completed_without_usage");
        }
        response.flushBuffer();
    }

    private Request buildUpstreamRequest(AiPackageUpstream upstream, String body, HttpServletRequest request) {
        Request.Builder builder = new Request.Builder()
            .url(upstream.getBaseUrl())
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);

        String accept = request.getHeader(HttpHeaders.ACCEPT);
        if (StringUtils.isNotBlank(accept)) {
            builder.header(HttpHeaders.ACCEPT, accept);
        }
        String openAiBeta = request.getHeader("OpenAI-Beta");
        if (StringUtils.isNotBlank(openAiBeta)) {
            builder.header("OpenAI-Beta", openAiBeta);
        }
        if (StringUtils.isNotBlank(upstream.getApiKey())) {
            builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + upstream.getApiKey());
        }
        return builder.build();
    }

    private Request buildFixedChatCompletionsRequest(String body, HttpServletRequest request) {
        Request.Builder builder = new Request.Builder()
            .url(CHAT_COMPLETIONS_BASE_URL)
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + CHAT_COMPLETIONS_API_KEY);

        String accept = request.getHeader(HttpHeaders.ACCEPT);
        if (StringUtils.isNotBlank(accept)) {
            builder.header(HttpHeaders.ACCEPT, accept);
        }
        return builder.build();
    }

    private Request buildFixedAnthropicMessagesRequest(String body, HttpServletRequest request) {
        Request.Builder builder = new Request.Builder()
            .url(ANTHROPIC_MESSAGES_BASE_URL)
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .header("x-api-key", ANTHROPIC_MESSAGES_API_KEY)
            .header("anthropic-version", request.getHeader("anthropic-version") != null
                ? request.getHeader("anthropic-version")
                : ANTHROPIC_VERSION);

        String accept = request.getHeader(HttpHeaders.ACCEPT);
        if (StringUtils.isNotBlank(accept)) {
            builder.header(HttpHeaders.ACCEPT, accept);
        }
        String anthropicBeta = request.getHeader("anthropic-beta");
        if (StringUtils.isNotBlank(anthropicBeta)) {
            builder.header("anthropic-beta", anthropicBeta);
        }
        return builder.build();
    }

    private void copyResponseHeaders(Response upstreamResponse, HttpServletResponse response) {
        for (String header : RESPONSE_HEADERS) {
            String value = upstreamResponse.header(header);
            if (StringUtils.isNotBlank(value)) {
                response.setHeader(header, value);
            }
        }
    }

    private boolean isStreamRequest(String body) {
        try {
            return Json.node(body).path("stream").asBoolean(false);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void writeOpenAiRateLimit(HttpServletResponse response, String code, String message) {
        response.setStatus(HTTP_TOO_MANY_REQUESTS);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        OpenAiErrorBody body = new OpenAiErrorBody();
        OpenAiErrorBody.ErrorObject errorObject = new OpenAiErrorBody.ErrorObject();
        errorObject.setCode(code);
        errorObject.setType(OPENAI_RATE_LIMIT_TYPE);
        errorObject.setMessage(message);
        body.setError(errorObject);
        try {
            response.getOutputStream().write(Json.str(body).getBytes(StandardCharsets.UTF_8));
            response.flushBuffer();
        } catch (IOException e) {
            throw new ServiceException("写入 OpenAI 兼容限流响应失败：{}", e.getMessage());
        }
    }

    @Transactional(rollbackFor = Exception.class)
    protected void saveSuccessRecord(String requestId,
                                     Long userId,
                                     Long packageId,
                                     Long upstreamId,
                                     boolean streaming,
                                     AiUsageStat usage) {
        AiUsageRecord record = buildBaseRecord(requestId, userId, packageId, upstreamId, streaming);
        record.setInputTokens(usage.getInputTokens());
        record.setOutputTokens(usage.getOutputTokens());
        record.setTotalTokens(usage.getTotalTokens());
        record.setUsageSource("upstream_usage");
        record.setRequestStatus("success");
        usageRecordMapper.insert(record);
    }

    @Transactional(rollbackFor = Exception.class)
    protected void saveIncompleteRecord(String requestId,
                                        Long userId,
                                        Long packageId,
                                        Long upstreamId,
                                        boolean streaming,
                                        String reason) {
        AiUsageRecord record = buildBaseRecord(requestId, userId, packageId, upstreamId, streaming);
        record.setInputTokens(0L);
        record.setOutputTokens(0L);
        record.setTotalTokens(0L);
        record.setUsageSource("upstream_usage_missing");
        record.setRequestStatus("incomplete");
        record.setRejectReason(reason);
        usageRecordMapper.insert(record);
    }

    @Transactional(rollbackFor = Exception.class)
    protected void saveFailureRecord(String requestId,
                                     Long userId,
                                     Long packageId,
                                     Long upstreamId,
                                     boolean streaming,
                                     String reasonCode,
                                     String reasonMessage) {
        AiUsageRecord record = buildBaseRecord(requestId, userId, packageId, upstreamId, streaming);
        record.setInputTokens(0L);
        record.setOutputTokens(0L);
        record.setTotalTokens(0L);
        record.setUsageSource("upstream_failure");
        record.setRequestStatus("failed");
        record.setRejectReason(reasonCode + ":" + reasonMessage);
        usageRecordMapper.insert(record);
    }

    @Transactional(rollbackFor = Exception.class)
    protected void saveRejectedRecord(String requestId,
                                      Long userId,
                                      Long packageId,
                                      Long upstreamId,
                                      boolean streaming,
                                      String reasonCode,
                                      String reasonMessage) {
        AiUsageRecord record = buildBaseRecord(requestId, userId, packageId, upstreamId, streaming);
        record.setInputTokens(0L);
        record.setOutputTokens(0L);
        record.setTotalTokens(0L);
        record.setUsageSource("gateway_rejected");
        record.setRequestStatus("rejected");
        record.setRejectReason(reasonCode + ":" + reasonMessage);
        usageRecordMapper.insert(record);
    }

    private AiUsageRecord buildBaseRecord(String requestId, Long userId, Long packageId, Long upstreamId, boolean streaming) {
        AiUsageRecord record = new AiUsageRecord();
        record.setRequestId(requestId);
        record.setUserId(userId);
        record.setPackageId(packageId);
        record.setUpstreamId(upstreamId);
        record.setStreaming(streaming);
        record.setOccurredAt(LocalDateTime.now(ZoneOffset.UTC));
        record.setCreateTime(LocalDateTime.now());
        record.setUpdateTime(LocalDateTime.now());
        return record;
    }
}
