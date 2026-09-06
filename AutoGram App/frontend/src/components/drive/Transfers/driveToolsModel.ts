/**
 * Compatibility façade for the former drive-tools settings model.
 *
 * Transfer settings are now owned by transferSettingsModel.ts. Keeping this
 * re-export avoids breaking consumers while preventing model drift.
 */
export * from './transferSettingsModel';
