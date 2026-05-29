package org.dromara.web.ai.service.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.github.kongweiguang.v1.json.Json;
import org.dromara.common.core.utils.StringUtils;
import org.dromara.web.ai.config.model.AiGatewayMultimodalUnderstandingProperties;
import org.dromara.web.ai.consts.Prompt;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.form.AiMultimodalUnderstandingForm;
import org.dromara.web.ai.domain.vo.AiMultimodalUnderstandingVo;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageStat;
import org.dromara.web.ai.domain.vo.QuotaCheckResult;
import org.dromara.web.ai.enums.QuotaWindowType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;

/**
 * AI 网关辅助逻辑。
 *
 * @author kongweiguang
 */
public final class AiGatewaySupport {

    /**
     * 默认多模态理解系统提示词。
     */
    private static final String DEFAULT_MULTIMODAL_UNDERSTANDING_SYSTEM_PROMPT = "你是多模态内容理解助手，请基于输入的图片、音频或视频事实用中文回答。";

    /**
     * 默认多模态理解最大输出 token。
     */
    private static final int DEFAULT_MULTIMODAL_UNDERSTANDING_MAX_COMPLETION_TOKENS = 1024;

    private AiGatewaySupport() {
    }

    /**
     * 选择本次请求的首选上游节点。
     *
     * @param upstreams 上游节点列表
     * @return 按优先级和权重选择后的节点顺序
     */
    public static List<AiPackageUpstream> orderUpstreamsForAttempt(List<AiPackageUpstream> upstreams) {
        List<AiPackageUpstream> enabledUpstreams = upstreams.stream()
            .filter(item -> "0".equals(item.getStatus()))
            .sorted(Comparator.comparing(AiPackageUpstream::getPriority).thenComparing(AiPackageUpstream::getId))
            .toList();
        if (enabledUpstreams.isEmpty()) {
            return List.of();
        }
        Map<Integer, List<AiPackageUpstream>> grouped = enabledUpstreams.stream()
            .collect(Collectors.groupingBy(AiPackageUpstream::getPriority));
        Integer highestPriority = grouped.keySet().stream().min(Integer::compareTo).orElseThrow();
        List<AiPackageUpstream> samePriority = new ArrayList<>(grouped.get(highestPriority));
        List<AiPackageUpstream> result = new ArrayList<>();
        while (!samePriority.isEmpty()) {
            AiPackageUpstream selected = weightedPick(samePriority);
            result.add(selected);
            samePriority.removeIf(item -> item.getId().equals(selected.getId()));
        }
        return result;
    }

    /**
     * 执行额度校验。
     *
     * @param aiPackage 套餐
     * @param snapshot  窗口快照
     * @return 检查结果
     */
    public static QuotaCheckResult checkQuota(AiPackage aiPackage, AiUsageSnapshot snapshot) {
        if (snapshot.getFiveHourUsedTokens() >= aiPackage.getFiveHourTokenLimit()) {
            return quotaDenied(QuotaWindowType.FIVE_HOUR, "用户已达到最近 5 小时 token 限额");
        }
        if (snapshot.getWeeklyUsedTokens() >= aiPackage.getWeeklyTokenLimit()) {
            return quotaDenied(QuotaWindowType.WEEKLY, "用户已达到当前 7 天套餐周期 token 限额");
        }
        QuotaCheckResult result = new QuotaCheckResult();
        result.setAllowed(true);
        return result;
    }

    /**
     * 构造上游请求体。
     *
     * @param body     原始请求体
     * @param upstream 上游配置
     * @return 改写后的请求体
     */
    public static String buildUpstreamBody(String body, AiPackageUpstream upstream) {
        try {
            JsonNode jsonNode = Json.node(body);
            if (jsonNode instanceof ObjectNode objectNode) {
                objectNode.put("model", upstream.getModel());
                if (StringUtils.isNotBlank(upstream.getExtraParamsJson())) {
                    mergeUpstreamExtraParams(objectNode, Json.node(upstream.getExtraParamsJson()));
                }
                objectNode.put("instructions", Prompt.prompt);
                return Json.str(objectNode);
            }
        } catch (Exception ignored) {
            // 这里保留原始 body，让上游继续按原协议返回校验结果。
        }
        return body;
    }

    /**
     * 将上游节点配置的扩展请求参数合并到请求体顶层，兼容不同模型厂商的私有参数。
     */
    private static void mergeUpstreamExtraParams(ObjectNode objectNode, JsonNode extraParamsNode) {
        if (!(extraParamsNode instanceof ObjectNode extraParamsObject)) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> fields = extraParamsObject.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            objectNode.set(field.getKey(), field.getValue());
        }
    }

    /**
     * 构造固定 Chat Completions 上游请求体。
     *
     * @param body         原始请求体
     * @param defaultModel 固定模型名
     * @return 改写后的请求体
     */
    public static String buildFixedChatCompletionsBody(String body, String defaultModel) {
        try {
            JsonNode jsonNode = Json.node(body);
            if (jsonNode instanceof ObjectNode objectNode) {
                objectNode.put("model", defaultModel);
                // MiniMax reasoning_split=true 会把思考内容拆到 reasoning_details，避免污染 content。
                objectNode.put("reasoning_split", true);
                return Json.str(objectNode);
            }
        } catch (Exception ignored) {
            // 保留原始 body，让上游继续返回协议错误。
        }
        return body;
    }

    /**
     * 构造固定 Anthropic Messages 上游请求体。
     *
     * @param body         原始请求体
     * @param defaultModel 固定模型名
     * @return 改写后的请求体
     */
    public static String buildFixedAnthropicMessagesBody(String body, String defaultModel) {
        try {
            JsonNode jsonNode = Json.node(body);
            if (jsonNode instanceof ObjectNode objectNode) {
                objectNode.put("model", defaultModel);
                return Json.str(objectNode);
            }
        } catch (Exception ignored) {
            // 保留原始 body，让上游继续返回协议错误。
        }
        return body;
    }

    /**
     * 构造多模态理解上游 Chat Completions 请求体。
     *
     * @param form     多模态理解请求
     * @param upstream 多模态理解固定上游配置
     * @return OpenAI Chat Completions 多模态理解请求体
     */
    public static String buildMultimodalUnderstandingChatCompletionsBody(AiMultimodalUnderstandingForm form,
                                                                         AiGatewayMultimodalUnderstandingProperties upstream) {
        String systemPrompt = StringUtils.isNotBlank(upstream.getSystemPrompt())
            ? upstream.getSystemPrompt()
            : DEFAULT_MULTIMODAL_UNDERSTANDING_SYSTEM_PROMPT;
        if (StringUtils.isBlank(form.getPrompt())) {
            throw new IllegalArgumentException("多模态解析重点不能为空");
        }
        String userPrompt = form.getPrompt().trim();
        Integer maxCompletionTokens = form.getMaxCompletionTokens() != null && form.getMaxCompletionTokens() > 0
            ? form.getMaxCompletionTokens()
            : defaultMaxCompletionTokens(upstream.getMaxCompletionTokens());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", upstream.getDefaultModel());
        body.put("messages", List.of(
            Map.of(
                "role", "system",
                "content", systemPrompt
            ),
            Map.of(
                "role", "user",
                "content", List.of(
                    multimodalContentBlock(form, upstream),
                    Map.of(
                        "type", "text",
                        "text", userPrompt
                    )
                )
            )
        ));
        body.put("max_completion_tokens", maxCompletionTokens);
        return Json.str(body);
    }

    /**
     * 从 OpenAI Chat Completions 多模态理解响应中提取稳定业务结果。
     *
     * @param body      响应 JSON
     * @param mediaKind 媒体类型
     * @return 多模态理解结果
     */
    public static AiMultimodalUnderstandingVo parseMultimodalUnderstandingResult(String body, String mediaKind) {
        try {
            JsonNode root = Json.node(body);
            JsonNode firstChoice = root.path("choices").path(0);
            JsonNode message = firstChoice.path("message");
            String content = StringUtils.isNotBlank(message.path("content").asText(""))
                ? message.path("content").asText("")
                : message.path("reasoning_content").asText("");
            AiMultimodalUnderstandingVo result = new AiMultimodalUnderstandingVo();
            result.setText(content);
            result.setModel(root.path("model").asText(""));
            result.setMediaKind(mediaKind);
            result.setFinishReason(firstChoice.path("finish_reason").asText(null));
            result.setUsage(extractUsage(root));
            return result;
        } catch (Exception ignored) {
            AiMultimodalUnderstandingVo result = new AiMultimodalUnderstandingVo();
            result.setText("");
            result.setModel("");
            result.setMediaKind(mediaKind);
            result.setUsage(null);
            return result;
        }
    }

    /**
     * 从完整 JSON 响应中提取 usage。
     *
     * @param body 响应 JSON
     * @return usage 结果，无法提取时返回 null
     */
    public static AiUsageStat extractUsageFromJsonBody(String body) {
        try {
            JsonNode root = Json.node(body);
            return extractUsage(root);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 从 SSE `data:` 事件 JSON 中提取 usage。
     *
     * @param dataJson 单条 data JSON
     * @return usage 结果，无法提取时返回 null
     */
    public static AiUsageStat extractUsageFromSseData(String dataJson) {
        try {
            JsonNode root = Json.node(dataJson);
            String type = root.path("type").asText("");
            if (!"response.completed".equals(type)) {
                AiUsageStat usage = extractUsage(root);
                if (usage != null) {
                    return usage;
                }
                JsonNode message = root.path("message");
                if (!message.isMissingNode() && !message.isNull()) {
                    usage = extractUsage(message);
                    if (usage != null) {
                        return usage;
                    }
                }
                JsonNode delta = root.path("delta");
                if (!delta.isMissingNode() && !delta.isNull()) {
                    return extractUsage(delta);
                }
                return null;
            }
            JsonNode response = root.path("response");
            return extractUsage(response.isMissingNode() ? root : response);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static AiUsageStat extractUsage(JsonNode root) {
        JsonNode usageNode = root.path("usage");
        if (usageNode.isMissingNode() || usageNode.isNull()) {
            return null;
        }
        long inputTokens = numberOrZero(usageNode, "input_tokens");
        if (inputTokens == 0L) {
            inputTokens = numberOrZero(usageNode, "prompt_tokens");
        }
        long outputTokens = numberOrZero(usageNode, "output_tokens");
        if (outputTokens == 0L) {
            outputTokens = numberOrZero(usageNode, "completion_tokens");
        }
        long totalTokens = numberOrZero(usageNode, "total_tokens");
        if (totalTokens == 0L) {
            totalTokens = inputTokens + outputTokens;
        }
        if (totalTokens <= 0L && inputTokens <= 0L && outputTokens <= 0L) {
            return null;
        }
        AiUsageStat usageStat = new AiUsageStat();
        usageStat.setInputTokens(inputTokens);
        usageStat.setOutputTokens(outputTokens);
        usageStat.setTotalTokens(totalTokens);
        return usageStat;
    }

    private static QuotaCheckResult quotaDenied(QuotaWindowType windowType, String message) {
        QuotaCheckResult result = new QuotaCheckResult();
        result.setAllowed(false);
        result.setMessage(message);
        result.setErrorCode((switch (windowType) {
            case FIVE_HOUR -> "five_hour_quota_exceeded";
            case WEEKLY -> "weekly_quota_exceeded";
        }).toLowerCase(Locale.ROOT));
        return result;
    }

    private static AiPackageUpstream weightedPick(List<AiPackageUpstream> upstreams) {
        int totalWeight = upstreams.stream().map(AiPackageUpstream::getWeight).filter(weight -> weight != null && weight > 0).mapToInt(Integer::intValue).sum();
        if (totalWeight <= 0) {
            return upstreams.get(0);
        }
        int random = ThreadLocalRandom.current().nextInt(totalWeight);
        int current = 0;
        for (AiPackageUpstream upstream : upstreams) {
            current += upstream.getWeight();
            if (random < current) {
                return upstream;
            }
        }
        return upstreams.get(0);
    }

    private static long numberOrZero(JsonNode node, String fieldName) {
        JsonNode valueNode = node.path(fieldName);
        return valueNode.isNumber() ? valueNode.asLong() : 0L;
    }

    private static Map<String, Object> multimodalContentBlock(AiMultimodalUnderstandingForm form,
                                                              AiGatewayMultimodalUnderstandingProperties upstream) {
        String dataUrl = dataUrl(form.getMedia());
        String kind = form.getMedia().getKind().trim().toLowerCase(Locale.ROOT);
        return switch (kind) {
            case "image" -> Map.of(
                "type", "image_url",
                "image_url", Map.of("url", dataUrl)
            );
            case "audio" -> Map.of(
                "type", "input_audio",
                "input_audio", Map.of("data", dataUrl)
            );
            case "video" -> videoContentBlock(dataUrl, form, upstream);
            default -> throw new IllegalArgumentException("不支持的多模态媒体类型：" + form.getMedia().getKind());
        };
    }

    private static Map<String, Object> videoContentBlock(String dataUrl,
                                                         AiMultimodalUnderstandingForm form,
                                                         AiGatewayMultimodalUnderstandingProperties upstream) {
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("type", "video_url");
        block.put("video_url", Map.of("url", dataUrl));
        block.put("fps", defaultVideoFps(form.getFps(), upstream.getDefaultVideoFps()));
        block.put("media_resolution", defaultMediaResolution(form.getMediaResolution(), upstream.getDefaultMediaResolution()));
        return block;
    }

    private static String dataUrl(AiMultimodalUnderstandingForm.MediaPayload media) {
        return "data:%s;base64,%s".formatted(media.getMimeType(), media.getDataBase64());
    }

    private static int defaultMaxCompletionTokens(Integer value) {
        return value == null || value <= 0 ? DEFAULT_MULTIMODAL_UNDERSTANDING_MAX_COMPLETION_TOKENS : value;
    }

    private static double defaultVideoFps(Double value, Double configuredValue) {
        if (value != null && value >= 0.1D && value <= 10D) {
            return value;
        }
        if (configuredValue != null && configuredValue >= 0.1D && configuredValue <= 10D) {
            return configuredValue;
        }
        return 2D;
    }

    private static String defaultMediaResolution(String value, String configuredValue) {
        String normalizedValue = normalizeMediaResolution(value);
        if (StringUtils.isNotBlank(normalizedValue)) {
            return normalizedValue;
        }
        String normalizedConfiguredValue = normalizeMediaResolution(configuredValue);
        return StringUtils.isNotBlank(normalizedConfiguredValue) ? normalizedConfiguredValue : "default";
    }

    private static String normalizeMediaResolution(String value) {
        if (StringUtils.isBlank(value)) {
            return "";
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return "max".equals(normalized) ? "max" : "default";
    }
}
