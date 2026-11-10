import {
  UNION_STATUSES,
  UNION_TYPES,
  type PersonView,
  updateUnionSchema,
} from '@family-tree/shared';
import { type FormEvent, useId, useState } from 'react';
import {
  FuzzyDateField,
  fromDraft,
  toDraft,
  type FuzzyDraft,
} from '../../components/FuzzyDateField';
import { type FieldErrors, validate } from '../../components/forms';
import { UNION_STATUS_LABEL, UNION_TYPE_LABEL } from '../../trees/format';
import type { useTreesApi } from '../../trees/TreesApiContext';

type Union = PersonView['relations']['unions'][number];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function UnionForm({
  union,
  pending,
  onSubmit,
  onCancel,
}: {
  union: Pick<Union, 'type' | 'status' | 'startDate' | 'endDate'>;
  pending: boolean;
  onSubmit: (input: Parameters<ReturnType<typeof useTreesApi>['updateUnion']>[2]) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const [type, setType] = useState<string>(union.type);
  const [status, setStatus] = useState<string>(union.status);
  const [start, setStart] = useState<FuzzyDraft>(toDraft(union.startDate));
  const [end, setEnd] = useState<FuzzyDraft>(toDraft(union.endDate));
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const change: Record<string, unknown> = {};
    if (type !== union.type) change.type = type;
    if (status !== union.status) change.status = status;
    const startDate = fromDraft(start);
    const endDate = fromDraft(end);
    if (!same(startDate, fromDraft(toDraft(union.startDate)))) change.startDate = startDate;
    if (!same(endDate, fromDraft(toDraft(union.endDate)))) change.endDate = endDate;
    if (Object.keys(change).length === 0) return onCancel();
    const v = validate(updateUnionSchema, change);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    await onSubmit(change as Parameters<typeof onSubmit>[0]);
  }

  const select = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    options: Record<string, string>,
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {Object.entries(options).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)}>
      {select(
        `${uid}-type`,
        'Type',
        type,
        setType,
        Object.fromEntries(UNION_TYPES.map((k) => [k, UNION_TYPE_LABEL[k]])),
      )}
      {select(
        `${uid}-status`,
        'Status',
        status,
        setStatus,
        Object.fromEntries(UNION_STATUSES.map((k) => [k, UNION_STATUS_LABEL[k]])),
      )}
      <FuzzyDateField label="Start" value={start} onChange={setStart} error={errors.startDate} />
      <FuzzyDateField label="End" value={end} onChange={setEnd} error={errors.endDate} />
      <p className="actions">
        <button type="submit" disabled={pending}>
          Save relationship
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
