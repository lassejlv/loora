use crate::hit::Vec2;

/// Pan/zoom camera for screen ↔ world mapping.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub pan: Vec2,
    pub zoom: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            pan: Vec2::new(0.0, 0.0),
            zoom: 1.0,
        }
    }
}

impl Camera {
    pub fn new(pan: Vec2, zoom: f64) -> Self {
        Self {
            pan,
            zoom: zoom.clamp(Self::MIN_ZOOM, Self::MAX_ZOOM),
        }
    }

    pub const MIN_ZOOM: f64 = 0.08;
    pub const MAX_ZOOM: f64 = 8.0;

    pub fn screen_to_world(&self, screen: Vec2) -> Vec2 {
        Vec2::new(
            (screen.x - self.pan.x) / self.zoom,
            (screen.y - self.pan.y) / self.zoom,
        )
    }

    pub fn world_to_screen(&self, world: Vec2) -> Vec2 {
        Vec2::new(
            world.x * self.zoom + self.pan.x,
            world.y * self.zoom + self.pan.y,
        )
    }

    /// Zoom around a screen-space anchor point.
    pub fn zoom_at(&mut self, screen_anchor: Vec2, factor: f64) {
        if !factor.is_finite() || factor <= 0.0 {
            return;
        }
        let before = self.screen_to_world(screen_anchor);
        self.zoom = (self.zoom * factor).clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);
        let after = self.world_to_screen(before);
        self.pan.x += screen_anchor.x - after.x;
        self.pan.y += screen_anchor.y - after.y;
    }

    /// Set absolute zoom while keeping `screen_anchor` fixed in world space.
    pub fn set_zoom_at(&mut self, screen_anchor: Vec2, zoom: f64) {
        if !zoom.is_finite() || zoom <= 0.0 {
            return;
        }
        let before = self.screen_to_world(screen_anchor);
        self.zoom = zoom.clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);
        let after = self.world_to_screen(before);
        self.pan.x += screen_anchor.x - after.x;
        self.pan.y += screen_anchor.y - after.y;
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.pan.x += dx;
        self.pan.y += dy;
    }

    /// Fit `world` into a viewport of `screen_w` × `screen_h` with padding.
    pub fn fit_bounds(
        &mut self,
        screen_w: f64,
        screen_h: f64,
        world: crate::hit::Bounds,
        padding: f64,
    ) {
        let pad = padding.max(0.0);
        let avail_w = (screen_w - pad * 2.0).max(1.0);
        let avail_h = (screen_h - pad * 2.0).max(1.0);
        let bw = world.width.max(1.0);
        let bh = world.height.max(1.0);
        let zoom = (avail_w / bw).min(avail_h / bh).clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);
        self.zoom = zoom;
        let screen_cx = screen_w * 0.5;
        let screen_cy = screen_h * 0.5;
        let world_cx = world.x + world.width * 0.5;
        let world_cy = world.y + world.height * 0.5;
        self.pan.x = screen_cx - world_cx * zoom;
        self.pan.y = screen_cy - world_cy * zoom;
    }
}
