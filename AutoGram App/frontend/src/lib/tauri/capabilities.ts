/**
 * Feature capability matrix by runtime (desktop vs web).
 * Single source of truth for UI gates — do not scatter ad-hoc isTauri checks for features.
 */
import { getRuntime, type Runtime } from './platform';

export type FeatureId =
  | 'media_studio.upload'
  | 'media_studio.reencode'
  | 'media_studio.speed_lab'
  | 'jobs.migration'
  | 'jobs.view_status'
  | 'auth.supabase'
  | 'settings.api_local';

/** Which runtimes enable each feature. */
const MATRIX: Record<FeatureId, readonly Runtime[]> = {
  'media_studio.upload': ['desktop'],
  'media_studio.reencode': ['desktop'],
  'media_studio.speed_lab': ['desktop'],
  'jobs.migration': ['desktop'],
  'jobs.view_status': ['desktop', 'web'],
  'auth.supabase': ['web'], // optional on desktop later; web primary
  'settings.api_local': ['desktop'],
};

export function hasCapability(feature: FeatureId, runtime?: Runtime): boolean {
  const rt = runtime ?? getRuntime();
  return MATRIX[feature].includes(rt);
}

export function capabilitiesFor(runtime?: Runtime): Record<FeatureId, boolean> {
  const rt = runtime ?? getRuntime();
  const ids = Object.keys(MATRIX) as FeatureId[];
  return ids.reduce(
    (acc, id) => {
      acc[id] = MATRIX[id].includes(rt);
      return acc;
    },
    {} as Record<FeatureId, boolean>
  );
}

export function isMediaStudioAvailable(runtime?: Runtime): boolean {
  return (
    hasCapability('media_studio.upload', runtime) ||
    hasCapability('media_studio.reencode', runtime) ||
    hasCapability('media_studio.speed_lab', runtime)
  );
}
