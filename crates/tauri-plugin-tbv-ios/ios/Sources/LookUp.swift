import SwiftUI
import Tauri
import UIKit
#if canImport(Translation)
import Translation
#endif

// The reader's Define and Translate on iPhone and iPad: Apple's own
// dictionary and translation, shown over TBV. Positions are in the page's
// own units (points), from the top left of TBV's view.

struct LookUpArgs: Decodable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

#if canImport(Translation)
@available(iOS 17.4, *)
private struct TranslateCard: View {
  let text: String
  let spot: CGRect
  let done: () -> Void
  @State private var shown = false

  var body: some View {
    // A clear spot over the selected words, for the card to point at on iPad.
    Color.clear
      .frame(width: spot.width, height: spot.height)
      .translationPresentation(isPresented: $shown, text: text)
      .position(x: spot.midX, y: spot.midY)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .ignoresSafeArea()
      .onAppear { shown = true }
      .onChange(of: shown) { _, now in
        if !now { done() }
      }
  }
}
#endif

extension TbvPlugin {
  /// Apple's dictionary for the words (it offers to download one when none is there).
  @objc public func lookUp(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(LookUpArgs.self)
    DispatchQueue.main.async {
      guard let shown = self.manager.viewController else {
        invoke.reject("The dictionary isn't ready.")
        return
      }
      let card = UIReferenceLibraryViewController(term: args.text)
      if shown.traitCollection.horizontalSizeClass == .regular {
        card.modalPresentationStyle = .popover
        card.popoverPresentationController?.sourceView = shown.view
        card.popoverPresentationController?.sourceRect = CGRect(x: args.x, y: args.y, width: max(args.width, 1), height: max(args.height, 1))
      }
      shown.present(card, animated: true)
      invoke.resolve(["shown": true])
    }
  }

  /// Apple's translation for the words; `shown` is false before iOS 17.4,
  /// so TBV translates in Discover instead.
  @objc public func translate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(LookUpArgs.self)
    #if canImport(Translation)
    guard #available(iOS 17.4, *) else {
      invoke.resolve(["shown": false])
      return
    }
    DispatchQueue.main.async {
      guard let shown = self.manager.viewController else {
        invoke.resolve(["shown": false])
        return
      }
      var host: UIViewController?
      let spot = CGRect(x: args.x, y: args.y, width: max(args.width, 1), height: max(args.height, 1))
      let card = UIHostingController(rootView: TranslateCard(text: args.text, spot: spot) { host?.dismiss(animated: false) })
      card.view.backgroundColor = .clear
      card.modalPresentationStyle = .overFullScreen
      host = card
      shown.present(card, animated: false)
      invoke.resolve(["shown": true])
    }
    #else
    invoke.resolve(["shown": false])
    #endif
  }
}
