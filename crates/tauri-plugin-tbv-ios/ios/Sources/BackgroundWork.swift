import BackgroundTasks
import UIKit

/// Lining up read-along carrying on while TBV is away. When TBV goes into
/// the background with lining up under way, it asks iOS for a little time to
/// finish the piece it's on, and books a background task, which iOS runs
/// later (overnight while charging, say) to carry on. The work itself runs
/// in TBV's core; this only keeps TBV awake for it, until the core says
/// there's nothing left (see `backgroundWork` in TbvPlugin).
final class TbvBackgroundWork: NSObject {
  static let shared = TbvBackgroundWork()
  /// Listed under BGTaskSchedulerPermittedIdentifiers in Info.ios.plist.
  static let lineUpTask = "com.krowsingre.theboundvigil.lineup"

  private var registered = false
  private var busy = false
  private var needsPower = true
  private var task: BGTask?
  private var shortTask: UIBackgroundTaskIdentifier = .invalid

  /// Must be called before TBV finishes opening (iOS's rule for background tasks).
  func register() {
    guard !registered else { return }
    registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.lineUpTask, using: DispatchQueue.main) { task in
      self.run(task)
    }
    NotificationCenter.default.addObserver(
      self, selector: #selector(wentAway), name: UIApplication.didEnterBackgroundNotification, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(cameBack), name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  /// Whether there's lining up to carry on with, and whether it should wait for a charger.
  func set(busy: Bool, needsPower: Bool) {
    DispatchQueue.main.async {
      self.busy = busy
      self.needsPower = needsPower
      if !busy { self.finish() }
    }
  }

  @objc private func wentAway() {
    guard busy else { return }
    // A little time to finish the piece under way, so it's kept.
    shortTask = UIApplication.shared.beginBackgroundTask(withName: "Lining up read-along") { [weak self] in
      self?.endShortTask()
    }
    schedule()
  }

  @objc private func cameBack() {
    endShortTask()
    // On screen again, TBV carries on by itself.
    task?.setTaskCompleted(success: true)
    task = nil
  }

  private func schedule() {
    guard registered else { return }
    let request = BGProcessingTaskRequest(identifier: Self.lineUpTask)
    request.requiresExternalPower = needsPower
    request.requiresNetworkConnectivity = false
    try? BGTaskScheduler.shared.submit(request)
  }

  private func run(_ task: BGTask) {
    self.task = task
    task.expirationHandler = { [weak self] in
      // Out of time: the pieces done are kept, and the rest waits for another go.
      self?.schedule()
      self?.task?.setTaskCompleted(success: false)
      self?.task = nil
    }
    // Opened just for this, TBV's core takes a moment to start and say it's busy.
    DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
      guard let self = self, self.task === task, !self.busy else { return }
      self.finish()
    }
  }

  private func finish() {
    endShortTask()
    task?.setTaskCompleted(success: true)
    task = nil
  }

  private func endShortTask() {
    guard shortTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(shortTask)
    shortTask = .invalid
  }
}

@_cdecl("tbv_register_background_tasks")
public func registerBackgroundTasks() {
  TbvBackgroundWork.shared.register()
}
