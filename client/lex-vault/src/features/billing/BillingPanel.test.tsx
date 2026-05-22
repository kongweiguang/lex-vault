import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BillingPanel } from "@/features/billing/BillingPanel";
import type { CaseRecord } from "@/types/domain";

const CASES: CaseRecord[] = [
  {
    id: "case-alpha",
    name: "Alpha 合同纠纷",
    casePath: "C:\\workspace\\master\\case-alpha",
  },
];

describe("BillingPanel", () => {
  it("renders the empty case guidance without crashing", () => {
    const markup = renderToStaticMarkup(<BillingPanel cases={[]} onBack={() => undefined} />);

    expect(markup).toContain("当前还没有案件");
    expect(markup).toContain("返回工具首页");
  });

  it("renders the billing workspace for an existing case without crashing", () => {
    const markup = renderToStaticMarkup(<BillingPanel cases={CASES} onBack={() => undefined} />);

    expect(markup).toContain("工时记录与计费");
    expect(markup).toContain("Alpha 合同纠纷");
    expect(markup).toContain("案件默认小时费率");
    expect(markup).toContain("费用记录");
  });
});
