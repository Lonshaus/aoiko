// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-aoiko-native",
    // forOpeningContentTypes(UTType) は後の版で入った。
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "tauri-plugin-aoiko-native",
            type: .static,
            targets: ["tauri-plugin-aoiko-native"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-aoiko-native",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources/AoikoNativePlugin")
    ]
)