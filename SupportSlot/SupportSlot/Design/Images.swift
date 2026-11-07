import SwiftUI
import UIKit
import PhotosUI

/// Loads images from `https://` URLs and from the `data:image/...;base64,`
/// URLs the app stores for uploaded photos, with an in-memory cache.
final class ImageLoader: @unchecked Sendable {
    static let shared = ImageLoader()
    private let cache = NSCache<NSString, UIImage>()
    private init() { cache.countLimit = 200; cache.totalCostLimit = 80_000_000 }

    func load(_ source: String?) async -> UIImage? {
        guard let source, !source.isEmpty else { return nil }
        let key = source.count > 200 ? "\(source.prefix(64))…\(source.count)…\(source.suffix(64))" : source
        if let hit = cache.object(forKey: key as NSString) { return hit }

        let image: UIImage?
        if source.hasPrefix("data:image/") {
            image = await Task.detached(priority: .userInitiated) { Self.decodeDataURL(source) }.value
        } else if let url = URL(string: source), url.scheme == "https" {
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            image = UIImage(data: data)
        } else {
            image = nil
        }
        if let image {
            cache.setObject(image, forKey: key as NSString, cost: Int(image.size.width * image.size.height * 4))
        }
        return image
    }

    static func decodeDataURL(_ s: String) -> UIImage? {
        guard let comma = s.firstIndex(of: ","), s[..<comma].contains("base64"),
              let data = Data(base64Encoded: String(s[s.index(after: comma)...]), options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)
    }
}

struct RemoteImage: View {
    let source: String?
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.inkCard
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            }
        }
        .clipped()
        .task(id: source) { image = await ImageLoader.shared.load(source) }
        .accessibilityHidden(true)
    }
}

/// A square avatar with initials when there is no photo.
struct Avatar: View {
    let imageUrl: String?
    let name: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            if let imageUrl, !imageUrl.isEmpty {
                RemoteImage(source: imageUrl)
            } else {
                Theme.inkRaised
                Text(initials).font(Theme.display(size * 0.38)).foregroundStyle(Theme.paperDim)
            }
        }
        .frame(width: size, height: size)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2).compactMap { $0.first }
        return String(parts).uppercased()
    }
}

/// Resizes and compresses a chosen photo into a `data:image/jpeg;base64,…`
/// URL small enough for the database (it rejects anything over 2 MB of text).
enum ImageProcessor {
    static let maxChars = 1_500_000

    static func dataURL(from image: UIImage, maxDimension: CGFloat) -> String? {
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let target = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { ctx in
            UIColor.black.setFill(); ctx.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        var quality: CGFloat = 0.85
        while quality >= 0.3 {
            if let jpeg = resized.jpegData(compressionQuality: quality) {
                let s = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                if s.count <= maxChars { return s }
            }
            quality -= 0.15
        }
        return nil
    }

    static func load(_ item: PhotosPickerItem, maxDimension: CGFloat) async throws -> String {
        guard let data = try await item.loadTransferable(type: Data.self), data.count < 25_000_000, let image = UIImage(data: data) else {
            throw AppError("That doesn't look like a valid image.")
        }
        guard let url = dataURL(from: image, maxDimension: maxDimension) else { throw AppError("That photo is too large to upload. Try a smaller one.") }
        return url
    }
}

/// A photo picker button that shows the current image.
struct PhotoField: View {
    let label: String
    @Binding var imageUrl: String?
    var maxDimension: CGFloat = 800
    var square = true
    var height: CGFloat = 120
    @State private var item: PhotosPickerItem?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoLabel(label)
            HStack(spacing: 14) {
                ZStack {
                    if let imageUrl, !imageUrl.isEmpty { RemoteImage(source: imageUrl) } else { Theme.inkRaised; Image(systemName: "photo").foregroundStyle(Theme.paperDim) }
                }
                .frame(width: square ? height : height * 1.6, height: height)
                .clipped()
                .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                VStack(alignment: .leading, spacing: 8) {
                    PhotosPicker(selection: $item, matching: .images) {
                        Text(imageUrl == nil || imageUrl!.isEmpty ? "Choose photo" : "Change photo")
                    }
                    .buttonStyle(.app(.outline, compact: true))
                    if imageUrl != nil, !(imageUrl ?? "").isEmpty {
                        Button("Remove") { imageUrl = nil }.buttonStyle(.app(.ghost, compact: true)).foregroundStyle(Theme.signal)
                    }
                }
            }
            FieldError(message: error)
        }
        .onChange(of: item) { _, new in
            guard let new else { return }
            Task {
                do { imageUrl = try await ImageProcessor.load(new, maxDimension: maxDimension); error = nil }
                catch { self.error = (error as? AppError)?.message ?? "That photo couldn't be used." }
                item = nil
            }
        }
    }
}
