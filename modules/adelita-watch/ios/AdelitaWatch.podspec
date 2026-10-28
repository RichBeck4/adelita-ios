Pod::Spec.new do |s|
  s.name           = 'AdelitaWatch'
  s.version        = '1.0.0'
  s.summary        = 'Puts Adelita sessions in the Workout app on Apple Watch'
  s.description    = 'Schedules Adelita training sessions as WorkoutKit custom workouts'
  s.author         = 'JMM Web Apps'
  s.homepage       = 'https://adelitarun.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # WorkoutKit only exists on iOS 17+, so it is weak-linked and every use is behind an availability check.
  s.weak_frameworks = 'WorkoutKit'
  s.frameworks = 'HealthKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
