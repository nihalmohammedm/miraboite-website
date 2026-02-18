import Foundation
import Vision
import CoreGraphics
import ImageIO
import CoreText
import UniformTypeIdentifiers

let fileManager = FileManager.default
let workspaceRoot = URL(fileURLWithPath: fileManager.currentDirectoryPath)
let sourceRoot = workspaceRoot.appendingPathComponent("public/assets/portfolio-source")
let outputRoot = workspaceRoot.appendingPathComponent("public/assets/portfolio-edited")
let replacementsList = workspaceRoot.appendingPathComponent("src/data/beauty-co-exclusions.txt")

struct RunStats {
    var totalListed = 0
    var processed = 0
    var skippedMissing = 0
    var failed = 0
    var withDetectedRegions = 0
    var withFallbackPlacement = 0
}

func normalize(_ text: String) -> String {
    let lowercase = text.lowercased()
    let filtered = lowercase.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }
    return String(String.UnicodeScalarView(filtered))
}

func containsBeautyCo(_ text: String) -> Bool {
    let n = normalize(text)
    if n.contains("beautyco") || n.contains("beautyandco") || n.contains("beautyampco") {
        return true
    }
    return n.contains("beauty") && n.contains("co")
}

func rectFromBoundingBox(_ box: CGRect, imageWidth: CGFloat, imageHeight: CGFloat) -> CGRect {
    let x = box.origin.x * imageWidth
    let y = box.origin.y * imageHeight
    let width = box.width * imageWidth
    let height = box.height * imageHeight
    return CGRect(x: x, y: y, width: width, height: height)
}

func expandedRect(_ rect: CGRect, in bounds: CGRect) -> CGRect {
    let padX = max(6, rect.width * 0.12)
    let padY = max(4, rect.height * 0.45)
    return rect.insetBy(dx: -padX, dy: -padY).intersection(bounds)
}

func mergeRects(_ rects: [CGRect]) -> [CGRect] {
    guard !rects.isEmpty else { return [] }
    var merged: [CGRect] = []

    for rect in rects.sorted(by: { ($0.minY, $0.minX) < ($1.minY, $1.minX) }) {
        var didMerge = false
        for index in merged.indices {
            let expanded = merged[index].insetBy(dx: -10, dy: -8)
            if expanded.intersects(rect) {
                merged[index] = merged[index].union(rect)
                didMerge = true
                break
            }
        }

        if !didMerge {
            merged.append(rect)
        }
    }

    return merged
}

func loadOrientedImage(from sourceURL: URL) -> CGImage? {
    guard let imageSource = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
        return nil
    }

    if let props = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
       let width = props[kCGImagePropertyPixelWidth] as? CGFloat,
       let height = props[kCGImagePropertyPixelHeight] as? CGFloat {
        let maxPixelSize = Int(max(width, height))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true
        ]

        if let transformed = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary) {
            return transformed
        }
    }

    return CGImageSourceCreateImageAtIndex(imageSource, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
}

func detectWatermarkRegions(in image: CGImage) -> [CGRect] {
    var matchedRects: [CGRect] = []
    let request = VNRecognizeTextRequest { request, _ in
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            return
        }

        for observation in observations {
            let candidates = observation.topCandidates(3)
            if candidates.contains(where: { containsBeautyCo($0.string) }) {
                let rect = rectFromBoundingBox(
                    observation.boundingBox,
                    imageWidth: CGFloat(image.width),
                    imageHeight: CGFloat(image.height)
                )
                matchedRects.append(rect)
            }
        }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.015

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return []
    }

    let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    return mergeRects(matchedRects.map { expandedRect($0, in: imageBounds) })
}

func drawLabel(_ label: String, in rect: CGRect, context: CGContext) {
    context.saveGState()

    context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 0.52))
    context.fill(rect)

    let fontSize = max(12, min(rect.height * 0.62, rect.width / 4.2))
    let font = CTFontCreateWithName("HelveticaNeue-Bold" as CFString, fontSize, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 0.95)
    ]
    let attributed = NSAttributedString(string: label, attributes: attributes)
    let line = CTLineCreateWithAttributedString(attributed)
    let lineBounds = CTLineGetBoundsWithOptions(line, [.useOpticalBounds])

    let textX = rect.midX - lineBounds.width / 2 - lineBounds.minX
    let textY = rect.midY - lineBounds.height / 2 - lineBounds.minY
    context.textPosition = CGPoint(x: textX, y: textY)
    CTLineDraw(line, context)

    context.restoreGState()
}

func fallbackRect(for image: CGImage) -> CGRect {
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    let rectWidth = min(max(width * 0.32, 140), width * 0.65)
    let rectHeight = min(max(height * 0.09, 28), 82)
    let x = (width - rectWidth) / 2
    let y = max(height * 0.06, 12)
    return CGRect(x: x, y: y, width: rectWidth, height: rectHeight)
}

func createEditedImage(from sourceURL: URL, to destinationURL: URL) -> (success: Bool, detectedRegions: Bool) {
    guard let image = loadOrientedImage(from: sourceURL) else {
        return (false, false)
    }

    guard let context = CGContext(
        data: nil,
        width: image.width,
        height: image.height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return (false, false)
    }

    let canvasRect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.draw(image, in: canvasRect)

    let regions = detectWatermarkRegions(in: image)
    if regions.isEmpty {
        drawLabel("Custom Logo", in: fallbackRect(for: image), context: context)
    } else {
        for region in regions {
            drawLabel("Custom Logo", in: region, context: context)
        }
    }

    guard let outputImage = context.makeImage() else {
        return (false, false)
    }

    let destinationDirectory = destinationURL.deletingLastPathComponent()
    do {
        try fileManager.createDirectory(at: destinationDirectory, withIntermediateDirectories: true, attributes: nil)
    } catch {
        return (false, !regions.isEmpty)
    }

    guard let imageDestination = CGImageDestinationCreateWithURL(destinationURL as CFURL, {
        let ext = destinationURL.pathExtension.lowercased()
        switch ext {
        case "png": return UTType.png.identifier as CFString
        case "jpg", "jpeg": return UTType.jpeg.identifier as CFString
        default: return UTType.jpeg.identifier as CFString
        }
    }(), 1, nil) else {
        return (false, !regions.isEmpty)
    }

    let ext = destinationURL.pathExtension.lowercased()
    let options: CFDictionary = {
        if ext == "png" {
            return [:] as CFDictionary
        }
        return [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary
    }()

    CGImageDestinationAddImage(imageDestination, outputImage, options)
    if !CGImageDestinationFinalize(imageDestination) {
        return (false, !regions.isEmpty)
    }

    return (true, !regions.isEmpty)
}

func decodeAssetRelativePath(_ assetURLPath: String) -> String? {
    let prefix = "/assets/portfolio-source/"
    guard assetURLPath.hasPrefix(prefix) else {
        return nil
    }

    let encoded = String(assetURLPath.dropFirst(prefix.count))
    return encoded.removingPercentEncoding
}

func main() {
    guard fileManager.fileExists(atPath: replacementsList.path) else {
        fputs("Missing exclusions file: \(replacementsList.path)\n", stderr)
        exit(1)
    }

    let listContent = (try? String(contentsOf: replacementsList, encoding: .utf8)) ?? ""
    let assetLines = listContent
        .split(whereSeparator: \.isNewline)
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let limit = CommandLine.arguments.dropFirst().compactMap { Int($0) }.first
    let inputLines = limit.map { Array(assetLines.prefix($0)) } ?? assetLines

    var stats = RunStats()
    stats.totalListed = inputLines.count

    for (idx, line) in inputLines.enumerated() {
        guard let decodedRelativePath = decodeAssetRelativePath(line) else {
            continue
        }

        let sourceURL = sourceRoot.appendingPathComponent(decodedRelativePath)
        let destinationURL = outputRoot.appendingPathComponent(decodedRelativePath)

        if !fileManager.fileExists(atPath: sourceURL.path) {
            stats.skippedMissing += 1
            continue
        }

        let result = createEditedImage(from: sourceURL, to: destinationURL)
        if result.success {
            stats.processed += 1
            if result.detectedRegions {
                stats.withDetectedRegions += 1
            } else {
                stats.withFallbackPlacement += 1
            }
        } else {
            stats.failed += 1
            fputs("Failed: \(sourceURL.path)\n", stderr)
        }

        if (idx + 1) % 100 == 0 {
            fputs("Processed \(idx + 1)/\(inputLines.count)\n", stderr)
        }
    }

    print("done total=\(stats.totalListed) processed=\(stats.processed) missing=\(stats.skippedMissing) failed=\(stats.failed) detected=\(stats.withDetectedRegions) fallback=\(stats.withFallbackPlacement)")
}

main()
