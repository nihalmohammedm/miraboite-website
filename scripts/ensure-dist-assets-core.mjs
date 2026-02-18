import fs from "node:fs";
import path from "node:path";

const fallbackSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ffffff"/></svg>\n';

function ensureFile(sourcePath, targetPath, sourceLabel, silent) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
    if (!silent) {
      process.stdout.write(`Ensured ${targetPath} from ${sourceLabel}\n`);
    }
    return;
  }

  fs.writeFileSync(targetPath, fallbackSvg, "utf8");
  if (!silent) {
    process.stdout.write(`Created fallback ${targetPath}\n`);
  }
}

export function ensureDistAssets(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const silent = Boolean(options.silent);

  const pairs = [
    {
      source: path.join(cwd, "public", "assets", "background.svg"),
      target: path.join(cwd, "dist", "assets", "background.svg"),
      label: "public/assets/background.svg",
    },
    {
      source: path.join(cwd, "public", "favicon.svg"),
      target: path.join(cwd, "dist", "favicon.svg"),
      label: "public/favicon.svg",
    },
    {
      source: path.join(cwd, "public", "assets", "background.svg"),
      target: path.join(cwd, "public", "dist", "assets", "background.svg"),
      label: "public/assets/background.svg",
    },
    {
      source: path.join(cwd, "public", "favicon.svg"),
      target: path.join(cwd, "public", "dist", "favicon.svg"),
      label: "public/favicon.svg",
    },
  ];

  for (const pair of pairs) {
    ensureFile(pair.source, pair.target, pair.label, silent);
  }
}
