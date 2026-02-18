import json
import os
import re
from collections import deque
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

START_URL = "https://www.yinru-packaging.com/products.html"
ALLOWED_DOMAIN = "www.yinru-packaging.com"
WORKDIR = "/Users/nihalmohammed/Documents/GitHub/miraboite-website"
OUT_ROOT = os.path.join(WORKDIR, "downloads", "yinru-products-site")
IMG_DIR = os.path.join(OUT_ROOT, "images")
MAX_PAGE_FETCH = 400

PRODUCT_EXCLUDE_TOKENS = {
    "logo",
    "icon",
    "arrow",
    "call",
    "whatsapp",
    "wechat",
    "facebook",
    "twitter",
    "linkedin",
    "youtube",
    "favicon",
    "sprite",
    "loader",
    "preloader",
    "banner",
    "nav",
    "menu",
    "footer",
    "header",
    "blank",
    "share",
}

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif"}


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def normalize_url(url: str) -> str:
    p = urlparse(url)
    normalized = p._replace(fragment="")
    return urlunparse(normalized)


def extract_links(html: str, base_url: str):
    hrefs = re.findall(r"""<a[^>]+href=[\"']([^\"']+)[\"']""", html, flags=re.I)
    links = []
    for href in hrefs:
        href = href.strip()
        if not href or href.startswith("javascript:") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        abs_url = normalize_url(urljoin(base_url, href))
        p = urlparse(abs_url)
        if p.scheme not in {"http", "https"}:
            continue
        if p.netloc != ALLOWED_DOMAIN:
            continue
        if not p.path.lower().endswith(".html"):
            continue
        links.append(abs_url)
    # dedupe preserving order
    seen = set()
    out = []
    for link in links:
        if link not in seen:
            seen.add(link)
            out.append(link)
    return out


def extract_image_urls(html: str, base_url: str):
    pats = [
        r"""<img[^>]+src=[\"']([^\"']+)[\"']""",
        r"""<img[^>]+data-src=[\"']([^\"']+)[\"']""",
        r"""<img[^>]+data-original=[\"']([^\"']+)[\"']""",
        r"""<img[^>]+data-lazy=[\"']([^\"']+)[\"']""",
        r"""srcset=[\"']([^\"']+)[\"']""",
        r"""url\((?:'|\")?([^\)'\"]+)(?:'|\")?\)""",
        r"""content=[\"'](https?://[^\"']+\.(?:jpg|jpeg|png|webp|bmp|avif))[\"']""",
    ]

    raw = []
    for pat in pats:
        raw.extend(re.findall(pat, html, flags=re.I))

    expanded = []
    for item in raw:
        item = item.strip()
        if not item or item.startswith("data:"):
            continue
        if "," in item and (" " in item or "\n" in item):
            for part in [p.strip() for p in item.split(",") if p.strip()]:
                expanded.append(part.split()[0])
        else:
            expanded.append(item)

    out = []
    seen = set()
    for u in expanded:
        abs_u = normalize_url(urljoin(base_url, u))
        p = urlparse(abs_u)
        if p.scheme not in {"http", "https"}:
            continue

        path_lower = p.path.lower()
        _, ext = os.path.splitext(path_lower)

        if ext and ext not in IMG_EXTS:
            continue

        filename = os.path.basename(path_lower)
        if any(token in filename for token in PRODUCT_EXCLUDE_TOKENS):
            continue

        # Keep only likely product image paths.
        if not (
            "/uploads/" in path_lower
            or "jewel" in path_lower
            or "jewelry" in path_lower
            or "packag" in path_lower
            or "box" in path_lower
            or ext in IMG_EXTS
        ):
            continue

        if abs_u not in seen:
            seen.add(abs_u)
            out.append(abs_u)

    return out


def download_image(url: str, referer: str, dest_path: str):
    if os.path.exists(dest_path) and os.path.getsize(dest_path) >= 8 * 1024:
        return True, None
    req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": referer})
    with urlopen(req, timeout=20) as resp:
        ctype = (resp.headers.get("Content-Type") or "").lower()
        data = resp.read()
    if not ctype.startswith("image/"):
        return False, "not-image-content-type"
    if len(data) < 8 * 1024:
        return False, "too-small"
    with open(dest_path, "wb") as f:
        f.write(data)
    return True, None


def safe_filename_from_url(url: str, idx: int) -> str:
    p = urlparse(url)
    base = os.path.basename(p.path) or f"image_{idx}.jpg"
    if "." not in base:
        base += ".jpg"
    base = re.sub(r"[^A-Za-z0-9._-]", "-", base)
    if len(base) > 120:
        stem, ext = os.path.splitext(base)
        base = stem[:100] + ext
    return base


def main():
    os.makedirs(IMG_DIR, exist_ok=True)

    queue = deque([START_URL])
    visited = set()
    page_html_map = {}

    while queue and len(visited) < MAX_PAGE_FETCH:
        page = queue.popleft()
        if page in visited:
            continue

        try:
            html = fetch_text(page)
        except Exception:
            visited.add(page)
            continue

        visited.add(page)
        page_html_map[page] = html

        if page == START_URL:
            for link in extract_links(html, page):
                if link not in visited:
                    queue.append(link)

    all_images = {}
    for page, html in page_html_map.items():
        for img in extract_image_urls(html, page):
            all_images.setdefault(img, set()).add(page)

    image_urls = sorted(all_images.keys())

    manifest = []
    name_count = {}
    downloaded = 0

    for idx, img_url in enumerate(image_urls, 1):
        name = safe_filename_from_url(img_url, idx)
        key = name.lower()
        name_count[key] = name_count.get(key, 0) + 1
        if name_count[key] > 1:
            stem, ext = os.path.splitext(name)
            name = f"{stem}_{name_count[key]}{ext}"

        dest = os.path.join(IMG_DIR, name)
        ok, err = False, None
        try:
            first_page = sorted(all_images[img_url])[0]
            ok, err = download_image(img_url, first_page, dest)
        except Exception as ex:
            err = str(ex)

        if ok:
            downloaded += 1

        manifest.append(
            {
                "image_url": img_url,
                "pages": sorted(all_images[img_url]),
                "saved_file": name if ok else None,
                "ok": ok,
                "error": err,
            }
        )

        if idx % 25 == 0:
            print(f"processed {idx}/{len(image_urls)}", flush=True)

    summary = {
        "start_url": START_URL,
        "pages_fetched": len(page_html_map),
        "page_urls": sorted(page_html_map.keys()),
        "image_candidates": len(image_urls),
        "images_downloaded": downloaded,
        "images_failed": len(image_urls) - downloaded,
    }

    with open(os.path.join(OUT_ROOT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    with open(os.path.join(OUT_ROOT, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
