import type { ReportReason } from "./image-search";

/**
 * Shared report-this-image copy (Images project): the reasons menu and the toasts, used by the
 * picker's per-tile menu and the credit badge's placed-picture item. A leaf module so neither
 * surface pulls the other's component code.
 */
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "unsuitable", label: "Unsuitable" },
  { value: "wrong-subject", label: "Wrong subject" },
  { value: "other", label: "Other" },
];

export const REPORTED_MESSAGE = "Thanks — we've flagged it.";
export const REPORT_FAILED_MESSAGE = "Could not send the report.";
