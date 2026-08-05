import type { TFunction } from 'i18next';
import type { HardwareCapabilities } from '../../../stores/transferProgressStore';

export type EncoderHardwareOption = {
  value: string;
  label: string;
  description: string;
};

export function isExplicitEncoderDevice(value: string): boolean {
  return /^device:(nvenc|amf|qsv):\d+:[a-f0-9]{16}$/i.test(value);
}

export function buildEncoderHardwareOptions(
  hardwareCapabilities: HardwareCapabilities | null,
  t: TFunction,
  isDetecting?: boolean,
): EncoderHardwareOption[] {
  if (isDetecting) {
    return [{
      value: 'detecting',
      label: String(t('speedtest.gpu_detecting_label')),
      description: String(t('speedtest.gpu_detecting_desc')),
    }];
  }

  const options: EncoderHardwareOption[] = [{
    value: 'auto',
    label: String(t('speedtest.gpu_auto_label')),
    description: hardwareCapabilities?.best_encoder
      ? String(t('speedtest.gpu_auto_detected_desc', {
          backend: hardwareCapabilities.best_encoder.encoder_backend.toUpperCase(),
          device: hardwareCapabilities.best_encoder.device_name,
        }))
      : String(t('speedtest.gpu_auto_desc')),
  }];

  if (!hardwareCapabilities) {
    return options;
  }

  const genericBackends = new Set<string>();
  for (const gpu of hardwareCapabilities.gpu) {
    if (!gpu.supported) continue;
    const value = gpu.supports_explicit_selection
      ? `device:${gpu.backend_id}:${gpu.device_index}:${gpu.device_id}`
      : gpu.backend_id;
    if (!gpu.supports_explicit_selection && genericBackends.has(value)) continue;
    genericBackends.add(value);
    options.push({
      value,
      label: String(t('speedtest.gpu_detected_label', {
        name: gpu.name,
        backend: gpu.backend_id.toUpperCase(),
      })),
      description: String(t('speedtest.gpu_detected_desc', {
        encoder: gpu.encoder_codec,
        priority: gpu.priority_rank,
        index: gpu.device_index,
      })),
    });
  }

  const cpu = hardwareCapabilities.cpu;
  options.push({
    value: 'cpu',
    label: String(t('speedtest.gpu_cpu_detected_label', { device: cpu.processor_name })),
    description: String(t('speedtest.gpu_cpu_detected_desc', {
      cores: cpu.cores,
      threads: cpu.threads,
    })),
  });
  return options;
}
