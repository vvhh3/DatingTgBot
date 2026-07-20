import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");

const filesToCopy = [
  {
    source: path.join(projectRoot, "data", "banned-terms.txt"),
    destination: path.join(distDir, "data", "banned-terms.txt")
  }
];

for (const file of filesToCopy) {
  if (!existsSync(file.source)) {
    continue;
  }

  mkdirSync(path.dirname(file.destination), { recursive: true });
  copyFileSync(file.source, file.destination);
}

// Copy EJS view templates
const viewsSrc = path.join(projectRoot, "src", "admin", "views");
const viewsDest = path.join(distDir, "admin", "views");

if (existsSync(viewsSrc)) {
  mkdirSync(viewsDest, { recursive: true });
  const entries = readdirSync(viewsSrc);
  for (const entry of entries) {
    copyFileSync(path.join(viewsSrc, entry), path.join(viewsDest, entry));
  }
}
