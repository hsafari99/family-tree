import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';

/**
 * The fields that can hold a draft: those in a form (a control outside one, like a member's role
 * select, acts at once), and a chosen file. Anything else mid-edit marks itself `data-unsaved`
 * (the photo cropper).
 */
const FIELDS = 'form input, form select, form textarea, input[type="file"]';
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** What a field holds now, in a form that can be compared with what it first held. */
function valueOf(el: Field): string {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))
    return String(el.checked);
  if (el instanceof HTMLSelectElement && el.multiple)
    return [...el.selectedOptions].map((o) => o.value).join('\n');
  return el.value;
}

/**
 * Whether any field inside `ref` holds something other than what it held when it appeared, or a
 * `[data-unsaved]` element is there: a draft an outside click must not throw away. Each field's first value is noted when the dialog
 * opens, and when a form appears inside it later (a MutationObserver), before anyone types.
 * (React keeps a controlled field's `defaultValue` in step with its value, so that can't tell.)
 */
export function useUnsavedInput(ref: RefObject<HTMLElement | null>): () => boolean {
  const first = useRef(new WeakMap<Element, string>());
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const seen = first.current;
    const note = (el: Element) => {
      if (!seen.has(el)) seen.set(el, valueOf(el as Field));
    };
    const scan = () => root.querySelectorAll(FIELDS).forEach(note);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    // A field the observer hasn't reached yet is noted before its first keystroke.
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(FIELDS)) note(e.target);
    };
    root.addEventListener('focusin', onFocus, true);
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', onFocus, true);
    };
  }, [ref]);
  return useCallback(() => {
    const root = ref.current;
    if (!root) return false;
    if (root.querySelector('[data-unsaved]')) return true;
    return [...root.querySelectorAll<Field>(FIELDS)].some((el) => {
      const was = first.current.get(el);
      return was !== undefined && was !== valueOf(el);
    });
  }, [ref]);
}

/**
 * Handlers for a modal <dialog> that closes on a click on its backdrop: the press and the release
 * must both land outside its box (a text selection dragged out of it doesn't count), and only
 * when `canClose()` says so. A menu drawn past the edge is a descendant, so a click on it never
 * targets the dialog itself.
 */
export function useBackdropClose(onClose: () => void, canClose: () => boolean = () => true) {
  const pressedOutside = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = isBackdrop(e);
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      const outside = pressedOutside.current && isBackdrop(e);
      pressedOutside.current = false;
      if (outside && canClose()) onClose();
    },
  };
}

/** Whether a pointer event hit the backdrop: aimed at the <dialog> itself, outside its box. */
function isBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}
