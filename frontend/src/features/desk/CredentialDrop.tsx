import { useId, useState } from "react";
import { KeyRound, Upload } from "lucide-react";
import { credentialError, type CredentialKind } from "./credentialFiles";

function CredentialDropSurface({
  kind,
  file,
  stored,
  landing,
}: {
  kind: CredentialKind;
  file?: File;
  stored: boolean;
  landing: number;
}) {
  const Icon = kind === "config" ? Upload : KeyRound;
  return (
    <span className={`credential-drop-surface${landing ? " is-landing" : ""}`}>
      <span className="credential-drop-heading">
        <Icon size={22} aria-hidden="true" />
        <strong>{kind === "config" ? "Archivo config" : "key.pem"}</strong>
      </span>
      <span className="credential-drop-filename" role="status">
        {file
          ? file.name
          : stored
            ? "Guardado en el servidor"
            : "Arrastra aquí el archivo"}
      </span>
      <span className="credential-drop-action" aria-hidden="true">
        {file || stored ? "Cambiar archivo" : "Seleccionar archivo"}
      </span>
    </span>
  );
}

export function CredentialDrop({
  kind,
  file,
  disabled,
  stored = false,
  error,
  onError,
  onSelect,
}: {
  kind: CredentialKind;
  file?: File;
  disabled: boolean;
  stored?: boolean;
  error: string;
  onError: (message: string) => void;
  onSelect: (file: File) => void;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [landing, setLanding] = useState(0);
  const reject = (message: string) => {
    onError(message);
  };
  const select = (files: File[]) => {
    if (disabled || !files.length) return;
    if (files.length !== 1) {
      reject("Selecciona un solo archivo para este campo.");
      return;
    }
    const error = credentialError(kind, files[0]);
    if (error) {
      reject(error);
      return;
    }
    onSelect(files[0]);
    setLanding((value) => value + 1);
  };
  return (
    <label
      className={`file-field credential-drop t-input${over && !disabled ? " is-over" : ""}${file ? " is-filled" : ""}${error ? " is-error" : ""}`}
      data-disabled={disabled}
      onDragEnter={(event) => {
        if (
          !disabled &&
          Array.from(event.dataTransfer.types).includes("Files")
        ) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!(
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ))
          setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        select(Array.from(event.dataTransfer.files));
      }}
    >
      <CredentialDropSurface
        key={landing}
        kind={kind}
        file={file}
        stored={stored}
        landing={landing}
      />
      <input
        className="credential-file-input"
        aria-label={
          kind === "config" ? "Archivo config OCI" : "Archivo key.pem"
        }
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
        type="file"
        name={kind}
        accept={kind === "key" ? ".pem" : undefined}
        required={!file && !stored}
        disabled={disabled}
        onBlur={() => {
          if (!disabled && ((!file && !stored) || error))
            reject(
              error ||
                `Selecciona ${kind === "config" ? "el archivo config" : "key.pem"}.`,
            );
        }}
        onChange={(event) => {
          select(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      {error && (
        <span id={`${id}-error`} className="credential-drop-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
