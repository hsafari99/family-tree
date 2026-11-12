import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import * as icons from './icons';

const REQUIRED = [
  'PlusIcon',
  'EditIcon',
  'TrashIcon',
  'SettingsIcon',
  'SearchIcon',
  'UsersIcon',
  'ListIcon',
  'ZoomInIcon',
  'ZoomOutIcon',
  'FitIcon',
  'TargetIcon',
  'MapIcon',
  'ChevronDownIcon',
  'ChevronRightIcon',
  'FanIcon',
  'TreeIcon',
  'MoreIcon',
  'LinkPathIcon',
  'FocusIcon',
  'FullIcon',
  'ArrowIcon',
  'ChevronIcon',
  'XIcon',
  'EyeIcon',
  'IdCardIcon',
  'MapPinIcon',
  'ImageIcon',
  'ClockIcon',
];

const all = Object.entries(icons).filter(([name]) => name.endsWith('Icon')) as [
  string,
  ComponentType<Record<string, never>>,
][];

describe('icon set', () => {
  it('exports every icon the app uses', () => {
    const names = all.map(([name]) => name);
    for (const name of REQUIRED) expect(names, name).toContain(name);
  });

  it.each(all)('%s is a decorative 24-grid line icon', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveClass('icon');
  });
});
