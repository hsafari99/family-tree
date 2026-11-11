import { UNION_STATUSES, UNION_TYPES } from '@family-tree/shared';
import { useId } from 'react';
import { UNION_STATUS_LABEL, UNION_TYPE_LABEL } from '../../trees/format';

/** A labelled native select (shared by the add-person and add-relative forms). */
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        data-field={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The new union's Type and Status, for a partner. */
export function UnionChoiceSelects({
  type,
  status,
  onType,
  onStatus,
}: {
  type: string;
  status: string;
  onType: (v: string) => void;
  onStatus: (v: string) => void;
}) {
  return (
    <>
      <SelectField
        label="Type"
        value={type}
        onChange={onType}
        options={UNION_TYPES.map((k) => ({ value: k, label: UNION_TYPE_LABEL[k] }))}
      />
      <SelectField
        label="Status"
        value={status}
        onChange={onStatus}
        options={UNION_STATUSES.map((k) => ({ value: k, label: UNION_STATUS_LABEL[k] }))}
      />
    </>
  );
}
