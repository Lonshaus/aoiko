// iOS の解析の実行環境（src/native-runner）の試験に使う領収書の画像を作る。
// 中身は src/domain/receipt-layout-extract.test.ts の雛形（作り物）をそのまま紙面に描いたもので、
// 利用者のデータは含まない。CoreText で描き、ImageIO で PNG と JPEG に書き出す。
// 1 枚は画素を 90° 回して EXIF の向き 6 を付け、表示すると正立する形で書き出す。
//
// 使い方: swift scripts/gen-receipt-fixtures.swift <出力ディレクトリ>
import CoreGraphics
import CoreText
import Foundation
import ImageIO

struct Cell {
    let text: String
    let x: Double
}

struct Row {
    let y: Double
    let height: Double
    let cells: [Cell]
}
// receipt-layout-extract.test.ts の receipt() と同じ並び・座標・文字。
let rows: [Row] = [
    Row(y: 0.287, height: 0.023, cells: [Cell(text: "お問合せ先/Help", x: 0.242)]),
    Row(y: 0.301, height: 0.068, cells: [Cell(text: "あおい薬局", x: 0.177)]),
    Row(y: 0.367, height: 0.031, cells: [Cell(text: "【領収証】", x: 0.331)]),
    Row(
        y: 0.4, height: 0.028,
        cells: [Cell(text: "登録番号", x: 0.206), Cell(text: "T1234567890123", x: 0.365)]),
    Row(y: 0.434, height: 0.027, cells: [Cell(text: "ご利用ありがとうございます", x: 0.154)]),
    Row(
        y: 0.488, height: 0.033,
        cells: [Cell(text: "みどり町店", x: 0.117), Cell(text: "0499-99-9999", x: 0.479)]),
    Row(
        y: 0.556, height: 0.032,
        cells: [Cell(text: "2026年05月14日（水）09:32", x: 0.109), Cell(text: "レジ0001", x: 0.622)]),
    Row(y: 0.591, height: 0.037, cells: [Cell(text: "責No00000000", x: 0.104)]),
    Row(
        y: 0.625, height: 0.035,
        cells: [Cell(text: "＊#！ミネラルウォーター", x: 0.143), Cell(text: "¥248", x: 0.69)]),
    Row(
        y: 0.664, height: 0.035,
        cells: [Cell(text: "合計／", x: 0.096), Cell(text: "1点", x: 0.286), Cell(text: "¥248", x: 0.609)]),
    Row(
        y: 0.701, height: 0.036,
        cells: [Cell(text: "（8％税対象", x: 0.096), Cell(text: "¥248）", x: 0.63)]),
    Row(
        y: 0.781, height: 0.036,
        cells: [Cell(text: "（税合計", x: 0.083), Cell(text: "¥18）", x: 0.705)]),
    Row(
        y: 0.817, height: 0.032,
        cells: [Cell(text: "クレジット", x: 0.088), Cell(text: "¥248", x: 0.708)]),
]

let width = 1200
let height = 1600

enum GenerateError: Error {
    case context
    case image
    case destination(String)
}

func makeContext(width: Int, height: Int) throws -> CGContext {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else {
        throw GenerateError.context
    }
    return context
}
// 紙面の座標は左上原点・下向き。CoreGraphics は左下原点なので y を反転して置く。
func renderReceipt() throws -> CGImage {
    let context = try makeContext(width: width, height: height)
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let black = CGColor(red: 0, green: 0, blue: 0, alpha: 1)
    for row in rows {
        let rowHeight = row.height * Double(height)
        let font = CTFontCreateWithName("HiraginoSans-W3" as CFString, rowHeight * 0.72, nil)
        for cell in row.cells {
            let attributes: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): black,
            ]
            let line = CTLineCreateWithAttributedString(
                NSAttributedString(string: cell.text, attributes: attributes))
            let baseline = Double(height) - (row.y * Double(height) + rowHeight * 0.8)
            context.textPosition = CGPoint(x: cell.x * Double(width), y: baseline)
            CTLineDraw(line, context)
        }
    }
    guard let image = context.makeImage() else {
        throw GenerateError.image
    }
    return image
}
// 画素を反時計回りに 90° 回す。EXIF の向き 6（表示時に時計回りへ 90°）を付けると正立して見える。
func rotateCounterClockwise(_ image: CGImage) throws -> CGImage {
    let context = try makeContext(width: image.height, height: image.width)
    context.translateBy(x: CGFloat(image.height), y: 0)
    context.rotate(by: .pi / 2)
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let rotated = context.makeImage() else {
        throw GenerateError.image
    }
    return rotated
}

func write(_ image: CGImage, to url: URL, type: String, properties: [CFString: Any]) throws {
    guard
        let destination = CGImageDestinationCreateWithURL(url as CFURL, type as CFString, 1, nil)
    else {
        throw GenerateError.destination(url.lastPathComponent)
    }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        throw GenerateError.destination(url.lastPathComponent)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: gen-receipt-fixtures.swift <dir>\n".utf8))
    exit(2)
}
let outDir = URL(fileURLWithPath: arguments[1], isDirectory: true)
do {
    try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    let upright = try renderReceipt()
    let rotated = try rotateCounterClockwise(upright)
    let jpeg: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.9]
    var rotatedJpeg = jpeg
    rotatedJpeg[kCGImagePropertyOrientation] = 6
    rotatedJpeg[kCGImagePropertyTIFFDictionary] = [kCGImagePropertyTIFFOrientation: 6]
    let outputs: [(name: String, image: CGImage, type: String, properties: [CFString: Any])] = [
        ("receipt-a.png", upright, "public.png", [:]),
        ("receipt-a.jpg", upright, "public.jpeg", jpeg),
        ("receipt-a-exif6.jpg", rotated, "public.jpeg", rotatedJpeg),
    ]
    var list: [[String: Any]] = []
    for output in outputs {
        try write(
            output.image, to: outDir.appendingPathComponent(output.name), type: output.type,
            properties: output.properties)
        list.append([
            "file": output.name,
            "mimeType": output.type == "public.png" ? "image/png" : "image/jpeg",
            "storedWidth": output.image.width,
            "storedHeight": output.image.height,
            "orientation": output.name.contains("exif6") ? 6 : 1,
        ])
        print(output.name)
    }
    let json = try JSONSerialization.data(
        withJSONObject: ["template": "receipt-layout-extract.test.ts receipt()", "fixtures": list],
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    try json.write(to: outDir.appendingPathComponent("fixtures.json"))
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}