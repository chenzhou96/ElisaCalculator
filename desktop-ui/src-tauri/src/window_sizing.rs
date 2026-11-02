//! Pure startup geometry. Monitor coordinates and returned sizes are physical pixels;
//! only the preferred workspace and its normal minimum are expressed in logical pixels.
//! Keep this independent of Tauri so taskbar, DPI and multi-monitor cases are unit-testable.

const PREFERRED_WIDTH: f64 = 1360.0;
const PREFERRED_HEIGHT: f64 = 900.0;
const MINIMUM_WIDTH: f64 = 800.0;
const MINIMUM_HEIGHT: f64 = 420.0;
const EDGE_GAP: u32 = 8;

#[derive(Debug, Clone, Copy)]
pub struct WorkArea {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

/// Total native frame size outside the client area, including any invisible resize border.
#[derive(Debug, Clone, Copy, Default)]
pub struct FrameSize {
  pub width: u32,
  pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupGeometry {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
  pub min_width: u32,
  pub min_height: u32,
}

fn logical_to_physical(logical: f64, scale: f64, available: u32) -> u32 {
  // Clamp before casting, and round down so fractional DPI cannot add a pixel beyond the work area.
  (logical * scale).floor().min(f64::from(available)).max(1.0) as u32
}

pub fn startup_geometry(
  area: WorkArea,
  scale_factor: f64,
  frame: FrameSize,
) -> Option<StartupGeometry> {
  if area.width == 0 || area.height == 0 {
    return None;
  }
  // Bad platform DPI metadata must not reach a conversion that can panic or produce NaN.
  // The resulting physical window still fits the work area when the fallback scale is used.
  let scale = if scale_factor.is_finite() && scale_factor > 0.0 { scale_factor } else { 1.0 };
  let horizontal_gap = EDGE_GAP.min(area.width.saturating_sub(frame.width).saturating_sub(1) / 2);
  let vertical_gap = EDGE_GAP.min(area.height.saturating_sub(frame.height).saturating_sub(1) / 2);
  let available_width = area.width.checked_sub(frame.width + horizontal_gap * 2)?;
  let available_height = area.height.checked_sub(frame.height + vertical_gap * 2)?;
  if available_width == 0 || available_height == 0 {
    return None;
  }

  let width = logical_to_physical(PREFERRED_WIDTH, scale, available_width);
  let height = logical_to_physical(PREFERRED_HEIGHT, scale, available_height);
  let min_width = logical_to_physical(MINIMUM_WIDTH, scale, width);
  let min_height = logical_to_physical(MINIMUM_HEIGHT, scale, height);
  // Never treat a secondary monitor's negative origin as a logical position or assume (0, 0).
  let x = i64::from(area.x) + i64::from((area.width - width - frame.width) / 2);
  let y = i64::from(area.y) + i64::from((area.height - height - frame.height) / 2);
  Some(StartupGeometry {
    x: i32::try_from(x).ok()?,
    y: i32::try_from(y).ok()?,
    width,
    height,
    min_width,
    min_height,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn area(width: u32, height: u32) -> WorkArea {
    WorkArea { x: 0, y: 0, width, height }
  }

  fn assert_fits(area: WorkArea, frame: FrameSize, geometry: StartupGeometry) {
    assert!(geometry.width > 0 && geometry.height > 0);
    assert!(geometry.min_width > 0 && geometry.min_width <= geometry.width);
    assert!(geometry.min_height > 0 && geometry.min_height <= geometry.height);
    assert!(geometry.x >= area.x && geometry.y >= area.y);
    assert!(i64::from(geometry.x) + i64::from(geometry.width) + i64::from(frame.width)
      <= i64::from(area.x) + i64::from(area.width));
    assert!(i64::from(geometry.y) + i64::from(geometry.height) + i64::from(frame.height)
      <= i64::from(area.y) + i64::from(area.height));
  }

  #[test]
  fn roomy_100_percent_keeps_the_preferred_workspace() {
    let work = area(1920, 1040);
    let geometry = startup_geometry(work, 1.0, FrameSize::default()).unwrap();
    assert_eq!(geometry, StartupGeometry {
      x: 280, y: 70, width: 1360, height: 900, min_width: 800, min_height: 420,
    });
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn laptop_100_percent_uses_the_taskbar_excluded_work_area() {
    let work = area(1366, 720);
    let geometry = startup_geometry(work, 1.0, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1350, 704));
    assert_eq!((geometry.x, geometry.y), (8, 8));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn laptop_150_percent_fits_with_a_shorter_logical_minimum() {
    let work = area(1366, 720);
    let geometry = startup_geometry(work, 1.5, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1350, 704));
    assert_eq!((geometry.min_width, geometry.min_height), (1200, 630));
    assert_eq!(f64::from(geometry.width) / 1.5, 900.0);
    assert!(f64::from(geometry.height) / 1.5 < 480.0);
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn laptop_200_percent_lowers_the_minimum_to_the_available_space() {
    let work = area(1366, 720);
    let geometry = startup_geometry(work, 2.0, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1350, 704));
    assert_eq!((geometry.min_width, geometry.min_height), (1350, 704));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn roomy_200_percent_preserves_the_preferred_logical_size() {
    let work = area(3840, 2080);
    let geometry = startup_geometry(work, 2.0, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (2720, 1800));
    assert_eq!((geometry.min_width, geometry.min_height), (1600, 840));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn small_work_area_can_override_both_normal_minima() {
    let work = area(640, 360);
    let geometry = startup_geometry(work, 1.5, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (624, 344));
    assert_eq!((geometry.min_width, geometry.min_height), (624, 344));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn frame_is_reserved_before_sizing_and_centering() {
    let work = area(1366, 720);
    let frame = FrameSize { width: 16, height: 16 };
    let geometry = startup_geometry(work, 1.5, frame).unwrap();
    assert_eq!((geometry.width, geometry.height), (1334, 688));
    assert_eq!((geometry.x, geometry.y), (8, 8));
    assert_fits(work, frame, geometry);
  }

  #[test]
  fn secondary_monitor_and_top_taskbar_offsets_are_physical() {
    let work = WorkArea { x: -1366, y: 48, width: 1366, height: 720 };
    let geometry = startup_geometry(work, 1.5, FrameSize::default()).unwrap();
    assert_eq!((geometry.x, geometry.y), (-1358, 56));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn side_taskbar_and_negative_vertical_monitor_origin_are_preserved() {
    let work = WorkArea { x: 1968, y: -768, width: 1318, height: 768 };
    let geometry = startup_geometry(work, 1.5, FrameSize::default()).unwrap();
    assert_eq!((geometry.x, geometry.y), (1976, -760));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn invalid_scale_falls_back_without_leaving_the_work_area() {
    let work = area(1366, 720);
    let expected = startup_geometry(work, 1.0, FrameSize::default()).unwrap();
    for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
      let geometry = startup_geometry(work, scale, FrameSize::default()).unwrap();
      assert_eq!(geometry, expected);
      assert_fits(work, FrameSize::default(), geometry);
    }
  }

  #[test]
  fn fractional_scale_is_clamped_to_the_work_area() {
    let work = area(1699, 1117);
    let geometry = startup_geometry(work, 1.25, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1683, 1101));
    assert_eq!((geometry.min_width, geometry.min_height), (1000, 525));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn fractional_physical_sizes_round_down_without_losing_the_fit() {
    let work = area(1920, 1300);
    let geometry = startup_geometry(work, 1.333, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1812, 1199));
    assert_eq!((geometry.min_width, geometry.min_height), (1066, 559));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn extreme_finite_scales_remain_bounded_and_nonzero() {
    let work = area(1366, 720);
    for scale in [f64::MAX, f64::MIN_POSITIVE] {
      let geometry = startup_geometry(work, scale, FrameSize::default()).unwrap();
      assert_fits(work, FrameSize::default(), geometry);
    }
  }

  #[test]
  fn tiny_work_area_shrinks_the_gap_instead_of_underflowing() {
    let work = area(3, 1);
    let geometry = startup_geometry(work, 1.5, FrameSize::default()).unwrap();
    assert_eq!((geometry.width, geometry.height), (1, 1));
    assert_fits(work, FrameSize::default(), geometry);
  }

  #[test]
  fn zero_or_unusable_work_areas_do_not_produce_geometry() {
    assert!(startup_geometry(area(0, 720), 1.5, FrameSize::default()).is_none());
    assert!(startup_geometry(area(1366, 0), 1.5, FrameSize::default()).is_none());
    assert!(startup_geometry(area(12, 12), 1.5, FrameSize { width: 12, height: 12 }).is_none());
    assert!(startup_geometry(area(12, 12), 1.5, FrameSize { width: u32::MAX, height: u32::MAX }).is_none());
  }

  #[test]
  fn unrepresentable_monitor_coordinates_are_rejected_without_overflow() {
    let work = WorkArea { x: i32::MAX, y: 0, width: 1920, height: 1040 };
    assert!(startup_geometry(work, 1.0, FrameSize::default()).is_none());
  }
}
