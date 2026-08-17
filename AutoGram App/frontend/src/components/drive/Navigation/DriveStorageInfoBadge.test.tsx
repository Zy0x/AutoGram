import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DriveStorageInfoBadge } from './DriveStorageInfoBadge';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts?.count != null) return `${key}:${opts.count}`;
      if (opts?.defaultValue) return opts.defaultValue;
      return key;
    },
  }),
}));

describe('DriveStorageInfoBadge', () => {
  it('renders interactive storage info pill and auto-hides after 4s', () => {
    vi.useFakeTimers();
    const { container } = render(
      <DriveStorageInfoBadge
        fileCount={150}
        totalCount={150}
        spaceLabel="24.5 MB"
        isFinal={true}
        statsAccurate={true}
        locationKey="test-folder"
      />
    );

    // Button should exist
    const btn = screen.getByRole('button', { name: /storage_info_badge_aria/i });
    expect(btn).toBeDefined();

    // Splash pill should be visible initially
    const splash = container.querySelector('.td-storage-splash-pill');
    expect(splash).not.toBeNull();

    // Fast forward 4.5 seconds
    act(() => {
      vi.advanceTimersByTime(4500);
    });

    // Splash pill should now be removed from view
    const splashAfter = container.querySelector('.td-storage-splash-pill');
    expect(splashAfter).toBeNull();

    vi.useRealTimers();
  });

  it('toggles popover dialog on button click', () => {
    render(
      <DriveStorageInfoBadge
        fileCount={500}
        totalCount={500}
        spaceLabel="120 MB"
        isFinal={false}
        statsLoading={true}
        locationKey="test-folder-2"
        categoryCounts={{ media: 400, files: 100 }}
      />
    );

    const btn = screen.getByRole('button', { name: /storage_info_badge_aria/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Click to open popover
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeDefined();

    // Click close button inside popover
    const closeBtn = screen.getByRole('button', { name: /storage_info_close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
