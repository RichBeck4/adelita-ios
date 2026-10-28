// Puts Adelita sessions into the Workout app on Apple Watch, using WorkoutKit (iOS 17+).
// The page sends the next two weeks of sessions as JSON; this keeps the watch in step with it:
// new sessions are added, changed ones replaced (a change gives a new id), and anything
// Adelita scheduled that is no longer in the plan is removed. Completed workouts are left alone.
import ExpoModulesCore
import Foundation
import HealthKit
#if canImport(WorkoutKit)
import WorkoutKit
#endif

public class AdelitaWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AdelitaWatch")

    // Whether this iPhone can send scheduled workouts to an Apple Watch at all.
    Function("isSupported") { () -> Bool in
      #if canImport(WorkoutKit)
      if #available(iOS 17.0, *) { return WorkoutScheduler.isSupported }
      #endif
      return false
    }

    // json: { "workouts": [{ "id": UUID, "date": "YYYY-MM-DD", "workout": {...} }] }
    // Resolves { scheduled, removed, kept, skipped, denied, max }.
    AsyncFunction("schedule") { (json: String, promise: Promise) in
      #if canImport(WorkoutKit)
      if #available(iOS 17.0, *) {
        Task {
          do {
            let result = try await AdelitaWatchScheduler.sync(json: json)
            promise.resolve(result)
          } catch let error as AdelitaWatchError {
            promise.reject(error.code, error.message)
          } catch {
            promise.reject("watch_failed", error.localizedDescription)
          }
        }
        return
      }
      #endif
      promise.reject("watch_unsupported", "Scheduled workouts need iOS 17 or later")
    }
  }
}

struct AdelitaWatchError: Error {
  let code: String
  let message: String
}

#if canImport(WorkoutKit)
@available(iOS 17.0, *)
enum AdelitaWatchScheduler {
  static func sync(json: String) async throws -> [String: Any] {
    guard WorkoutScheduler.isSupported else {
      throw AdelitaWatchError(code: "watch_unsupported", message: "This device can't schedule workouts")
    }
    guard let data = json.data(using: .utf8),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let items = root["workouts"] as? [[String: Any]] else {
      throw AdelitaWatchError(code: "bad_request", message: "Couldn't read the workouts")
    }

    let scheduler = WorkoutScheduler.shared
    var state = await scheduler.authorizationState
    if state == .notDetermined { state = await scheduler.requestAuthorization() }
    guard state == .authorized else {
      return ["denied": true, "scheduled": 0, "removed": 0, "kept": 0, "skipped": 0]
    }

    // What the plan wants on the watch, soonest first, up to Apple's limit.
    var wanted: [(id: UUID, date: DateComponents, plan: WorkoutPlan)] = []
    var skipped = 0
    for item in items {
      guard let idText = item["id"] as? String, let id = UUID(uuidString: idText),
            let dateText = item["date"] as? String, let date = dayComponents(dateText),
            let spec = item["workout"] as? [String: Any],
            let workout = customWorkout(spec) else { skipped += 1; continue }
      wanted.append((id, date, WorkoutPlan(.custom(workout), id: id)))
    }
    var seen = Set<String>()
    wanted = wanted.filter { seen.insert(key($0.id, $0.date)).inserted }
    wanted.sort { (Calendar.current.date(from: $0.date) ?? .distantFuture) < (Calendar.current.date(from: $1.date) ?? .distantFuture) }
    let limit = WorkoutScheduler.maxAllowedScheduledWorkoutCount
    if wanted.count > limit { skipped += wanted.count - limit; wanted = Array(wanted.prefix(limit)) }

    let existing = await scheduler.scheduledWorkouts
    let wantedKeys = Set(wanted.map { key($0.id, $0.date) })
    var removed = 0
    for item in existing where !item.complete && !wantedKeys.contains(key(item.plan.id, item.date)) {
      await scheduler.remove(item.plan, at: item.date)
      removed += 1
    }
    let haveKeys = Set(existing.filter { wantedKeys.contains(key($0.plan.id, $0.date)) }.map { key($0.plan.id, $0.date) })
    var scheduled = 0
    for item in wanted where !haveKeys.contains(key(item.id, item.date)) {
      await scheduler.schedule(item.plan, at: item.date)
      scheduled += 1
    }
    return ["denied": false, "scheduled": scheduled, "removed": removed, "kept": haveKeys.count, "skipped": skipped, "max": limit]
  }

  private static func key(_ id: UUID, _ date: DateComponents) -> String {
    "\(id.uuidString)|\(date.year ?? 0)-\(date.month ?? 0)-\(date.day ?? 0)"
  }

  // The session's day, early in the morning, so it shows as that day's workout.
  // Today's session goes a minute from now instead, so it isn't scheduled in the past.
  private static func dayComponents(_ text: String) -> DateComponents? {
    let parts = text.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    let cal = Calendar.current
    let now = Date()
    let today = cal.dateComponents([.year, .month, .day], from: now)
    if today.year == parts[0] && today.month == parts[1] && today.day == parts[2] {
      let soon = cal.dateComponents([.hour, .minute], from: now.addingTimeInterval(60))
      if (soon.hour ?? 0) >= 6 {
        return DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: soon.hour, minute: soon.minute)
      }
    }
    return DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 6, minute: 0)
  }

  // { name, warmup?, blocks: [{ iterations, steps: [{ purpose, goal, pace? }] }], cooldown? }
  private static func customWorkout(_ spec: [String: Any]) -> CustomWorkout? {
    guard let blockSpecs = spec["blocks"] as? [[String: Any]], !blockSpecs.isEmpty else { return nil }
    var blocks: [IntervalBlock] = []
    for b in blockSpecs {
      let iterations = max(1, (b["iterations"] as? NSNumber)?.intValue ?? 1)
      let steps: [IntervalStep] = ((b["steps"] as? [[String: Any]]) ?? []).map { s in
        let purpose: IntervalStep.Purpose = (s["purpose"] as? String) == "recovery" ? .recovery : .work
        return IntervalStep(purpose, step: step(s))
      }
      if !steps.isEmpty { blocks.append(IntervalBlock(steps: steps, iterations: iterations)) }
    }
    guard !blocks.isEmpty else { return nil }
    let warmup = (spec["warmup"] as? [String: Any]).map(step)
    let cooldown = (spec["cooldown"] as? [String: Any]).map(step)
    let name = (spec["name"] as? String).map { String($0.prefix(60)) }
    return CustomWorkout(activity: .running, location: .outdoor, displayName: name,
                         warmup: warmup, blocks: blocks, cooldown: cooldown)
  }

  private static func step(_ s: [String: Any]) -> WorkoutStep {
    WorkoutStep(goal: goal(s["goal"] as? [String: Any]), alert: paceAlert(s["pace"] as? [String: Any]))
  }

  private static func goal(_ g: [String: Any]?) -> WorkoutGoal {
    guard let g = g, let type = g["type"] as? String, let value = (g["value"] as? NSNumber)?.doubleValue, value > 0 else { return .open }
    let result: WorkoutGoal
    switch type {
    case "distance": result = .distance(value, .meters)
    case "time": result = .time(value, .seconds)
    default: return .open
    }
    // An unsupported goal can crash WorkoutKit rather than throw, so check first.
    return CustomWorkout.supportsGoal(result, activity: .running, location: .outdoor) ? result : .open
  }

  // Pace range in seconds per km -> a speed range alert. The slower pace is the lower speed.
  private static func paceAlert(_ p: [String: Any]?) -> SpeedRangeAlert? {
    guard let p = p,
          let fast = (p["fast"] as? NSNumber)?.doubleValue, let slow = (p["slow"] as? NSNumber)?.doubleValue,
          fast > 0, slow > 0 else { return nil }
    let low = 1000.0 / max(fast, slow), high = 1000.0 / min(fast, slow)
    guard high > low else { return nil }
    let alert: SpeedRangeAlert = .speed(low...high, unit: .metersPerSecond, metric: .current)
    return CustomWorkout.supportsAlert(alert, activity: .running, location: .outdoor) ? alert : nil
  }
}
#endif
