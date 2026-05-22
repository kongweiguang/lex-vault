import { describe, expect, it } from "vitest";

import type { FileNode } from "@/types/domain";

import { visibleFileNodes } from "@/utils/file-tree";

/** 覆盖文件管理首次打开时的默认折叠行为。 */
const fileNodes: FileNode[] = [
  {
    name: "案件材料",
    path: "案件材料",
    type: "folder",
    children: [
      {
        name: "证据.pdf",
        path: "案件材料/证据.pdf",
        type: "file",
      },
    ],
  },
  {
    name: "说明.md",
    path: "说明.md",
    type: "file",
  },
];

describe("file-tree", () => {
  it("默认空展开集合只展示顶层文件和文件夹", () => {
    expect(visibleFileNodes(fileNodes, new Set()).map((node) => node.path)).toEqual([
      "案件材料",
      "说明.md",
    ]);
  });

  it("文件夹展开后才展示子节点", () => {
    expect(visibleFileNodes(fileNodes, new Set(["案件材料"])).map((node) => node.path)).toEqual([
      "案件材料",
      "案件材料/证据.pdf",
      "说明.md",
    ]);
  });
});
