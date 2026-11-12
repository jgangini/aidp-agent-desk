import { ConfigSelectField, type SelectionField } from "./ConfigSelectField";
import type { ConfigStep, FieldErrors } from "./configurationDraft";
import type { DiscoveryItem, DiscoverySelection } from "./discovery";

const requiredFields: readonly (readonly SelectionField[])[] = [
  ["profile", "compartment_id"],
  ["instance_id", "workspace_id"],
  [],
  [],
];
const loadingStage: Partial<Record<SelectionField, string>> = {
  compartment_id: "resources",
  workspace_id: "agents",
  profile: "profiles",
};

export interface ConfigurationFieldState {
  fieldId: string;
  step: ConfigStep;
  selection: DiscoverySelection;
  disabled: boolean;
  loading: boolean;
  stage: string;
  errors: FieldErrors;
  compartmentWarning?: string;
  onChange: (name: SelectionField, value: string) => void;
  onEmpty: (name: SelectionField, message: string) => void;
}

export function ConfigurationField({
  name,
  label,
  items,
  required = true,
  placeholder = "Seleccionar…",
  state,
}: {
  name: SelectionField;
  label: string;
  items: DiscoveryItem[];
  required?: boolean;
  placeholder?: string;
  state: ConfigurationFieldState;
}) {
  return (
    <ConfigSelectField
      name={name}
      label={label}
      items={items}
      value={state.selection[name]}
      fieldId={state.fieldId}
      required={required}
      placeholder={placeholder}
      disabled={state.disabled}
      nativeRequired={required && requiredFields[state.step].includes(name)}
      loading={state.loading && loadingStage[name] === state.stage}
      error={state.errors[name]}
      warning={name === "compartment_id" ? state.compartmentWarning : undefined}
      onChange={(value) => state.onChange(name, value)}
      onEmpty={() => state.onEmpty(name, `Selecciona ${label.toLowerCase()}.`)}
    />
  );
}
