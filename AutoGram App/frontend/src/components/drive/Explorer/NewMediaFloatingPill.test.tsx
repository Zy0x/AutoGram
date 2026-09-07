import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NewMediaFloatingPill } from './NewMediaFloatingPill';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      if (key === 'drive.content_notice_added') return `${opts?.count ?? 0} media baru`;
      if (key === 'drive.view_top_action') return 'Lihat ke Atas';
      if (key === 'drive.scroll_to_top_title') return 'Gulir ke berkas paling atas';
      if (key === 'drive.dismiss_notice') return 'Abaikan';
      return key;
    },
  }),
}));

describe('NewMediaFloatingPill', () => {
  it('renders count, localized label, and action badge correctly', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <NewMediaFloatingPill
        kind="added"
        count={5}
        onClick={onClick}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('5 media baru')).toBeInTheDocument();
    expect(screen.getByText('Lihat ke Atas')).toBeInTheDocument();
  });

  it('renders micro-thumbnails when provided', () => {
    const previewThumbs = [
      { id: 1, url: 'data:image/png;base64,abc', name: 'photo1.jpg' },
      { id: 2, url: null, name: 'video1.mp4' },
      { id: 3, url: 'data:image/png;base64,def', name: 'photo2.jpg' },
    ];

    const { container } = render(
      <NewMediaFloatingPill
        kind="added"
        count={3}
        previewThumbs={previewThumbs}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    const thumbItems = container.querySelectorAll('.td-floating-top-thumb-item');
    expect(thumbItems.length).toBe(3);

    const images = container.querySelectorAll('.td-floating-top-thumb-img');
    expect(images.length).toBe(2);
  });

  it('triggers onClick when the pill is clicked or pressed via Enter', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <NewMediaFloatingPill
        kind="added"
        count={2}
        onClick={onClick}
        onDismiss={onDismiss}
      />
    );

    const pill = screen.getByRole('button', { name: /gulir ke berkas paling atas/i });
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(pill, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('triggers onDismiss when close × button is clicked without bubbling to onClick', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <NewMediaFloatingPill
        kind="added"
        count={2}
        onClick={onClick}
        onDismiss={onDismiss}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /abaikan/i });
    fireEvent.click(closeBtn);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
