import AppKit
import SwiftUI
#if canImport(Translation)
import Translation
#endif

// The reader's Define and Translate on the Mac: Apple's own Look Up panel
// and translation, shown over the selected words. Called from
// src-tauri/src/look_up.rs, off the main thread. Positions are in the
// page's own units, from the top left of TBV's window.

/// The window's content, and a rectangle in it for a spot on the page.
private func place(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> (NSView, NSRect)? {
  guard let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible }),
    let view = window.contentView
  else { return nil }
  let top = view.isFlipped ? y : view.bounds.height - y - height
  return (view, NSRect(x: x, y: top, width: max(width, 1), height: max(height, 1)))
}

@_cdecl("tbv_mac_look_up")
public func lookUp(_ textPointer: UnsafePointer<CChar>, _ x: Double, _ y: Double, _ width: Double, _ height: Double) {
  let text = String(cString: textPointer)
  DispatchQueue.main.async {
    guard let (view, rect) = place(x, y, width, height) else { return }
    let shown = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: max(12, min(rect.height * 0.8, 28)))])
    // The panel's word sits on the baseline at this point.
    let baseline = view.isFlipped ? rect.maxY : rect.minY
    view.showDefinition(for: shown, at: NSPoint(x: rect.minX, y: baseline))
  }
}

#if canImport(Translation)
@available(macOS 14.4, *)
private struct TranslateCard: View {
  let text: String
  let done: () -> Void
  @State private var shown = false

  var body: some View {
    Color.clear
      .translationPresentation(isPresented: $shown, text: text)
      .onAppear { shown = true }
      .onChange(of: shown) { _, now in
        if !now { done() }
      }
  }
}
#endif

/// Shows Apple's translation for the words, and answers whether it could
/// (macOS 14.4 and newer).
@_cdecl("tbv_mac_translate")
public func translate(_ textPointer: UnsafePointer<CChar>, _ x: Double, _ y: Double, _ width: Double, _ height: Double) -> Bool {
  #if canImport(Translation)
  guard #available(macOS 14.4, *) else { return false }
  let text = String(cString: textPointer)
  DispatchQueue.main.async {
    guard let (view, rect) = place(x, y, width, height) else { return }
    var host: NSView?
    let card = NSHostingView(rootView: TranslateCard(text: text) { host?.removeFromSuperview() })
    card.frame = rect
    host = card
    view.addSubview(card)
  }
  return true
  #else
  return false
  #endif
}
