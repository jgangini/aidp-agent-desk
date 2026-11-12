import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Columns2,
  Rows2,
} from "lucide-react";
import type { ReportSectionDefinition, TaskReport } from "./report";
import { SelectValue } from "../../shared/SelectValue";
import { prepareSavedReport } from "./reportDownload";
import {
  ReportSurface,
  Limitations,
  additionalReportLimitations,
  unboundAnalysisIds,
} from "./ReportSurface";
import { ReportMedia } from "./ReportMedia";
import { taskRequest, type TaskRun } from "./scheduledApi";
import {
  defaultPresentation,
  readPresentation,
  reorderPresentation,
  groupPresentation,
  detachPresentation,
  type ReportPresentation,
} from "./reportPresentation";
import "./ReportTemplateEditor.css";

type TemplateState = {
  template: TaskReport["template"] | null;
  version: number;
  presentation?: ReportPresentation | null;
};
export function ReportTemplateEditor({
  taskId,
  onClose,
  onSaved,
  previewRun = null,
  onSavingChange,
}: {
  taskId: string;
  onClose: () => void;
  onSaved: (version: number) => void;
  previewRun?: TaskRun | null;
  onSavingChange?: (saving: boolean) => void;
}) {
  const heading = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState<TemplateState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onSavingChange?.(busy);
    return () => onSavingChange?.(false);
  }, [busy, onSavingChange]);
  const [announcement, setAnnouncement] = useState("");
  const dragSource = useRef<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const focusSection = useRef<string | null>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const controller = new AbortController();
    heading.current?.focus();
    setLoaded(null);
    setError("");
    void taskRequest<TemplateState>(
      `/${taskId}/template`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setLoaded({
            ...value,
            presentation: value.template
              ? (readPresentation(
                  value.presentation,
                  value.template.sections,
                ) ?? defaultPresentation(value.template.sections))
              : null,
          });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo cargar el formato.",
          );
      });
    return () => {
      controller.abort();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [taskId]);
  const template = loaded?.template,
    layout = loaded?.presentation;
  useLayoutEffect(() => {
    const id = focusSection.current;
    if (!id) return;
    focusSection.current = null;
    [
      ...(heading.current
        ?.closest(".report-template-editor")
        ?.querySelectorAll<HTMLButtonElement>(".report-format-grip") ?? []),
    ]
      .find(
        (button) =>
          button.closest<HTMLElement>("[data-section-id]")?.dataset
            .sectionId === id,
      )
      ?.focus({ preventScroll: true });
  }, [layout]);
  const saved = useMemo(
    () => (previewRun ? prepareSavedReport(previewRun) : null),
    [previewRun],
  );
  const original = saved?.report?.task_id === taskId ? saved.report : null;
  const preview = original && template ? { ...original, template } : null;
  const fallbackAnalyses =
    preview && saved ? unboundAnalysisIds(preview, saved.extensions) : [];
  const applyLayout = (next: ReportPresentation, focusId?: string) => {
    if (!loaded || !template || busy) return;
    focusSection.current = focusId ?? null;
    const ids = next.rows.flatMap((row) => row.section_ids);
    const sections = ids.map((id) =>
      template.sections.find((section) => section.section_id === id)!,
    );
    setLoaded({
      ...loaded,
      template: { ...template, sections },
      presentation: next,
    });
  };
  const move = (from: number, to: number) => {
    if (
      !layout ||
      !template ||
      from === to ||
      to < 0 ||
      to >= template.sections.length
    )
      return;
    applyLayout(
      reorderPresentation(layout, from, to),
      template.sections[from].section_id,
    );
    setAnnouncement(
      `${template.sections[from].title} movida a la posición ${to + 1} de ${template.sections.length}.`,
    );
  };
  const update = (id: string, patch: Partial<ReportSectionDefinition>) => {
    if (!loaded || !template || busy) return;
    setLoaded({
      ...loaded,
      template: {
        ...template,
        sections: template.sections.map((section) =>
          section.section_id === id ? { ...section, ...patch } : section,
        ),
      },
    });
  };
  const group = (source: string, target: string) => {
    if (!layout) return;
    const next = groupPresentation(layout, source, target);
    if (next === layout) {
      setAnnouncement("La fila admite hasta dos columnas.");
      return;
    }
    applyLayout(next, source);
    setAnnouncement("Secciones agrupadas en dos columnas.");
  };
  const dragOver = (event: DragEvent, target: string) => {
    if (!dragSource.current || busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(target);
  };
  const drop = (event: DragEvent, target: string, beside = false) => {
    event.preventDefault();
    event.stopPropagation();
    const source = dragSource.current;
    if (!source || !template || busy) return;
    if (beside) group(source, target);
    else
      move(
        template.sections.findIndex((s) => s.section_id === source),
        template.sections.findIndex((s) => s.section_id === target),
      );
    dragSource.current = null;
    setDragTarget(null);
  };
  const save = async () => {
    if (!loaded || !template || !layout || busy) return;
    if (template.sections.some((section) => !section.title.trim())) {
      setError("Escribe un título para cada sección.");
      return;
    }
    if (!template.sections.some((section) => section.visibility === "always")) {
      setError("Mantén al menos una sección siempre visible.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await taskRequest<{ version: number }>(
        `/${taskId}/template`,
        "PUT",
        { template, presentation: layout, expectedVersion: loaded.version },
      );
      onSaved(next.version);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo actualizar el formato.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="report-template-editor"
      aria-label="Editar plantilla"
      ref={heading}
      tabIndex={-1}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="report-format-error">
          {error}
        </p>
      )}
      {!loaded && !error && (
        <p role="status" className="report-format-empty">
          Cargando formato…
        </p>
      )}
      {loaded && !template && (
        <p className="report-format-empty">
          El primer informe todavía no tiene una plantilla aceptada.
        </p>
      )}
      {template && layout && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          aria-busy={busy}
        >
          <div className="report-format-body">
            <article
              className="report-format-page"
              aria-label="Vista previa del informe con datos guardados"
            >
              <h1>{preview?.title ?? "Plantilla del informe"}</h1>
              {!preview && (
                <p>
                  No hay un informe aceptado disponible para esta vista previa.
                </p>
              )}
              <ol className="report-format-sections" aria-label="Secciones">
                {layout.rows.map((row) => (
                  <li
                    className="report-format-row"
                    data-columns={row.section_ids.length}
                    key={row.section_ids.join("/")}
                  >
                    {row.section_ids.map((id) => {
                      const section = template.sections.find(
                        (s) => s.section_id === id,
                      )!;
                      const index = template.sections.indexOf(section);
                      return (
                        <section
                          className="report-format-block"
                          data-section-id={id}
                          data-drop-target={
                            dragTarget === id ? "true" : undefined
                          }
                          key={id}
                          onDragOver={(event) => dragOver(event, id)}
                          onDrop={(event) => drop(event, id)}
                        >
                          <div className="report-format-section-heading">
                            <button
                              type="button"
                              className="icon-button report-format-grip"
                              draggable={!busy}
                              disabled={busy}
                              aria-label={`Arrastrar ${section.title}`}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "ArrowUp" ||
                                  event.key === "ArrowDown"
                                ) {
                                  event.preventDefault();
                                  move(
                                    index,
                                    index + (event.key === "ArrowUp" ? -1 : 1),
                                  );
                                }
                              }}
                              onDragStart={(event) => {
                                dragSource.current = id;
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", id);
                              }}
                              onDragEnd={() => {
                                dragSource.current = null;
                                setDragTarget(null);
                              }}
                            >
                              <GripVertical size={17} />
                            </button>
                            <span>Sección {index + 1}</span>
                            <div className="report-format-order-actions">
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Subir ${section.title}`}
                                disabled={busy || index === 0}
                                onClick={() => move(index, index - 1)}
                              >
                                <ChevronUp size={16} />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Bajar ${section.title}`}
                                disabled={
                                  busy || index === template.sections.length - 1
                                }
                                onClick={() => move(index, index + 1)}
                              >
                                <ChevronDown size={16} />
                              </button>
                              {row.section_ids.length === 1 ? (
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Agrupar ${section.title} con anterior`}
                                  disabled={busy || index === 0}
                                  onClick={() =>
                                    group(
                                      id,
                                      template.sections[index - 1].section_id,
                                    )
                                  }
                                >
                                  <Columns2 size={16} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Separar ${section.title}`}
                                  disabled={busy}
                                  onClick={() =>
                                    applyLayout(
                                      detachPresentation(layout, id),
                                      id,
                                    )
                                  }
                                >
                                  <Rows2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="report-format-fields">
                            <label>
                              Título de sección
                              <input
                                className="t-input"
                                value={section.title}
                                maxLength={500}
                                required
                                disabled={busy}
                                onChange={(event) =>
                                  update(id, { title: event.target.value })
                                }
                              />
                            </label>
                            <label>
                              Visibilidad
                              <select
                                className="t-input"
                                value={section.visibility}
                                disabled={busy}
                                onChange={(event) =>
                                  update(id, {
                                    visibility: event.target
                                      .value as ReportSectionDefinition["visibility"],
                                  })
                                }
                              >
                                <SelectValue />
                                <option value="always">Siempre</option>
                                <option value="when_present">
                                  Cuando haya contenido
                                </option>
                              </select>
                            </label>
                          </div>
                          <div className="report-format-block-preview">
                            {preview && saved ? (
                              <ReportSurface
                                report={preview}
                                references={saved.references}
                                extensions={saved.extensions}
                                sectionIds={[id]}
                              />
                            ) : (
                              <p>
                                El contenido aparecerá cuando exista un informe.
                              </p>
                            )}
                          </div>
                          {row.section_ids.length === 1 && (
                            <div
                              className="report-drop-column"
                              role="group"
                              aria-label={`Columna junto a ${section.title}`}
                              data-drop-target={
                                dragTarget === `${id}-column`
                                  ? "true"
                                  : undefined
                              }
                              onDragOver={(event) => {
                                event.stopPropagation();
                                dragOver(event, `${id}-column`);
                              }}
                              onDrop={(event) => drop(event, id, true)}
                            >
                              Arrastra otra sección aquí para añadir una columna
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </li>
                ))}
              </ol>
              {preview && saved && fallbackAnalyses.length > 0 && (
                <ReportSurface
                  report={preview}
                  references={saved.references}
                  extensions={saved.extensions}
                  sectionIds={fallbackAnalyses}
                />
              )}
              {preview && saved && (
                <>
                  <ReportMedia references={saved.references} />
                  <Limitations
                    items={additionalReportLimitations(
                      preview,
                      saved.extensions.warnings,
                    )}
                  />
                </>
              )}
            </article>
          </div>
          <footer>
            <p>Se guarda una nueva versión sin consultar fuentes.</p>
            <button
              type="button"
              className="report-back"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button type="submit" className="report-action" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
