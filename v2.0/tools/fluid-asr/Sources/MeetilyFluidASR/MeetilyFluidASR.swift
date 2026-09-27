import Foundation
import FluidAudio
import Darwin

struct Output: Encodable {
    let model: String
    let result: ASRResult
    let modelLoadSeconds: Double
    let asrSeconds: Double
}

@main
struct MeetilyFluidASR {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 3 else {
                throw NSError(domain: "MeetilyFluidASR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Usage: MeetilyFluidASR <audio-file> <concurrency:1|2|4>"])
            }
            let file = CommandLine.arguments[1]
            guard FileManager.default.isReadableFile(atPath: file) else {
                throw NSError(domain: "MeetilyFluidASR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Audio file is not readable"])
            }
            guard let concurrency = Int(CommandLine.arguments[2]), [1, 2, 4].contains(concurrency) else {
                throw NSError(domain: "MeetilyFluidASR", code: 4, userInfo: [NSLocalizedDescriptionKey: "Concurrency must be 1, 2, or 4"])
            }

            let loadStarted = ProcessInfo.processInfo.systemUptime
            let models = try await AsrModels.downloadAndLoad(version: .tdtJa)
            let manager = AsrManager(config: ASRConfig(parallelChunkConcurrency: concurrency, streamingEnabled: true))
            try await manager.loadModels(models)
            let modelLoadSeconds = ProcessInfo.processInfo.systemUptime - loadStarted

            var decoderState = try TdtDecoderState()
            let asrStarted = ProcessInfo.processInfo.systemUptime
            let result = try await manager.transcribeDiskBacked(URL(fileURLWithPath: file), decoderState: &decoderState)
            let output = Output(model: "fluid-tdt-ja-0.6b", result: result,
                                modelLoadSeconds: modelLoadSeconds,
                                asrSeconds: ProcessInfo.processInfo.systemUptime - asrStarted)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            var data = try encoder.encode(output)
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
        } catch {
            let payload = ["error": error.localizedDescription]
            let data = (try? JSONEncoder().encode(payload)) ?? Data()
            FileHandle.standardError.write(data + Data([0x0A]))
            exit(1)
        }
    }
}
