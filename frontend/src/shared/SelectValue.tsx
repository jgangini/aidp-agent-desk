import { createElement } from "react";

export function SelectValue() {
  return (
    <button type="button" className="select-value">
      {createElement("selectedcontent", { className: "select-value-text" })}
    </button>
  );
}
