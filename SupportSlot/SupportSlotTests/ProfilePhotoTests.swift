import XCTest
import UIKit
@testable import SupportSlot

final class ProfilePhotoTests: XCTestCase {
    private func photo(_ w: CGFloat, _ h: CGFloat, left: UIColor = .red, right: UIColor = .blue) -> UIImage {
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: f).image { ctx in
            left.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: w / 2, height: h))
            right.setFill(); ctx.fill(CGRect(x: w / 2, y: 0, width: w / 2, height: h))
        }
    }
    private func decode(_ url: String?) throws -> UIImage { try XCTUnwrap(url.flatMap(ImageLoader.decodeDataURL)) }

    func testALandscapePhotoBecomesA320SquareFromTheMiddle() throws {
        let out = try decode(ImageProcessor.dataURL(from: photo(1600, 800), maxDimension: ProfilePhoto.size, cropSquare: true))
        XCTAssertEqual(out.size.width, 320); XCTAssertEqual(out.size.height, 320)
    }

    func testAPortraitPhotoBecomesA320Square() throws {
        let out = try decode(ImageProcessor.dataURL(from: photo(600, 1800), maxDimension: ProfilePhoto.size, cropSquare: true))
        XCTAssertEqual(out.size.width, 320); XCTAssertEqual(out.size.height, 320)
    }

    func testASmallPhotoIsCroppedSquareButNeverEnlarged() throws {
        let out = try decode(ImageProcessor.dataURL(from: photo(200, 100), maxDimension: ProfilePhoto.size, cropSquare: true))
        XCTAssertEqual(out.size.width, 100); XCTAssertEqual(out.size.height, 100)
    }

    func testTheMiddleIsKept() throws {
        // Red left half, blue right half: a square cut from the middle is half red, half blue.
        let out = try decode(ImageProcessor.dataURL(from: photo(1600, 800), maxDimension: ProfilePhoto.size, cropSquare: true))
        func pixel(_ x: Int, _ y: Int) -> (r: CGFloat, b: CGFloat) {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1
            var rgba = [UInt8](repeating: 0, count: 4)
            let cs = CGColorSpaceCreateDeviceRGB()
            let ctx = CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(out.cgImage!, in: CGRect(x: -x, y: -(Int(out.size.height) - 1 - y), width: Int(out.size.width), height: Int(out.size.height)))
            return (CGFloat(rgba[0]) / 255, CGFloat(rgba[2]) / 255)
        }
        let left = pixel(20, 160), right = pixel(300, 160)
        XCTAssertGreaterThan(left.r, 0.8); XCTAssertLessThan(left.b, 0.2)
        XCTAssertGreaterThan(right.b, 0.8); XCTAssertLessThan(right.r, 0.2)
    }

    func testOtherPhotosKeepTheirShape() throws {
        let out = try decode(ImageProcessor.dataURL(from: photo(2000, 1000), maxDimension: 1000))
        XCTAssertEqual(out.size.width, 1000); XCTAssertEqual(out.size.height, 500)
    }
}
