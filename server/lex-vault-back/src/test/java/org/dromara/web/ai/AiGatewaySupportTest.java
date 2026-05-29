package org.dromara.web.ai;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.kongweiguang.v1.json.Json;
import org.dromara.web.ai.config.model.AiGatewayMultimodalUnderstandingProperties;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.form.AiMultimodalUnderstandingForm;
import org.dromara.web.ai.domain.vo.AiMultimodalUnderstandingVo;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageStat;
import org.dromara.web.ai.domain.vo.QuotaCheckResult;
import org.dromara.web.ai.service.impl.AiGatewaySupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AI 网关辅助逻辑测试。
 *
 * @author kongweiguang
 */
@Tag("ai.gateway")
@Tag("dev")
@DisplayName("AI 网关辅助逻辑测试")
class AiGatewaySupportTest {

    @Test
    @DisplayName("非流式 JSON 响应应正确提取 usage")
    void shouldExtractUsageFromJsonBody() {
        String json = """
            {
              "id": "resp_123",
              "usage": {
                "input_tokens": 12,
                "output_tokens": 34,
                "total_tokens": 46
              }
            }
            """;

        AiUsageStat usageStat = AiGatewaySupport.extractUsageFromJsonBody(json);

        assertNotNull(usageStat);
        assertEquals(12L, usageStat.getInputTokens());
        assertEquals(34L, usageStat.getOutputTokens());
        assertEquals(46L, usageStat.getTotalTokens());
    }

    @Test
    @DisplayName("SSE response.completed 事件应正确提取 usage")
    void shouldExtractUsageFromSseCompletedEvent() {
        String event = """
            {
              "type": "response.completed",
              "response": {
                "usage": {
                  "prompt_tokens": 10,
                  "completion_tokens": 20,
                  "total_tokens": 30
                }
              }
            }
            """;

        AiUsageStat usageStat = AiGatewaySupport.extractUsageFromSseData(event);

        assertNotNull(usageStat);
        assertEquals(10L, usageStat.getInputTokens());
        assertEquals(20L, usageStat.getOutputTokens());
        assertEquals(30L, usageStat.getTotalTokens());
    }

    @Test
    @DisplayName("额度达到 5 小时上限时应返回对应错误码")
    void shouldRejectWhenFiveHourQuotaExceeded() {
        AiPackage aiPackage = new AiPackage();
        aiPackage.setFiveHourTokenLimit(100L);
        aiPackage.setWeeklyTokenLimit(500L);

        AiUsageSnapshot snapshot = new AiUsageSnapshot();
        snapshot.setFiveHourUsedTokens(100L);
        snapshot.setWeeklyUsedTokens(120L);

        QuotaCheckResult result = AiGatewaySupport.checkQuota(aiPackage, snapshot);

        assertFalse(Boolean.TRUE.equals(result.getAllowed()));
        assertEquals("five_hour_quota_exceeded", result.getErrorCode());
    }

    @Test
    @DisplayName("额度达到 7 天上限时应返回对应错误码")
    void shouldRejectWhenWeeklyQuotaExceeded() {
        AiPackage aiPackage = new AiPackage();
        aiPackage.setFiveHourTokenLimit(100L);
        aiPackage.setWeeklyTokenLimit(500L);

        AiUsageSnapshot snapshot = new AiUsageSnapshot();
        snapshot.setFiveHourUsedTokens(99L);
        snapshot.setWeeklyUsedTokens(500L);

        QuotaCheckResult result = AiGatewaySupport.checkQuota(aiPackage, snapshot);

        assertFalse(Boolean.TRUE.equals(result.getAllowed()));
        assertEquals("weekly_quota_exceeded", result.getErrorCode());
    }

    @Test
    @DisplayName("只校验 5 小时和 7 天额度")
    void shouldAllowWhenFiveHourAndWeeklyQuotaAreAvailable() {
        AiPackage aiPackage = new AiPackage();
        aiPackage.setFiveHourTokenLimit(100L);
        aiPackage.setWeeklyTokenLimit(500L);

        AiUsageSnapshot snapshot = new AiUsageSnapshot();
        snapshot.setFiveHourUsedTokens(80L);
        snapshot.setWeeklyUsedTokens(300L);

        QuotaCheckResult result = AiGatewaySupport.checkQuota(aiPackage, snapshot);

        assertTrue(Boolean.TRUE.equals(result.getAllowed()));
        assertNull(result.getErrorCode());
    }

    @Test
    @DisplayName("构造上游请求体时应覆盖 model 并合并任意扩展参数")
    void shouldRewriteUpstreamBody() {
        AiPackageUpstream upstream = new AiPackageUpstream();
        upstream.setModel("gpt-5.4");
        upstream.setExtraParamsJson("""
            {"reasoning":{"effort":"medium"},"reasoning_split":true}
            """);

        String rewritten = AiGatewaySupport.buildUpstreamBody("""
            {"model":"legacy","stream":true}
            """, upstream);

        assertTrue(rewritten.contains("\"model\":\"gpt-5.4\""));
        assertTrue(rewritten.contains("\"reasoning\""));
        assertTrue(rewritten.contains("\"effort\":\"medium\""));
        assertTrue(rewritten.contains("\"reasoning_split\":true"));
        assertTrue(rewritten.contains("\"instructions\""));
    }

    @Test
    @DisplayName("固定 chat completions 请求体应强制开启 reasoning_split")
    void shouldRewriteFixedChatCompletionsBody() {
        String rewritten = AiGatewaySupport.buildFixedChatCompletionsBody("""
            {"model":"legacy","stream":false}
            """, "MiniMax-M2.7");

        assertTrue(rewritten.contains("\"model\":\"MiniMax-M2.7\""));
        assertTrue(rewritten.contains("\"reasoning_split\":true"));
    }

    @Test
    @DisplayName("固定 anthropic messages 请求体应强制覆盖模型")
    void shouldRewriteFixedAnthropicMessagesBody() {
        String rewritten = AiGatewaySupport.buildFixedAnthropicMessagesBody("""
            {"model":"legacy","max_tokens":4096}
            """, "MiniMax-M2.7");

        assertTrue(rewritten.contains("\"model\":\"MiniMax-M2.7\""));
        assertTrue(rewritten.contains("\"max_tokens\":4096"));
    }

    @Test
    @DisplayName("多模态图片请求体应按 OpenAI 图片理解格式组装")
    void shouldBuildImageMultimodalUnderstandingChatCompletionsBody() {
        AiGatewayMultimodalUnderstandingProperties properties = new AiGatewayMultimodalUnderstandingProperties();
        properties.setDefaultModel("mimo-v2.5");
        properties.setSystemPrompt("系统提示");
        properties.setMaxCompletionTokens(1024);

        AiMultimodalUnderstandingForm.MediaPayload media = new AiMultimodalUnderstandingForm.MediaPayload();
        media.setKind("image");
        media.setDataBase64("AQID");
        media.setMimeType("image/png");
        media.setFileName("demo.png");
        AiMultimodalUnderstandingForm form = new AiMultimodalUnderstandingForm();
        form.setMedia(media);
        form.setPrompt("只提取图片里的文字");
        form.setMaxCompletionTokens(512);

        JsonNode root = Json.node(AiGatewaySupport.buildMultimodalUnderstandingChatCompletionsBody(form, properties));

        assertEquals("mimo-v2.5", root.path("model").asText());
        assertEquals(512, root.path("max_completion_tokens").asInt());
        assertEquals("系统提示", root.path("messages").path(0).path("content").asText());
        JsonNode userContent = root.path("messages").path(1).path("content");
        assertEquals("image_url", userContent.path(0).path("type").asText());
        assertEquals("data:image/png;base64,AQID", userContent.path(0).path("image_url").path("url").asText());
        assertEquals("text", userContent.path(1).path("type").asText());
        assertEquals("只提取图片里的文字", userContent.path(1).path("text").asText());
    }

    @Test
    @DisplayName("多模态音频请求体应按 OpenAI 音频理解格式组装")
    void shouldBuildAudioMultimodalUnderstandingChatCompletionsBody() {
        AiGatewayMultimodalUnderstandingProperties properties = new AiGatewayMultimodalUnderstandingProperties();
        properties.setDefaultModel("mimo-v2.5");
        properties.setSystemPrompt("系统提示");
        properties.setMaxCompletionTokens(1024);

        AiMultimodalUnderstandingForm.MediaPayload media = new AiMultimodalUnderstandingForm.MediaPayload();
        media.setKind("audio");
        media.setDataBase64("AQID");
        media.setMimeType("audio/mpeg");
        media.setFileName("demo.mp3");
        AiMultimodalUnderstandingForm form = new AiMultimodalUnderstandingForm();
        form.setMedia(media);
        form.setPrompt("总结音频中的发言要点");

        JsonNode root = Json.node(AiGatewaySupport.buildMultimodalUnderstandingChatCompletionsBody(form, properties));
        JsonNode userContent = root.path("messages").path(1).path("content");

        assertEquals("input_audio", userContent.path(0).path("type").asText());
        assertEquals("data:audio/mpeg;base64,AQID", userContent.path(0).path("input_audio").path("data").asText());
        assertEquals("总结音频中的发言要点", userContent.path(1).path("text").asText());
    }

    @Test
    @DisplayName("多模态视频请求体应按 OpenAI 视频理解格式组装")
    void shouldBuildVideoMultimodalUnderstandingChatCompletionsBody() {
        AiGatewayMultimodalUnderstandingProperties properties = new AiGatewayMultimodalUnderstandingProperties();
        properties.setDefaultModel("mimo-v2.5");
        properties.setSystemPrompt("系统提示");
        properties.setMaxCompletionTokens(1024);
        properties.setDefaultVideoFps(2D);
        properties.setDefaultMediaResolution("default");

        AiMultimodalUnderstandingForm.MediaPayload media = new AiMultimodalUnderstandingForm.MediaPayload();
        media.setKind("video");
        media.setDataBase64("AQID");
        media.setMimeType("video/mp4");
        media.setFileName("demo.mp4");
        AiMultimodalUnderstandingForm form = new AiMultimodalUnderstandingForm();
        form.setMedia(media);
        form.setPrompt("总结视频时间线");
        form.setFps(1.5D);
        form.setMediaResolution("max");

        JsonNode root = Json.node(AiGatewaySupport.buildMultimodalUnderstandingChatCompletionsBody(form, properties));
        JsonNode mediaBlock = root.path("messages").path(1).path("content").path(0);

        assertEquals("video_url", mediaBlock.path("type").asText());
        assertEquals("data:video/mp4;base64,AQID", mediaBlock.path("video_url").path("url").asText());
        assertEquals(1.5D, mediaBlock.path("fps").asDouble());
        assertEquals("max", mediaBlock.path("media_resolution").asText());
    }

    @Test
    @DisplayName("多模态理解响应应提取文本、媒体类型、结束原因和 usage")
    void shouldParseMultimodalUnderstandingResult() {
        AiMultimodalUnderstandingVo result = AiGatewaySupport.parseMultimodalUnderstandingResult("""
            {
              "model": "mimo-v2.5",
              "choices": [
                {
                  "message": {
                    "content": "图片里有一份合同扫描件"
                  },
                  "finish_reason": "stop"
                }
              ],
              "usage": {
                "prompt_tokens": 1085,
                "completion_tokens": 574,
                "total_tokens": 1659
              }
            }
            """, "image");

        assertEquals("图片里有一份合同扫描件", result.getText());
        assertEquals("mimo-v2.5", result.getModel());
        assertEquals("image", result.getMediaKind());
        assertEquals("stop", result.getFinishReason());
        assertNotNull(result.getUsage());
        assertEquals(1085L, result.getUsage().getInputTokens());
        assertEquals(574L, result.getUsage().getOutputTokens());
        assertEquals(1659L, result.getUsage().getTotalTokens());
    }

    @Test
    @DisplayName("上游排序只应返回最高优先级分组节点")
    void shouldReturnOnlyHighestPriorityGroup() {
        AiPackageUpstream first = createUpstream(1L, 0, 10);
        AiPackageUpstream second = createUpstream(2L, 0, 20);
        AiPackageUpstream third = createUpstream(3L, 1, 30);

        List<AiPackageUpstream> ordered = AiGatewaySupport.orderUpstreamsForAttempt(List.of(first, second, third));

        assertEquals(2, ordered.size());
        assertTrue(ordered.stream().allMatch(item -> item.getPriority() == 0));
        assertTrue(ordered.stream().map(AiPackageUpstream::getId).toList().containsAll(List.of(1L, 2L)));
    }

    private AiPackageUpstream createUpstream(Long id, int priority, int weight) {
        AiPackageUpstream upstream = new AiPackageUpstream();
        upstream.setId(id);
        upstream.setPriority(priority);
        upstream.setWeight(weight);
        upstream.setStatus("0");
        return upstream;
    }
}
