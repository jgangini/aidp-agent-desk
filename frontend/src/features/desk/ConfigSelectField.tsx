import { LoaderCircle, TriangleAlert } from "lucide-react";
import { SelectValue } from "../../shared/SelectValue";
import type { DiscoveryItem, DiscoverySelection } from "./discovery";

export type SelectionField = keyof Omit<DiscoverySelection, "agent_ids">;

function ConfigSelectFeedback({
  id,
  message,
  warning,
}: {
  id: string;
  message: string;
  warning?: string;
}) {
  if (!message) return null;
  return (
    <span
      id={id}
      className={
        warning
          ? "config-feedback config-feedback-warning"
          : "config-field-error"
      }
      role="alert"
    >
      {warning && <TriangleAlert size={16} aria-hidden="true" />}
      <span>{message}</span>
    </span>
  );
}

export function ConfigSelectField({
  name,
  label,
  items,
  value,
  fieldId,
  required,
  nativeRequired,
  placeholder,
  disabled,
  loading,
  error,
  warning,
  onChange,
  onEmpty,
}: {
  name: SelectionField;
  label: string;
  items: DiscoveryItem[];
  value: string;
  fieldId: string;
  required: boolean;
  nativeRequired: boolean;
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  error?: string;
  warning?: string;
  onChange: (value: string) => void;
  onEmpty: () => void;
}) {
  const audioField = name === "transcription_model" || name === "speech_model";
  const unavailable =
    audioField && !!value && !items.some((item) => item.id === value);
  const message = error || warning || "";
  return (
    <label>
      <span id={`${fieldId}-${name}-label`}>{label}</span>
      <span className={`config-select-shell${loading ? " is-loading" : ""}`}>
        {loading && (
          <LoaderCircle
            className="config-select-spinner"
            size={15}
            aria-hidden="true"
          />
        )}
        <select
          aria-busy={loading}
          name={name}
          value={value}
          required={nativeRequired}
          className={`t-input${error ? " is-error" : warning ? " is-warning" : ""}`}
          aria-labelledby={`${fieldId}-${name}-label`}
          aria-invalid={!!error}
          aria-describedby={message ? `${fieldId}-${name}-error` : undefined}
          disabled={disabled || (!items.length && !audioField)}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => {
            if (
              required &&
              !event.currentTarget.disabled &&
              !event.currentTarget.value
            )
              onEmpty();
          }}
        >
          <SelectValue />
          <option value="">{placeholder}</option>
          {unavailable && (
            <option value={value} disabled>
              Requiere reconfiguración
            </option>
          )}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </span>
      <ConfigSelectFeedback
        id={`${fieldId}-${name}-error`}
        message={message}
        warning={warning}
      />
    </label>
  );
}
