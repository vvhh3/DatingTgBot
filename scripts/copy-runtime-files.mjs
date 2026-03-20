import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const filesToCopy = [
  {
    source: path.join(projectRoot, "data", "banned-terms.txt"),
    destination: path.join(projectRoot, "dist", "data", "banned-terms.txt")
  }
];

for (const file of filesToCopy) {
  if (!existsSync(file.source)) {
    continue;
  }

  mkdirSync(path.dirname(file.destination), { recursive: true });
  copyFileSync(file.source, file.destination);
}
