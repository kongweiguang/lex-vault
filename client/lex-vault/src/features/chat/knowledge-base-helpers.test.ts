import { describe, expect, it } from "vitest";

import {
  filterKnowledgeBaseItems,
  flattenKnowledgeBaseSources,
  listKnowledgeBaseFolderItems,
  type KnowledgeBaseSource,
} from "@/features/chat/components/knowledge-base-helpers";

/** 覆盖模板和法规两类来源的测试文件树。 */
const sources: KnowledgeBaseSource[] = [
  {
    key: "templates",
    label: "模板",
    rootPath: "C:/workspace/doc",
    loading: false,
    nodes: [
      {
        name: "合同",
        path: "合同",
        type: "folder",
        children: [
          {
            name: "买卖合同.md",
            path: "合同/买卖合同.md",
            type: "file",
            extension: "md",
          },
        ],
      },
    ],
  },
  {
    key: "laws",
    label: "法规",
    rootPath: "C:/workspace/law",
    loading: false,
    nodes: [
      {
        name: "民法典.pdf",
        path: "民法典.pdf",
        type: "file",
        extension: "pdf",
      },
    ],
  },
];

describe("knowledge-base helpers", () => {
  it("拍平多来源知识库并保留来源信息", () => {
    const items = flattenKnowledgeBaseSources(sources);

    expect(items).toHaveLength(3);
    expect(items.map((item) => `${item.sourceLabel}:${item.path}`)).toEqual([
      "模板:合同",
      "模板:合同/买卖合同.md",
      "法规:民法典.pdf",
    ]);
  });

  it("按关键字和来源过滤知识库条目", () => {
    const items = flattenKnowledgeBaseSources(sources);

    expect(filterKnowledgeBaseItems(items, "合同", "templates").map((item) => item.path)).toEqual([
      "合同",
      "合同/买卖合同.md",
    ]);
    expect(filterKnowledgeBaseItems(items, "民法", "templates")).toEqual([]);
    expect(filterKnowledgeBaseItems(items, "法规", "all").map((item) => item.path)).toEqual(["民法典.pdf"]);
  });

  it("按当前文件夹只返回直接子项", () => {
    expect(listKnowledgeBaseFolderItems(sources[0], null).map((item) => item.path)).toEqual(["合同"]);
    expect(listKnowledgeBaseFolderItems(sources[0], "合同").map((item) => item.path)).toEqual(["合同/买卖合同.md"]);
  });
});
