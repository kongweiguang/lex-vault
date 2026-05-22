package org.dromara.web.ai.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.dromara.web.ai.service.IAiResponsesGatewayService;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RequiredArgsConstructor
@RestController
@RequestMapping("/")
public class AiController {

    private final IAiResponsesGatewayService aiResponsesGatewayService;

    /**
     * OpenAI Responses API 代理入口。
     */
    @PostMapping(value = "/v1/responses", consumes = MediaType.APPLICATION_JSON_VALUE)
    public void responses(@RequestBody String body, HttpServletRequest request, HttpServletResponse response) {
        aiResponsesGatewayService.responses(body, request, response);
    }
}
