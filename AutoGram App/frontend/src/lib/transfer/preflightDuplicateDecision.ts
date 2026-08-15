import type {
  PreflightReviewDecision,
  QualityPreflightReport,
  TransferDuplicateChoice,
} from './qualityPreflight';

export function defaultDuplicateChoices(
  report: QualityPreflightReport
): Record<string, TransferDuplicateChoice> {
  return Object.fromEntries(
    report.items.map((item) => [
      item.sourcePath,
      item.duplicateMatch?.matchLevel === 'exact_sha256' ? 'skip' : 'upload',
    ])
  );
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
