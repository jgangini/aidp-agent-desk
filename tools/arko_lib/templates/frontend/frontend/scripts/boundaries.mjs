import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const root = resolve("src");
const registry = JSON.parse(readFileSync("../.arko/project.json", "utf8")).features;
const errors = [];
const compilerOptions = JSON.parse(readFileSync("tsconfig.json", "utf8")).compilerOptions;
if (compilerOptions.paths || compilerOptions.baseUrl) errors.push("Custom paths/baseUrl need an extended dependency resolver; unsupported in this profile");
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
for (const path of walk(root)) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const own = relative(root, path).split(sep);
  function check(specifier) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      errors.push(`${path}: nonliteral import requires manual analysis`);
      return;
    }
    const name = specifier.text;
    if (!name.startsWith(".")) {
      if (name.startsWith("@/") || name.startsWith("src/")) errors.push(`${path}: unsupported alias ${name}`);
      return;
    }
    const target = relative(root, resolve(path, "..", name)).split(sep);
    if (target[0] === "..") errors.push(`${path}: source import escapes src: ${name}`);
    if (own[0] === "shared" && target[0] === "features") errors.push(`${path}: shared imports feature ${name}`);
    if (own[0] === "features" && target[0] === "features" && own[1] !== target[1]) {
      const allowed = registry[own[1]]?.depends_on ?? [];
      if (!allowed.includes(target[1]) || !/^api(?:\.ts)?$/.test(target[2] ?? "") || target.length !== 3) {
        errors.push(`${path}: forbidden feature import ${name}`);
      }
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) check(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) check(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
