import { describe, expect, it } from "vitest";
import { decimalYearOf as d, formatDuration } from "~/lib/history/scale";

const f = (a: string, b: string) => formatDuration(d(a), d(b));

describe("formatDuration", () => {
  it("uses real days under 60 days", () => {
    expect(f("766-01-01", "766-02-10")).toBe("40 days");
    expect(f("766-01-01", "766-01-02")).toBe("1 day");
  });
  it("uses rounded months up to 24 months", () => {
    expect(f("2000-01-01", "2000-03-29")).toBe("3 months");
    expect(f("2000-01-01", "2001-02-05")).toBe("13 months");
  });
  it("uses years plus months from 24 months", () => {
    expect(f("1900-01-01", "1905-05-01")).toBe("5 years 4 months");
    expect(f("1900-01-01", "1912-05-01")).toBe("12 years");
  });
  it("keeps whole years for year precision", () => {
    expect(f("1887", "1918")).toBe("31 years");
    expect(f("766", "766")).toBe("less than a year");
  });
});
