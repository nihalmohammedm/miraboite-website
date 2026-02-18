import fs from "node:fs";
import path from "node:path";

export interface PortfolioCollection {
  sourceFolder: string;
  title: string;
  slug: string;
  description: string;
  imageCount: number;
  coverImage: string;
  images: string[];
}

const PUBLIC_ROOT = path.resolve(process.cwd(), "public");
const SCRAPED_ROOT = path.resolve(process.cwd(), "public/assets/scraped");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".avif"]);
const MAX_IMAGES_PER_COLLECTION = 96;

type CategoryRule = {
  key: string;
  title: string;
  description: string;
  keywords: string[];
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    key: "ring-earring",
    title: "Ring and Earring Boxes",
    description: "Small-format product boxes for rings, studs, and earrings.",
    keywords: ["ring", "earring", "earrings", "stud", "studs"],
  },
  {
    key: "necklace-pendant",
    title: "Necklace and Pendant Boxes",
    description: "Long-format and pendant presentation box styles.",
    keywords: ["necklace", "pendant", "brooch", "charm"],
  },
  {
    key: "bracelet-bangle",
    title: "Bracelet and Bangle Boxes",
    description: "Bracelet and bangle packaging styles for premium presentation.",
    keywords: ["bracelet", "bangle", "cufflinks", "cufflink", "wrist"],
  },
  {
    key: "watch",
    title: "Watch Boxes",
    description: "Watch-focused box structures and matching gift formats.",
    keywords: ["watch"],
  },
  {
    key: "travel-storage",
    title: "Travel and Storage Cases",
    description: "Compact travel cases, zipper pouches, and storage-friendly formats.",
    keywords: ["travel", "travelling", "storage", "zipper", "purse", "case", "roll"],
  },
  {
    key: "display-accessories",
    title: "Display and Accessory Packaging",
    description: "Display stands, trays, and accessory-oriented presentation formats.",
    keywords: ["display", "stand", "tray", "mirror", "base"],
  },
  {
    key: "gift-packers",
    title: "Gift Packers and Outer Boxes",
    description: "Outer packing styles and gift-ready packer structures.",
    keywords: ["packer", "2pc", "outer"],
  },
  {
    key: "sets",
    title: "Jewelry Set Boxes",
    description: "Set and combination box formats for multi-piece jewelry assortments.",
    keywords: ["set", "combination", "half-set", "jewlry"],
  },
  {
    key: "pouch",
    title: "Pouches and Bags",
    description: "Soft packaging options such as pouches and bag-style holders.",
    keywords: ["pouch", "bag"],
  },
  {
    key: "wooden",
    title: "Wooden Box Styles",
    description: "Wooden product box options with rigid luxury finishes.",
    keywords: ["wooden", "wood"],
  },
  {
    key: "plastic",
    title: "Plastic Box Styles",
    description: "Plastic jewelry box formats covering multiple retail uses.",
    keywords: ["plastic"],
  },
  {
    key: "paper-cardboard",
    title: "Paper and Cardboard Boxes",
    description: "Paper and cardboard packaging styles for gifting and retail.",
    keywords: ["paper", "cardboard"],
  },
  {
    key: "velvet",
    title: "Velvet and Flocking Styles",
    description: "Velvet and flocking-based finishes with premium soft-touch presentation.",
    keywords: ["velvet", "velour", "flocking"],
  },
  {
    key: "core-jewelry",
    title: "Core Jewelry Box Styles",
    description: "Signature jewelry box structures across key retail and gifting formats.",
    keywords: ["jewelry", "jewellery", "jewellry", "jewelery"],
  },
  {
    key: "design-variants",
    title: "Design Variants",
    description: "Additional design variants and catalog style iterations.",
    keywords: ["extra"],
  },
];

const NON_PRODUCT_KEYWORDS = [
  "template",
  "company-profile",
  "company profile",
  "logo",
  "icon",
  "arrow",
  "call",
  "send_email",
  "send email",
  "whatsapp",
  "wechat",
  "facebook",
  "twitter",
  "linkedin",
  "youtube",
  "favicon",
  "sprite",
];

let cachedCollections: PortfolioCollection[] | null = null;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isDirectoryPath(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function toPublicImageUrl(absolutePath: string): string {
  const relativePath = path.relative(PUBLIC_ROOT, absolutePath);
  const encodedPath = relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/${encodedPath}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isProductImage(filePath: string): boolean {
  const normalized = normalizeText(path.basename(filePath, path.extname(filePath)));
  if (!normalized) {
    return false;
  }

  for (const keyword of NON_PRODUCT_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return false;
    }
  }

  return true;
}

function getCategoryRule(filePath: string): CategoryRule | null {
  const normalized = normalizeText(path.basename(filePath, path.extname(filePath)));
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule;
    }
  }

  return null;
}

function readImagesRecursively(directory: string): string[] {
  const imagePaths: string[] = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && isDirectoryPath(absolutePath));
    if (isDirectory) {
      imagePaths.push(...readImagesRecursively(absolutePath));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    imagePaths.push(absolutePath);
  }

  return imagePaths;
}

function getUniqueSlug(baseSlug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }

  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  const finalSlug = `${baseSlug}-${suffix}`;
  usedSlugs.add(finalSlug);
  return finalSlug;
}

export function getPortfolioCollections(): PortfolioCollection[] {
  if (cachedCollections) {
    return cachedCollections;
  }

  if (!fs.existsSync(SCRAPED_ROOT)) {
    cachedCollections = [];
    return cachedCollections;
  }

  const entries = fs
    .readdirSync(SCRAPED_ROOT, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));

  const collectionDirs = entries
    .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectoryPath(path.join(SCRAPED_ROOT, entry.name))))
    .map((entry) => entry.name);

  const usedSlugs = new Set<string>();
  const collections: PortfolioCollection[] = [];

  for (const [folderIndex, folderName] of collectionDirs.entries()) {
    const collectionPath = path.join(SCRAPED_ROOT, folderName);
    const imagePaths = readImagesRecursively(collectionPath).filter(isProductImage);
    if (imagePaths.length === 0) {
      continue;
    }

    const grouped: Record<string, { rule: CategoryRule | null; images: string[] }> = {};
    const fallbackRule = CATEGORY_RULES.find((rule) => rule.key === "design-variants") ?? null;

    for (const imagePath of imagePaths) {
      const rule = getCategoryRule(imagePath) ?? fallbackRule;
      const key = rule?.key ?? "design-variants";
      if (!grouped[key]) {
        grouped[key] = { rule, images: [] };
      }
      grouped[key].images.push(toPublicImageUrl(imagePath));
    }

    const orderedKeys = [
      ...CATEGORY_RULES.map((rule) => rule.key).filter((key) => grouped[key]),
      ...Object.keys(grouped)
        .filter((key) => !CATEGORY_RULES.some((rule) => rule.key === key))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })),
    ];

    for (const key of orderedKeys) {
      const group = grouped[key];
      if (!group || group.images.length === 0) {
        continue;
      }

      const baseTitle = group.rule ? group.rule.title : "Featured Product Gallery";
      const baseDescription = group.rule
        ? group.rule.description
        : "Special edition packaging styles and mixed-format designs.";

      for (let start = 0, part = 1; start < group.images.length; start += MAX_IMAGES_PER_COLLECTION, part += 1) {
        const chunk = group.images.slice(start, start + MAX_IMAGES_PER_COLLECTION);
        const isChunked = group.images.length > MAX_IMAGES_PER_COLLECTION;
        const chunkTitle = isChunked ? `${baseTitle} ${part}` : baseTitle;
        const chunkSlugBase =
          slugify(`collection-${folderIndex + 1}-${key}${isChunked ? `-${part}` : ""}`) || "collection";
        const chunkSlug = getUniqueSlug(chunkSlugBase, usedSlugs);
        const description = isChunked
          ? `${baseDescription} Part ${part} of ${Math.ceil(group.images.length / MAX_IMAGES_PER_COLLECTION)}.`
          : baseDescription;

        collections.push({
          sourceFolder: folderName,
          title: chunkTitle,
          slug: chunkSlug,
          description,
          imageCount: chunk.length,
          coverImage: chunk[0],
          images: chunk,
        });
      }
    }
  }

  cachedCollections = collections;
  return cachedCollections;
}

export function getPortfolioCollectionBySlug(slug: string): PortfolioCollection | undefined {
  return getPortfolioCollections().find((collection) => collection.slug === slug);
}
