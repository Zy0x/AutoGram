import type {
  PreflightReviewDecision,
  QualityPreflightReport,
  TransferDuplicateChoice,
} from './qualityPreflight';

export function isOptimisticPreflightReport(
  report: QualityPreflightReport | null | undefined
): boolean {
  if (!report || !Array.isArray(report.items) || report.items.length === 0) {
    return false;
  }
  return report.items.some((item) => item.reasonCode === 'optimistic_preflight_loading');
}

export function defaultDuplicateChoices(
  report: QualityPreflightReport
): Record<string, TransferDuplicateChoice> {
  if (isOptimisticPreflightReport(report)) {
    return {};
  }
  return Object.fromEntries(
    report.items.map((item) => [
      item.sourcePath,
      item.duplicateMatch?.matchLevel === 'exact_sha256' ? 'skip' : 'upload',
    ])
  );
}

/**
 * Formats an array of album collage sizes into a compact single-line summary.
 * For small batches (<= maxDirectGroups), returns "10 + 10 + 6 + 5".
 * For large batches (e.g. 2609 items -> 260 groups of 10 + 1 group of 9),
 * collapses consecutive identical group sizes into run-length notation: "260×10 + 9".
 */
export function formatCompactAlbumPartition(
  sizes: number[],
  maxDirectGroups = 6
): string {
  if (!Array.isArray(sizes) || sizes.length === 0) return '';
  if (sizes.length <= maxDirectGroups) {
    return sizes.join(' + ');
  }

  const runs: Array<{ size: number; count: number }> = [];
  for (const size of sizes) {
    const last = runs[runs.length - 1];
    if (last && last.size === size) {
      last.count += 1;
    } else {
      runs.push({ size, count: 1 });
    }
  }

  const formattedRuns = runs.map((run) =>
    run.count > 1 ? `${run.count}×${run.size}` : `${run.size}`
  );

  if (formattedRuns.length <= maxDirectGroups) {
    return formattedRuns.join(' + ');
  }

  return `${formattedRuns.slice(0, maxDirectGroups - 1).join(' + ')} + … + ${
    formattedRuns[formattedRuns.length - 1]
  }`;
}

export function buildPreflightReviewDecision(
  report: QualityPreflightReport,
  choices: Record<string, TransferDuplicateChoice>
): PreflightReviewDecision {
  const skippedPaths: string[] = [];
  const forceUploadPaths: string[] = [];
  for (const item of report.items) {
    if (choices[item.sourcePath] === 'skip') skippedPaths.push(item.sourcePath);
    else if (item.duplicateMatch) forceUploadPaths.push(item.sourcePath);
  }
  return { approved: true, skippedPaths, forceUploadPaths };
}

export const cancelledPreflightDecision: PreflightReviewDecision = {
  approved: false,
  skippedPaths: [],
  forceUploadPaths: [],
};
