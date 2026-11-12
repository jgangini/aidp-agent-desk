export type CredentialKind = "config" | "key";

export function credentialError(kind: CredentialKind, file: File) {
  if (!file.size) return "El archivo está vacío.";
  if (file.size > (kind === "config" ? 65536 : 16384))
    return kind === "config"
      ? "Config admite hasta 64 KiB."
      : "key.pem admite hasta 16 KiB.";
  if (kind === "key" && !/\.pem$/iu.test(file.name))
    return "Selecciona una clave privada con extensión .pem.";
  return "";
}
