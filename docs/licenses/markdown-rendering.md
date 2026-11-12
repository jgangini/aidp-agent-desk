# Markdown rendering

Agent Desk uses react-markdown 10.1.0 and remark-gfm 4.0.1 from their published npm packages, pinned in frontend/package-lock.json. Both use the MIT license; notices are retained in react-markdown.txt and remark-gfm.txt.

Official APIs: https://github.com/remarkjs/react-markdown/tree/10.1.0 and https://github.com/remarkjs/remark-gfm/tree/4.0.1. No upstream implementation was copied. The local HAST text-leaf adapter preserves the existing StreamingText animation without parsing Markdown with regular expressions.

Raw HTML is skipped. Markdown image elements are disabled; publication images remain in the validated source carousel. Citation destinations allow HTTP(S) without embedded credentials and fragment anchors, with noopener/noreferrer on external links. Unsafe destinations render as text.
