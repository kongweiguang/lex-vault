import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Select } from "@/components/ui/select";

describe("Select", () => {
  it("renders the custom trigger shell and accessible combobox structure", () => {
    const markup = renderToStaticMarkup(
      <Select defaultValue="MEETING">
        <option value="MEETING">会议</option>
        <option value="FOLLOW_UP">跟进</option>
      </Select>,
    );

    expect(markup).toContain("ui-select-shell");
    expect(markup).toContain("ui-select-chevron");
    expect(markup).toContain("ui-select");
    expect(markup).toContain("role=\"combobox\"");
  });

  it("supports wrapper classes, disabled state and background surface", () => {
    const markup = renderToStaticMarkup(
      <Select defaultValue="" disabled surface="background" wrapperClassName="calendar-filter-shell">
        <option value="">全部事项</option>
      </Select>,
    );

    expect(markup).toContain("calendar-filter-shell");
    expect(markup).toContain("ui-select-surface-background");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("aria-hidden=\"true\"");
  });
});
