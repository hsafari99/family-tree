import { fireEvent, render, renderHook, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbar, MINIMAP_KEY, useMiniMapShown } from './CanvasToolbar';

const flow = { zoomIn: vi.fn(), zoomOut: vi.fn() };
vi.mock('@xyflow/react', () => ({ useReactFlow: () => flow }));

const stubWidth = (phone: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: phone && q.includes('max-width'), media: q })),
  );

function toolbar(over: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
  const props = {
    canCentreMe: true,
    onFit: vi.fn(),
    onCentreMe: vi.fn(),
    map: { available: true, shown: true, toggle: vi.fn() },
    ...over,
  };
  render(<CanvasToolbar {...props} />);
  return props;
}

beforeEach(() => {
  flow.zoomIn.mockReset();
  flow.zoomOut.mockReset();
  stubWidth(false);
});

describe('CanvasToolbar', () => {
  it('is a labelled group of named buttons with tooltips', () => {
    toolbar();
    expect(screen.getByRole('button', { name: 'Show map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('group', { name: 'Canvas controls' })).toBeInTheDocument();
    for (const name of ['Zoom in', 'Zoom out', 'Fit tree', 'Centre on me', 'Show map']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('data-tip', name);
    }
  });

  it('zooms through React Flow, and fits and centres through the canvas', () => {
    const p = toolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(flow.zoomIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(flow.zoomOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fit tree' }));
    expect(p.onFit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Centre on me' }));
    expect(p.onCentreMe).toHaveBeenCalled();
  });

  it('disables Centre on me when the viewer has no person in the tree', () => {
    const p = toolbar({ canCentreMe: false });
    const b = screen.getByRole('button', { name: 'Centre on me' });
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(p.onCentreMe).not.toHaveBeenCalled();
  });

  it('shows the map state with aria-pressed, and no map button when there is no map', () => {
    const p = toolbar({ map: { available: true, shown: false, toggle: vi.fn() } });
    const b = screen.getByRole('button', { name: 'Show map' });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveAttribute('data-tip', 'Show map');
    fireEvent.click(b);
    expect(p.map.toggle).toHaveBeenCalled();
  });

  it('has no map button for a tree too large for the map', () => {
    toolbar({ map: { available: false, shown: false, toggle: vi.fn() } });
    expect(screen.queryByRole('button', { name: /map$/ })).toBeNull();
  });
});

describe('useMiniMapShown', () => {
  it('is on by default on a desktop and off on a phone', () => {
    expect(renderHook(() => useMiniMapShown()).result.current[0]).toBe(true);
    stubWidth(true);
    expect(renderHook(() => useMiniMapShown()).result.current[0]).toBe(false);
  });

  it('remembers the choice', () => {
    const { result } = renderHook(() => useMiniMapShown());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(MINIMAP_KEY)).toBe('0');
    expect(renderHook(() => useMiniMapShown()).result.current[0]).toBe(false);
    stubWidth(true);
    localStorage.setItem(MINIMAP_KEY, '1');
    expect(renderHook(() => useMiniMapShown()).result.current[0]).toBe(true);
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useMiniMapShown());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    vi.restoreAllMocks();
  });
});
