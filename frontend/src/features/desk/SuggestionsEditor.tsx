import { apiFetch as fetch } from "../../shared/identity";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile } from "./profiles";
import { SelectValue } from "../../shared/SelectValue";
import {
  readSuggestions,
  suggestionsChanged,
  type QuerySuggestion,
} from "./suggestions";

async function saveSuggestions(
  identity: string,
  items: QuerySuggestion[],
  signal: AbortSignal,
): Promise<QuerySuggestion[]> {
  const response = await fetch(
    `/api/desk/suggestions/${encodeURIComponent(identity)}`,
    {
      method: "PUT",
      headers: {
        "X-Agent-Desk": "configure",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
      signal,
    },
  );
  if (!response.ok) throw new Error("No se pudieron guardar las sugerencias.");
  return (await response.json()).items as QuerySuggestion[];
}

function useSuggestionDraft(identity: string) {
  const [items, setItems] = useState<QuerySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const original = useRef("[]");
  const dirty = JSON.stringify(items) !== original.current;
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    original.current = "[]";
    setItems([]);
    setError("");
    setNotice("");
    void readSuggestions(identity, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          original.current = JSON.stringify(value);
          setItems(value);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identity]);
  return {
    items,
    setItems,
    loading,
    error,
    setError,
    loadFailed,
    notice,
    setNotice,
    original,
    dirty,
  };
}

export function SuggestionsEditor({
  profiles,
  selected,
}: {
  profiles: AgentProfile[];
  selected: string;
}) {
  const [identity, setIdentity] = useState(selected);
  const {
    items,
    setItems,
    loading,
    error,
    setError,
    loadFailed,
    notice,
    setNotice,
    original,
    dirty,
  } = useSuggestionDraft(identity);
  const [busy, setBusy] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => () => saveRequest.current?.abort(), []);
  const change = (
    index: number,
    field: keyof QuerySuggestion,
    value: string,
  ) => {
    setItems((current) =>
      current.map((item, position) =>
        position === index ? { ...item, [field]: value } : item,
      ),
    );
    setNotice("");
  };
  const save = async () => {
    const controller = new AbortController();
    saveRequest.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveSuggestions(identity, items, controller.signal);
      if (controller.signal.aborted) return;
      original.current = JSON.stringify(saved);
      setItems(saved);
      setNotice("Sugerencias guardadas.");
      window.dispatchEvent(new Event(suggestionsChanged));
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "No se pudo guardar.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="suggestions-editor config-fields">
      <div className="suggestions-toolbar">
        <label>
          Agent Flow
          <select
            className="t-input"
            value={identity}
            disabled={busy}
            onChange={(event) => {
              if (
                !dirty ||
                window.confirm(
                  "¿Descartar los cambios de sugerencias sin guardar?",
                )
              )
                setIdentity(event.target.value);
            }}
          >
            <SelectValue />
            <option value="demo">Demostración local</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="suggestion-add"
          aria-label="Agregar sugerencia"
          disabled={loading || busy || loadFailed || items.length >= 30}
          onClick={() => {
            setItems([...items, { title: "", query: "" }]);
            setNotice("");
          }}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      {loading ? (
        <p role="status">Cargando sugerencias…</p>
      ) : (
        <SuggestionRows
          items={items}
          disabled={busy || loadFailed}
          change={change}
          remove={(index) => {
            setItems(items.filter((_, position) => position !== index));
            setNotice("");
          }}
        />
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="config-feedback config-feedback-success">
          {notice}
        </p>
      )}
      <SuggestionSave
        items={items}
        busy={busy}
        loading={loading}
        loadFailed={loadFailed}
        onSave={save}
      />
    </div>
  );
}

function SuggestionRows({
  items,
  disabled,
  change,
  remove,
}: {
  items: QuerySuggestion[];
  disabled: boolean;
  change: (index: number, field: keyof QuerySuggestion, value: string) => void;
  remove: (index: number) => void;
}) {
  return (
    <fieldset disabled={disabled} className="suggestion-rows">
      <legend className="sr-only">Sugerencias de consulta</legend>
      {items.length > 0 && (
        <div className="suggestion-columns" aria-hidden="true">
          <span>#</span>
          <span>Título</span>
          <span>Consulta</span>
          <span />
        </div>
      )}
      {items.map((item, index) => (
        <div className="suggestion-row" key={index}>
          <span className="suggestion-number" aria-hidden="true">
            {index + 1}
          </span>
          <label>
            <span className="sr-only">Título {index + 1}</span>
            <input
              className="t-input"
              value={item.title}
              maxLength={80}
              onChange={(event) => change(index, "title", event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Consulta {index + 1}</span>
            <input
              className="t-input"
              value={item.query}
              maxLength={500}
              onChange={(event) => change(index, "query", event.target.value)}
            />
          </label>
          <button
            className="suggestion-delete"
            type="button"
            aria-label={`Eliminar sugerencia ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      ))}
    </fieldset>
  );
}

function SuggestionSave({
  items,
  busy,
  loading,
  loadFailed,
  onSave,
}: {
  items: QuerySuggestion[];
  busy: boolean;
  loading: boolean;
  loadFailed: boolean;
  onSave: () => Promise<void>;
}) {
  return (
    <footer>
      <button
        type="button"
        className="save-profile"
        data-tooltip-disabled="true"
        disabled={
          loading ||
          busy ||
          loadFailed ||
          items.some((item) => !item.title.trim() || !item.query.trim())
        }
        onClick={() => void onSave()}
      >
        {busy ? "Guardando…" : "Guardar"}
      </button>
    </footer>
  );
}
