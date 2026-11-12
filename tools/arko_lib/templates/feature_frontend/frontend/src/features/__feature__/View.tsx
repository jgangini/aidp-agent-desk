import { useState, type FormEvent } from "react";
import { createItem } from "./api";

export function FeatureView({ token }: { token: string }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const item = await createItem(token, { title });
      setStatus(`Created: ${item.title}`);
    } catch { setStatus("Could not create item"); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit}>
    <label>Title<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <button disabled={pending || !title.trim()}>Create</button>
    <p role="status">{status}</p>
  </form>;
}
