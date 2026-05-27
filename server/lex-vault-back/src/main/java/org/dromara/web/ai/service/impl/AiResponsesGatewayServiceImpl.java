package org.dromara.web.ai.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.github.kongweiguang.v1.json.Json;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import okhttp3.*;
import org.dromara.common.core.domain.model.LoginUser;
import org.dromara.common.core.exception.ServiceException;
import org.dromara.common.core.utils.StringUtils;
import org.dromara.common.satoken.utils.LoginHelper;
import org.dromara.web.ai.config.AiGatewayProperties;
import org.dromara.web.ai.config.model.AiGatewayFixedUpstreamProperties;
import org.dromara.web.ai.config.model.AiGatewayTimeoutProperties;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageStat;
import org.dromara.web.ai.domain.vo.openai.OpenAiErrorBody;
import org.dromara.web.ai.domain.vo.openai.OpenAiErrorObject;
import org.dromara.web.ai.domain.vo.QuotaCheckResult;
import org.dromara.web.ai.mapper.AiPackageMapper;
import org.dromara.web.ai.mapper.AiPackageUpstreamMapper;
import org.dromara.web.ai.mapper.AiUsageRecordMapper;
import org.dromara.web.ai.service.IAiAdminService;
import org.dromara.web.ai.service.IAiResponsesGatewayService;
import org.dromara.web.ai.service.impl.support.gateway.GatewayProxyStrategy;
import org.dromara.web.ai.service.impl.support.gateway.GatewayRequestContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
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
     * 启用状态。
     */
    private static final String STATUS_ENABLED = "0";

    /**
     * JSON 请求体类型。
     */
    private static final okhttp3.MediaType JSON_MEDIA_TYPE = okhttp3.MediaType.get(MediaType.APPLICATION_JSON_VALUE);

    private final AiGatewayProperties aiGatewayProperties;
    private final IAiAdminService aiAdminService;
    private final AiPackageMapper packageMapper;
    private final AiPackageUpstreamMapper upstreamMapper;
    private final AiUsageRecordMapper usageRecordMapper;
    private final Clock aiBusinessClock;
    private OkHttpClient httpClient;

    @PostConstruct
    public void initHttpClient() {
        AiGatewayTimeoutProperties timeout = aiGatewayProperties.getTimeout() == null
            ? new AiGatewayTimeoutProperties()
            : aiGatewayProperties.getTimeout();
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(timeoutSeconds(timeout.getConnectSeconds()), TimeUnit.SECONDS)
            .writeTimeout(timeoutSeconds(timeout.getWriteSeconds()), TimeUnit.SECONDS)
            .readTimeout(timeoutSeconds(timeout.getReadSeconds()), TimeUnit.SECONDS)
            .callTimeout(timeoutSeconds(timeout.getCallSeconds()), TimeUnit.SECONDS)
            .build();
    }

    @Override
    public void responses(String body, HttpServletRequest request, HttpServletResponse response) {
        Long userId = requireLoginUserId();
        GatewayRequestContext context = prepareGatewayRequest(body, response, userId);
        if (context == null) {
            return;
        }
        doResponses(body, request, response, context);
    }

    @Override
    public void chatCompletions(String body, HttpServletRequest request, HttpServletResponse response) {
        proxyFixedGateway(body, request, response, chatCompletionsStrategy());
    }

    @Override
    public void anthropicMessages(String body, HttpServletRequest request, HttpServletResponse response) {
        proxyFixedGateway(body, request, response, anthropicMessagesStrategy());
    }

    private void proxyFixedGateway(String body,
                                   HttpServletRequest request,
                                   HttpServletResponse response,
                                   GatewayProxyStrategy strategy) {
        Long userId = requireLoginUserId();
        GatewayRequestContext context = prepareGatewayRequest(body, response, userId);
        if (context == null) {
            return;
        }
        try {
            Request upstreamRequest = strategy.buildRequest(body, request);
            proxyUpstreamResponse(upstreamRequest, response, context, null);
        } catch (IOException e) {
            saveFailureRecord(context.requestId(), userId, context.aiPackage().getId(), null, context.streamingRequest(), "upstream_network_failure", e.getMessage());
            throw new ServiceException("{} 上游网络请求失败：{}", strategy.getName(), e.getMessage());
        }
    }

    private Long requireLoginUserId() {
        LoginUser loginUser = LoginHelper.getLoginUser();
        if (loginUser == null || loginUser.getUserId() == null) {
            throw new ServiceException("未获取到当前登录用户");
        }
        return loginUser.getUserId();
    }

    private GatewayRequestContext prepareGatewayRequest(String body, HttpServletResponse response, Long userId) {
        String requestId = UUID.randomUUID().toString();
        boolean streamingRequest = isStreamRequest(body);
        LocalDateTime now = now();
        AiUserPackageBinding binding = aiAdminService.getCurrentBindingEntity(userId, now);
        if (binding == null) {
            saveRejectedRecord(requestId, userId, null, null, streamingRequest, "no_active_package_binding", "当前用户未绑定可用 AI 套餐");
            writeOpenAiRateLimit(response, "no_active_package_binding", "当前用户未绑定可用 AI 套餐");
            return null;
        }
        AiPackage aiPackage = packageMapper.selectById(binding.getPackageId());
        if (aiPackage == null || !STATUS_ENABLED.equals(aiPackage.getStatus())) {
            saveRejectedRecord(requestId, userId, binding.getPackageId(), null, streamingRequest, "package_unavailable", "当前绑定套餐不存在或已停用");
            writeOpenAiRateLimit(response, "package_unavailable", "当前绑定套餐不存在或已停用");
            return null;
        }

        AiUsageSnapshot snapshot = aiAdminService.getUsageSnapshot(userId, now);
        QuotaCheckResult quotaCheckResult = AiGatewaySupport.checkQuota(aiPackage, snapshot);
        if (!Boolean.TRUE.equals(quotaCheckResult.getAllowed())) {
            saveRejectedRecord(requestId, userId, aiPackage.getId(), null, streamingRequest, quotaCheckResult.getErrorCode(), quotaCheckResult.getMessage());
            writeOpenAiRateLimit(response, quotaCheckResult.getErrorCode(), quotaCheckResult.getMessage());
            return null;
        }
        return new GatewayRequestContext(requestId, userId, aiPackage, streamingRequest);
    }

    private void doResponses(String body, HttpServletRequest request, HttpServletResponse response, GatewayRequestContext context) {
        String requestId = context.requestId();
        Long userId = context.userId();
        AiPackage aiPackage = context.aiPackage();
        List<AiPackageUpstream> upstreams = upstreamMapper.selectList(new LambdaQueryWrapper<AiPackageUpstream>()
            .eq(AiPackageUpstream::getPackageId, aiPackage.getId())
            .eq(AiPackageUpstream::getStatus, STATUS_ENABLED));
        List<AiPackageUpstream> orderedUpstreams = AiGatewaySupport.orderUpstreamsForAttempt(upstreams);
        if (orderedUpstreams.isEmpty()) {
            saveRejectedRecord(requestId, userId, aiPackage.getId(), null, context.streamingRequest(), "no_available_upstream", "当前套餐未配置可用上游节点");
            writeOpenAiRateLimit(response, "no_available_upstream", "当前套餐未配置可用上游节点");
            return;
        }

        IOException lastIoException = null;
        int maxAttempts = Math.min(2, orderedUpstreams.size());
        for (int index = 0; index < maxAttempts; index++) {
            AiPackageUpstream upstream = orderedUpstreams.get(index);
            try {
                proxyToUpstream(body, request, response, context, upstream);
                return;
            } catch (IOException e) {
                lastIoException = e;
                if (index == maxAttempts - 1) {
                    saveFailureRecord(requestId, userId, aiPackage.getId(), upstream.getId(), context.streamingRequest(), "upstream_network_failure", e.getMessage());
                    throw new ServiceException("OpenAI Responses 上游网络请求失败：{}", e.getMessage());
                }
            }
        }
        if (lastIoException != null) {
            throw new ServiceException("OpenAI Responses 上游网络请求失败：{}", lastIoException.getMessage());
        }
    }

    private GatewayProxyStrategy chatCompletionsStrategy() {
        return new GatewayProxyStrategy() {
            @Override
            public String getName() {
                return "OpenAI Chat Completions";
            }

            @Override
            public Request buildRequest(String body, HttpServletRequest request) {
                AiGatewayFixedUpstreamProperties upstream = requireFixedUpstream(aiGatewayProperties.getChatCompletions(), "chat-completions");
                String rewrittenBody = AiGatewaySupport.buildFixedChatCompletionsBody(body, upstream.getDefaultModel());
                return buildFixedChatCompletionsRequest(rewrittenBody, request);
            }
        };
    }

    private GatewayProxyStrategy anthropicMessagesStrategy() {
        return new GatewayProxyStrategy() {
            @Override
            public String getName() {
                return "Anthropic Messages";
            }

            @Override
            public Request buildRequest(String body, HttpServletRequest request) {
                AiGatewayFixedUpstreamProperties upstream = requireFixedUpstream(aiGatewayProperties.getAnthropicMessages(), "anthropic-messages");
                String rewrittenBody = AiGatewaySupport.buildFixedAnthropicMessagesBody(body, upstream.getDefaultModel());
                return buildFixedAnthropicMessagesRequest(rewrittenBody, request);
            }
        };
    }

    private void proxyToUpstream(String body,
                                 HttpServletRequest request,
                                 HttpServletResponse response,
                                 GatewayRequestContext context,
                                 AiPackageUpstream upstream) throws IOException {
        String rewrittenBody = AiGatewaySupport.buildUpstreamBody(body, upstream);
        Request upstreamRequest = buildUpstreamRequest(upstream, rewrittenBody, request);
        proxyUpstreamResponse(upstreamRequest, response, context, upstream.getId());
    }

    private void proxyUpstreamResponse(Request upstreamRequest,
                                       HttpServletResponse response,
                                       GatewayRequestContext context,
                                       Long upstreamId) throws IOException {
        try (Response upstreamResponse = httpClient.newCall(upstreamRequest).execute()) {
            response.setStatus(upstreamResponse.code());
            copyResponseHeaders(upstreamResponse, response);
            ResponseBody responseBody = upstreamResponse.body();
            if (responseBody == null) {
                saveIncompleteRecord(context.requestId(), context.userId(), context.aiPackage().getId(), upstreamId, context.streamingRequest(), "empty_response_body");
                response.flushBuffer();
                return;
            }
            String contentType = upstreamResponse.header(HttpHeaders.CONTENT_TYPE, "");
            boolean streaming = contentType.contains(MediaType.TEXT_EVENT_STREAM_VALUE);
            if (!upstreamResponse.isSuccessful()) {
                proxyFailedResponse(responseBody, response, context, upstreamId, "upstream_http_" + upstreamResponse.code());
                return;
            }
            if (streaming) {
                proxySseResponse(responseBody, response, context.requestId(), context.userId(), context.aiPackage(), upstreamId);
            } else {
                proxyJsonResponse(responseBody, response, context.requestId(), context.userId(), context.aiPackage(), upstreamId);
            }
        }
    }

    private void proxyFailedResponse(ResponseBody responseBody,
                                     HttpServletResponse response,
                                     GatewayRequestContext context,
                                     Long upstreamId,
                                     String reason) throws IOException {
        String responseText = responseBody.string();
        saveFailureRecord(context.requestId(), context.userId(), context.aiPackage().getId(), upstreamId, context.streamingRequest(), reason, responseText);
        response.getOutputStream().write(responseText.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }

    private void proxyJsonResponse(ResponseBody responseBody,
                                   HttpServletResponse response,
                                   String requestId,
                                   Long userId,
                                   AiPackage aiPackage,
                                   Long upstreamId) throws IOException {
        String responseText = responseBody.string();
        AiUsageStat usage = AiGatewaySupport.extractUsageFromJsonBody(responseText);
        if (usage != null) {
            saveSuccessRecord(requestId, userId, aiPackage.getId(), upstreamId, false, usage);
        } else {
            saveIncompleteRecord(requestId, userId, aiPackage.getId(), upstreamId, false, "upstream_usage_missing");
        }
        response.getOutputStream().write(responseText.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }

    private void proxySseResponse(ResponseBody responseBody,
                                  HttpServletResponse response,
                                  String requestId,
                                  Long userId,
                                  AiPackage aiPackage,
                                  Long upstreamId) throws IOException {
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
            saveSuccessRecord(requestId, userId, aiPackage.getId(), upstreamId, true, usage);
        } else {
            saveIncompleteRecord(requestId, userId, aiPackage.getId(), upstreamId, true, "stream_completed_without_usage");
        }
        response.flushBuffer();
    }

    private Request buildUpstreamRequest(AiPackageUpstream upstream, String body, HttpServletRequest request) {
        Request.Builder builder = new Request.Builder()
            .url(upstream.getBaseUrl())
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);

        copyRequestHeader(request, builder, HttpHeaders.ACCEPT);
        copyRequestHeader(request, builder, "OpenAI-Beta");
        if (StringUtils.isNotBlank(upstream.getApiKey())) {
            builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + upstream.getApiKey());
        }
        return builder.build();
    }

    private Request buildFixedChatCompletionsRequest(String body, HttpServletRequest request) {
        AiGatewayFixedUpstreamProperties upstream = requireFixedUpstream(aiGatewayProperties.getChatCompletions(), "chat-completions");
        Request.Builder builder = new Request.Builder()
            .url(upstream.getBaseUrl())
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + upstream.getApiKey());

        copyRequestHeader(request, builder, HttpHeaders.ACCEPT);
        return builder.build();
    }

    private Request buildFixedAnthropicMessagesRequest(String body, HttpServletRequest request) {
        AiGatewayFixedUpstreamProperties upstream = requireFixedUpstream(aiGatewayProperties.getAnthropicMessages(), "anthropic-messages");
        Request.Builder builder = new Request.Builder()
            .url(upstream.getBaseUrl())
            .post(RequestBody.create(JSON_MEDIA_TYPE, body))
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .header("x-api-key", upstream.getApiKey())
            .header("anthropic-version", StringUtils.isNotBlank(request.getHeader("anthropic-version"))
                ? request.getHeader("anthropic-version")
                : upstream.getVersion());

        copyRequestHeader(request, builder, HttpHeaders.ACCEPT);
        copyRequestHeader(request, builder, "anthropic-beta");
        return builder.build();
    }

    private void copyResponseHeaders(Response upstreamResponse, HttpServletResponse response) {
        List<String> responseHeaders = aiGatewayProperties.getResponseHeaders() == null ? List.of() : aiGatewayProperties.getResponseHeaders();
        for (String header : responseHeaders) {
            String value = upstreamResponse.header(header);
            if (StringUtils.isNotBlank(value)) {
                response.setHeader(header, value);
            }
        }
    }

    private void copyRequestHeader(HttpServletRequest request, Request.Builder builder, String header) {
        String value = request.getHeader(header);
        if (StringUtils.isNotBlank(value)) {
            builder.header(header, value);
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
        response.setStatus(aiGatewayProperties.getRateLimitStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        OpenAiErrorBody body = new OpenAiErrorBody();
        OpenAiErrorObject errorObject = new OpenAiErrorObject();
        errorObject.setCode(code);
        errorObject.setType(aiGatewayProperties.getRateLimitType());
        errorObject.setMessage(message);
        body.setError(errorObject);
        try {
            response.getOutputStream().write(Json.str(body).getBytes(StandardCharsets.UTF_8));
            response.flushBuffer();
        } catch (IOException e) {
            throw new ServiceException("写入 OpenAI 兼容限流响应失败：{}", e.getMessage());
        }
    }

    private AiGatewayFixedUpstreamProperties requireFixedUpstream(AiGatewayFixedUpstreamProperties upstream, String configName) {
        if (upstream == null
            || StringUtils.isBlank(upstream.getBaseUrl())
            || StringUtils.isBlank(upstream.getDefaultModel())
            || StringUtils.isBlank(upstream.getApiKey())) {
            throw new ServiceException("AI 网关固定上游配置缺失：{}", configName);
        }
        return upstream;
    }

    private long timeoutSeconds(Long seconds) {
        return seconds == null || seconds <= 0 ? 300L : seconds;
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
        LocalDateTime now = now();
        record.setOccurredAt(now);
        record.setCreateTime(now);
        record.setUpdateTime(now);
        return record;
    }

    private LocalDateTime now() {
        return LocalDateTime.now(aiBusinessClock);
    }

}
