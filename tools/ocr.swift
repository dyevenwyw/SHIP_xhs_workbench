// 本地中文 OCR —— 基于 macOS Vision 框架，无需联网、无需语言包。
// 用法: swift ocr.swift <image或目录...>
// 输出: 每个文件识别结果，JSON 数组 [{file, text}]
import Foundation
import Vision
import AppKit

func ocrFile(_ path: String) async -> (String, String) {
    guard let img = NSImage(contentsOfFile: path) else {
        return (path, "[ERROR: 无法读取图片]")
    }
    var rect = NSRect(origin: .zero, size: img.size)
    guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        return (path, "[ERROR: 无法转换为 CGImage]")
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([req])
    } catch {
        return (path, "[ERROR: \(error.localizedDescription)]")
    }
    guard let obs = req.results, !obs.isEmpty else {
        return (path, "[无文字]")
    }
    // 按自上而下的顺序拼装，近似保留行布局
    let lines = obs
        .sorted { a, b in
            let ay = a.boundingBox.midY
            let by = b.boundingBox.midY
            if abs(ay - by) > 0.01 { return ay > by }
            return a.boundingBox.minX < b.boundingBox.minX
        }
        .compactMap { $0.topCandidates(1).first?.string }
    return (path, lines.joined(separator: "\n"))
}

let args = CommandLine.arguments.dropFirst()
let inputs: [String] = args.flatMap { arg -> [String] in
    var isDir: ObjCBool = false
    if FileManager.default.fileExists(atPath: arg, isDirectory: &isDir), isDir.boolValue {
        let items = (try? FileManager.default.contentsOfDirectory(atPath: arg)) ?? []
        return items
            .filter { ["png","jpg","jpeg","webp","heic"].contains(($0 as NSString).pathExtension.lowercased()) }
            .map { (arg as NSString).appendingPathComponent($0) }
            .sorted()
    }
    return [arg]
}

let sem = DispatchSemaphore(value: 0)
Task {
    if inputs.isEmpty {
        print("[]")
        sem.signal()
        return
    }
    var out: [[String: String]] = []
    for p in inputs {
        let (f, t) = await ocrFile(p)
        out.append(["file": f, "text": t])
    }
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    sem.signal()
}
sem.wait()