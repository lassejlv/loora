use std::collections::HashMap;
use std::time::{Duration, Instant};

use loora_engine::{
    AnimationTrigger, Color, Corners, Document, DocumentAnimation, MotionTransform, Node, NodeId,
    Paint, Stroke, Transition, VisualState,
};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MotionFrame {
    pub opacity: f32,
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotate: f32,
    pub fill: Option<Color>,
    pub corners: Corners,
    pub stroke: Option<Stroke>,
}

impl MotionFrame {
    fn from_node(node: &Node) -> Self {
        Self {
            opacity: node.style.opacity,
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotate: 0.0,
            fill: node.style.solid_fill(),
            corners: node.style.corners,
            stroke: node.style.stroke.clone(),
        }
    }

    fn apply_visual_state(&mut self, state: &VisualState) {
        if let Some(opacity) = state.opacity {
            self.opacity = opacity;
        }
        if let Some(fill) = state.fill {
            self.fill = Some(fill);
        }
        if let Some(scale) = state.scale {
            self.scale_x *= scale;
            self.scale_y *= scale;
        }
        if let Some(transform) = state.transform {
            self.apply_transform(transform);
        }
        if let Some(style) = &state.style {
            if let Some(opacity) = style.opacity {
                self.opacity = opacity;
            }
            if let Some(fills) = &style.fills {
                self.fill = fills.first().and_then(Paint::solid_color);
            }
            if let Some(stroke) = &style.stroke {
                self.stroke = stroke.clone();
            }
            if let Some(corners) = style.corners {
                self.corners = corners;
            }
        }
    }

    fn apply_transform(&mut self, transform: MotionTransform) {
        self.x += transform.x.unwrap_or(0.0);
        self.y += transform.y.unwrap_or(0.0);
        let uniform = transform.scale.unwrap_or(1.0);
        self.scale_x *= uniform * transform.scale_x.unwrap_or(1.0);
        self.scale_y *= uniform * transform.scale_y.unwrap_or(1.0);
        self.rotate += transform.rotate.unwrap_or(0.0);
    }

    fn lerp(&self, target: &Self, progress: f32, properties: &[String]) -> Self {
        let all = properties.is_empty() || properties.iter().any(|value| value == "all");
        let allows = |names: &[&str]| {
            all || properties
                .iter()
                .any(|value| names.iter().any(|name| value == name))
        };
        let mut frame = target.clone();
        if allows(&["opacity"]) {
            frame.opacity = lerp(self.opacity, target.opacity, progress);
        }
        if allows(&["transform"]) {
            frame.x = lerp(self.x, target.x, progress);
            frame.y = lerp(self.y, target.y, progress);
            frame.scale_x = lerp(self.scale_x, target.scale_x, progress);
            frame.scale_y = lerp(self.scale_y, target.scale_y, progress);
            frame.rotate = lerp(self.rotate, target.rotate, progress);
        }
        if allows(&["background", "background-color", "color", "fill"]) {
            frame.fill = lerp_optional_color(self.fill, target.fill, progress);
        }
        if allows(&["border-radius"]) {
            frame.corners = lerp_corners(self.corners, target.corners, progress);
        }
        if allows(&["border", "border-color", "border-width"]) {
            frame.stroke = lerp_stroke(self.stroke.as_ref(), target.stroke.as_ref(), progress);
        }
        frame
    }

    fn lerp_keyframe(&self, target: &Self, progress: f32) -> Self {
        let mut frame = target.clone();
        frame.opacity = lerp(self.opacity, target.opacity, progress);
        frame.x = lerp(self.x, target.x, progress);
        frame.y = lerp(self.y, target.y, progress);
        frame.scale_x = lerp(self.scale_x, target.scale_x, progress);
        frame.scale_y = lerp(self.scale_y, target.scale_y, progress);
        frame.rotate = lerp(self.rotate, target.rotate, progress);
        frame
    }
}

#[derive(Clone, Debug)]
struct TransitionTrack {
    from: MotionFrame,
    target: MotionFrame,
    started: Instant,
    transition: Transition,
}

impl TransitionTrack {
    fn settled(frame: MotionFrame, now: Instant) -> Self {
        Self {
            from: frame.clone(),
            target: frame,
            started: now,
            transition: Transition {
                duration_ms: 0.0,
                ..Transition::default()
            },
        }
    }

    fn sample(&self, now: Instant) -> (MotionFrame, bool) {
        let elapsed_ms = now.saturating_duration_since(self.started).as_secs_f32() * 1000.0;
        let delay = self.transition.delay_ms.max(0.0);
        let duration = self.transition.duration_ms.max(0.0);
        if elapsed_ms < delay {
            return (self.from.clone(), true);
        }
        if duration <= f32::EPSILON {
            return (self.target.clone(), false);
        }
        let raw = ((elapsed_ms - delay) / duration).clamp(0.0, 1.0);
        let eased = ease(&self.transition.easing, self.transition.cubic_bezier, raw);
        (
            self.from
                .lerp(&self.target, eased, &self.transition.properties),
            raw < 1.0,
        )
    }
}

pub(crate) struct MotionRuntime {
    revision: u64,
    preview: bool,
    preview_started: Instant,
    tracks: HashMap<NodeId, TransitionTrack>,
    animation_starts: HashMap<(NodeId, String), Instant>,
    frames: HashMap<NodeId, MotionFrame>,
}

impl Default for MotionRuntime {
    fn default() -> Self {
        Self {
            revision: 0,
            preview: false,
            preview_started: Instant::now(),
            tracks: HashMap::new(),
            animation_starts: HashMap::new(),
            frames: HashMap::new(),
        }
    }
}

impl MotionRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn tick(
        &mut self,
        document: &Document,
        revision: u64,
        preview: bool,
        hovered: Option<&NodeId>,
        pressed: Option<&NodeId>,
        focused: Option<&NodeId>,
        now: Instant,
        reduce_motion: bool,
    ) -> bool {
        if self.revision != revision || self.preview != preview {
            self.revision = revision;
            self.preview = preview;
            self.preview_started = now;
            self.tracks.clear();
            self.animation_starts.clear();
            self.frames.clear();
        }

        let mut animating = false;
        self.frames.retain(|id, _| document.nodes.contains_key(id));
        self.tracks.retain(|id, _| document.nodes.contains_key(id));

        for (id, node) in &document.nodes {
            let base = MotionFrame::from_node(node);
            if !preview {
                self.frames.insert(id.clone(), base);
                continue;
            }

            let mut target = base.clone();
            if let Some(states) = &node.visual_states {
                if hovered == Some(id) {
                    if let Some(state) = &states.hover {
                        target.apply_visual_state(state);
                    }
                }
                if pressed == Some(id) {
                    if let Some(state) = &states.press {
                        target.apply_visual_state(state);
                    }
                }
                if focused == Some(id) {
                    if let Some(state) = &states.focus {
                        target.apply_visual_state(state);
                    }
                }
            }

            let transition_frame = if reduce_motion || node.transition.is_none() {
                self.tracks
                    .insert(id.clone(), TransitionTrack::settled(target.clone(), now));
                target
            } else {
                let transition = node.transition.clone().unwrap_or_default();
                let track = self
                    .tracks
                    .entry(id.clone())
                    .or_insert_with(|| TransitionTrack::settled(base.clone(), now));
                if track.target != target {
                    let current = track.sample(now).0;
                    *track = TransitionTrack {
                        from: current,
                        target,
                        started: now,
                        transition,
                    };
                }
                let (frame, active) = track.sample(now);
                animating |= active;
                frame
            };

            let mut frame = transition_frame;
            if !reduce_motion {
                for attachment in &node.animations {
                    let enabled = match attachment.trigger {
                        AnimationTrigger::Load
                        | AnimationTrigger::InView
                        | AnimationTrigger::Always => true,
                        AnimationTrigger::Hover => hovered == Some(id),
                        AnimationTrigger::Press => pressed == Some(id),
                    };
                    let key = (id.clone(), attachment.animation_id.clone());
                    if !enabled {
                        self.animation_starts.remove(&key);
                        continue;
                    }
                    let Some(animation) = document
                        .animations
                        .iter()
                        .find(|animation| animation.id == attachment.animation_id)
                    else {
                        continue;
                    };
                    let start = match attachment.trigger {
                        AnimationTrigger::Load
                        | AnimationTrigger::InView
                        | AnimationTrigger::Always => self.preview_started,
                        AnimationTrigger::Hover | AnimationTrigger::Press => {
                            *self.animation_starts.entry(key).or_insert(now)
                        }
                    };
                    let elapsed = now.saturating_duration_since(start);
                    let (sample, active) =
                        sample_animation(animation, attachment.delay_ms, elapsed, &frame);
                    animating |= active;
                    if let Some(sample) = sample {
                        frame = sample;
                    }
                }
            }
            self.frames.insert(id.clone(), frame);
        }
        animating
    }

    pub fn frames(&self) -> &HashMap<NodeId, MotionFrame> {
        &self.frames
    }
}

fn sample_animation(
    animation: &DocumentAnimation,
    attachment_delay_ms: f32,
    elapsed: Duration,
    base: &MotionFrame,
) -> (Option<MotionFrame>, bool) {
    if animation.keyframes.is_empty() {
        return (None, false);
    }
    let elapsed_ms = elapsed.as_secs_f32() * 1000.0;
    let delay = (animation.delay_ms + attachment_delay_ms).max(0.0);
    let duration = animation.duration_ms.max(0.0);
    let fill_backwards = matches!(animation.fill.as_str(), "backwards" | "both");
    let fill_forwards = matches!(animation.fill.as_str(), "forwards" | "both");
    if elapsed_ms < delay {
        return (
            fill_backwards.then(|| sample_keyframes(animation, 0.0, base)),
            true,
        );
    }
    if duration <= f32::EPSILON {
        return (
            fill_forwards.then(|| sample_keyframes(animation, 1.0, base)),
            false,
        );
    }

    let iterations = animation.iterations.max(1.0);
    let local = (elapsed_ms - delay).max(0.0) / duration;
    let finished = !animation.infinite && local >= iterations;
    if finished {
        let progress = directed_progress(animation, iterations.ceil() as u32 - 1, 1.0);
        return (
            fill_forwards.then(|| sample_keyframes(animation, progress, base)),
            false,
        );
    }

    let cycle = local.floor() as u32;
    let raw = local.fract();
    let progress = directed_progress(animation, cycle, raw);
    let eased = ease(&animation.easing, animation.cubic_bezier, progress);
    (Some(sample_keyframes(animation, eased, base)), true)
}

fn directed_progress(animation: &DocumentAnimation, cycle: u32, progress: f32) -> f32 {
    let reverse = match animation.direction.as_str() {
        "reverse" => true,
        "alternate" => !cycle.is_multiple_of(2),
        "alternate-reverse" | "alternate_reverse" => cycle.is_multiple_of(2),
        _ => false,
    };
    if reverse {
        1.0 - progress
    } else {
        progress
    }
}

fn sample_keyframes(
    animation: &DocumentAnimation,
    progress: f32,
    base: &MotionFrame,
) -> MotionFrame {
    let progress = progress.clamp(0.0, 1.0);
    let mut frames = animation.keyframes.iter().collect::<Vec<_>>();
    frames.sort_by(|left, right| left.offset.total_cmp(&right.offset));
    let left = frames
        .iter()
        .rev()
        .find(|frame| frame.offset <= progress)
        .copied();
    let right = frames
        .iter()
        .find(|frame| frame.offset >= progress)
        .copied();

    let left_offset = left.map_or(0.0, |frame| frame.offset.clamp(0.0, 1.0));
    let right_offset = right.map_or(1.0, |frame| frame.offset.clamp(0.0, 1.0));
    let span = (right_offset - left_offset).max(f32::EPSILON);
    let local = ((progress - left_offset) / span).clamp(0.0, 1.0);
    let from = keyframe_frame(left, base);
    let to = keyframe_frame(right, base);
    from.lerp_keyframe(&to, local)
}

fn keyframe_frame(
    keyframe: Option<&loora_engine::AnimationKeyframe>,
    base: &MotionFrame,
) -> MotionFrame {
    let Some(keyframe) = keyframe else {
        return base.clone();
    };
    let mut frame = base.clone();
    if let Some(opacity) = keyframe.opacity {
        frame.opacity = opacity;
    }
    if let Some(transform) = keyframe.transform {
        frame.x = 0.0;
        frame.y = 0.0;
        frame.scale_x = 1.0;
        frame.scale_y = 1.0;
        frame.rotate = 0.0;
        frame.apply_transform(transform);
    }
    frame
}

fn ease(name: &str, cubic: Option<[f32; 4]>, progress: f32) -> f32 {
    let points = cubic.or(match name {
        "ease" => Some([0.25, 0.1, 0.25, 1.0]),
        "ease-in" | "ease_in" => Some([0.42, 0.0, 1.0, 1.0]),
        "ease-out" | "ease_out" => Some([0.0, 0.0, 0.58, 1.0]),
        "ease-in-out" | "ease_in_out" => Some([0.42, 0.0, 0.58, 1.0]),
        _ => None,
    });
    points.map_or(progress.clamp(0.0, 1.0), |points| {
        cubic_bezier(points, progress)
    })
}

fn cubic_bezier(points: [f32; 4], x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    let [x1, y1, x2, y2] = points;
    let bezier = |t: f32, first: f32, second: f32| {
        let inverse = 1.0 - t;
        3.0 * inverse * inverse * t * first + 3.0 * inverse * t * t * second + t * t * t
    };
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..16 {
        let middle = (low + high) * 0.5;
        if bezier(middle, x1, x2) < x {
            low = middle;
        } else {
            high = middle;
        }
    }
    bezier((low + high) * 0.5, y1, y2).clamp(0.0, 1.0)
}

fn lerp(from: f32, to: f32, progress: f32) -> f32 {
    from + (to - from) * progress.clamp(0.0, 1.0)
}

fn lerp_color(from: Color, to: Color, progress: f32) -> Color {
    Color::rgba(
        lerp(from.r, to.r, progress),
        lerp(from.g, to.g, progress),
        lerp(from.b, to.b, progress),
        lerp(from.a, to.a, progress),
    )
}

fn lerp_optional_color(from: Option<Color>, to: Option<Color>, progress: f32) -> Option<Color> {
    match (from, to) {
        (Some(from), Some(to)) => Some(lerp_color(from, to, progress)),
        (None, Some(to)) => Some(lerp_color(Color { a: 0.0, ..to }, to, progress)),
        (Some(from), None) if progress < 1.0 => {
            Some(lerp_color(from, Color { a: 0.0, ..from }, progress))
        }
        _ => None,
    }
}

fn lerp_corners(from: Corners, to: Corners, progress: f32) -> Corners {
    Corners {
        tl: lerp(from.tl, to.tl, progress),
        tr: lerp(from.tr, to.tr, progress),
        br: lerp(from.br, to.br, progress),
        bl: lerp(from.bl, to.bl, progress),
    }
}

fn lerp_stroke(from: Option<&Stroke>, to: Option<&Stroke>, progress: f32) -> Option<Stroke> {
    match (from, to) {
        (Some(from), Some(to)) => Some(Stroke {
            color: lerp_color(from.color, to.color, progress),
            token_id: to.token_id.clone(),
            width: lerp(from.width, to.width, progress),
            style: to.style,
        }),
        (None, Some(to)) => Some(Stroke {
            color: lerp_color(Color { a: 0.0, ..to.color }, to.color, progress),
            token_id: to.token_id.clone(),
            width: lerp(0.0, to.width, progress),
            style: to.style,
        }),
        (Some(from), None) if progress < 1.0 => Some(Stroke {
            color: lerp_color(
                from.color,
                Color {
                    a: 0.0,
                    ..from.color
                },
                progress,
            ),
            token_id: from.token_id.clone(),
            width: lerp(from.width, 0.0, progress),
            style: from.style,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loora_engine::{AnimationKeyframe, Layout, Node};

    #[test]
    fn transition_uses_real_cubic_bezier_progress_and_can_reverse_smoothly() {
        let now = Instant::now();
        let mut target = MotionFrame::from_node(&Node::root_frame("Frame"));
        target.opacity = 0.0;
        let mut track = TransitionTrack {
            from: MotionFrame::from_node(&Node::root_frame("Frame")),
            target: target.clone(),
            started: now,
            transition: Transition {
                duration_ms: 200.0,
                easing: "ease-out".into(),
                ..Transition::default()
            },
        };
        let halfway = now + Duration::from_millis(100);
        let current = track.sample(halfway).0;
        assert!(current.opacity < 0.5, "ease-out should be ahead at halfway");
        track = TransitionTrack {
            from: current.clone(),
            target: MotionFrame::from_node(&Node::root_frame("Frame")),
            started: halfway,
            transition: track.transition,
        };
        assert_eq!(track.sample(halfway).0, current);
    }

    #[test]
    fn keyframes_interpolate_transform_and_opacity() {
        let animation = DocumentAnimation {
            id: "fade-up".into(),
            name: "Fade up".into(),
            duration_ms: 1000.0,
            easing: "linear".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                AnimationKeyframe {
                    offset: 0.0,
                    opacity: Some(0.0),
                    transform: Some(MotionTransform {
                        y: Some(20.0),
                        ..MotionTransform::default()
                    }),
                },
                AnimationKeyframe {
                    offset: 1.0,
                    opacity: Some(1.0),
                    transform: Some(MotionTransform::default()),
                },
            ],
            iterations: 1.0,
            infinite: false,
            direction: "normal".into(),
            fill: "both".into(),
        };
        let base = MotionFrame::from_node(&Node::frame(
            "Frame",
            NodeId::from("page"),
            Layout::new(0.0, 0.0, 100.0, 100.0),
        ));
        let (sample, active) = sample_animation(&animation, 0.0, Duration::from_millis(500), &base);
        let sample = sample.unwrap();
        assert!(active);
        assert!((sample.opacity - 0.5).abs() < 0.001);
        assert!((sample.y - 10.0).abs() < 0.001);
    }
}
