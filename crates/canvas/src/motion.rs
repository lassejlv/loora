use std::collections::{HashMap, HashSet};
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
    animation_starts: HashMap<(NodeId, usize), Instant>,
    completed_once: HashSet<(NodeId, usize)>,
    frames: HashMap<NodeId, MotionFrame>,
    playback_elapsed: Duration,
    playback_last_wall: Instant,
    playback_playing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlaybackSnapshot {
    pub playing: bool,
    pub progress: f32,
    pub elapsed_ms: f32,
    pub duration_ms: f32,
}

impl Default for MotionRuntime {
    fn default() -> Self {
        Self {
            revision: 0,
            preview: false,
            preview_started: Instant::now(),
            tracks: HashMap::new(),
            animation_starts: HashMap::new(),
            completed_once: HashSet::new(),
            frames: HashMap::new(),
            playback_elapsed: Duration::ZERO,
            playback_last_wall: Instant::now(),
            playback_playing: true,
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
        in_view: &HashSet<NodeId>,
        now: Instant,
        reduce_motion: bool,
    ) -> bool {
        if self.revision != revision || self.preview != preview {
            self.revision = revision;
            self.preview = preview;
            self.preview_started = now;
            self.tracks.clear();
            self.animation_starts.clear();
            self.completed_once.clear();
            self.frames.clear();
            self.playback_elapsed = Duration::ZERO;
            self.playback_last_wall = now;
            self.playback_playing = true;
        }

        if !preview {
            self.frames.clear();
            return false;
        }

        if self.playback_playing {
            self.playback_elapsed += now.saturating_duration_since(self.playback_last_wall);
        }
        self.playback_last_wall = now;
        let (timeline_duration, timeline_loops) = timeline_duration(document);
        if self.playback_elapsed >= timeline_duration {
            if timeline_loops {
                let duration = timeline_duration.as_secs_f64();
                let wrapped = self.playback_elapsed.as_secs_f64() % duration.max(f64::EPSILON);
                self.playback_elapsed = Duration::from_secs_f64(wrapped);
                self.tracks.clear();
                self.animation_starts.clear();
                self.completed_once.clear();
            } else {
                self.playback_elapsed = timeline_duration;
                self.playback_playing = false;
            }
        }
        let timeline_now = self.preview_started + self.playback_elapsed;

        let mut animating = false;
        self.frames.retain(|id, _| document.nodes.contains_key(id));
        self.tracks.retain(|id, _| document.nodes.contains_key(id));
        self.animation_starts
            .retain(|(id, _), _| document.nodes.contains_key(id));
        self.completed_once
            .retain(|(id, _)| document.nodes.contains_key(id));

        for (id, node) in &document.nodes {
            if node.visual_states.is_none() && node.animations.is_empty() {
                self.frames.remove(id);
                self.tracks.remove(id);
                continue;
            }
            let base = MotionFrame::from_node(node);

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
                self.tracks.insert(
                    id.clone(),
                    TransitionTrack::settled(target.clone(), timeline_now),
                );
                target
            } else {
                let transition = node.transition.clone().unwrap_or_default();
                let track = self
                    .tracks
                    .entry(id.clone())
                    .or_insert_with(|| TransitionTrack::settled(base.clone(), timeline_now));
                if track.target != target {
                    let current = track.sample(timeline_now).0;
                    *track = TransitionTrack {
                        from: current,
                        target,
                        started: timeline_now,
                        transition,
                    };
                }
                let (frame, active) = track.sample(timeline_now);
                animating |= active;
                frame
            };

            let mut frame = transition_frame;
            if !reduce_motion {
                for (attachment_index, attachment) in node.animations.iter().enumerate() {
                    let enabled = match attachment.trigger {
                        AnimationTrigger::Load | AnimationTrigger::Always => true,
                        AnimationTrigger::InView => in_view.contains(id),
                        AnimationTrigger::Hover => hovered == Some(id),
                        AnimationTrigger::Press => pressed == Some(id),
                    };
                    let key = (id.clone(), attachment_index);
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
                    if attachment.once && self.completed_once.contains(&key) {
                        if matches!(animation.fill.as_str(), "forwards" | "both") {
                            frame = sample_keyframes(animation, 1.0, &frame);
                        }
                        continue;
                    }
                    let start = match attachment.trigger {
                        AnimationTrigger::Load | AnimationTrigger::Always => self.preview_started,
                        AnimationTrigger::InView
                        | AnimationTrigger::Hover
                        | AnimationTrigger::Press => {
                            *self.animation_starts.entry(key).or_insert(timeline_now)
                        }
                    };
                    let elapsed = timeline_now.saturating_duration_since(start);
                    let (sample, active) =
                        sample_animation(animation, attachment.delay_ms, elapsed, &frame);
                    animating |= active;
                    if let Some(sample) = sample {
                        frame = sample;
                    }
                    if attachment.once && !active {
                        self.completed_once.insert((id.clone(), attachment_index));
                    }
                }
            }
            self.frames.insert(id.clone(), frame);
        }
        animating && self.playback_playing
    }

    pub fn frames(&self) -> &HashMap<NodeId, MotionFrame> {
        &self.frames
    }

    pub fn toggle_playback(&mut self, now: Instant) {
        if self.playback_playing {
            self.playback_elapsed += now.saturating_duration_since(self.playback_last_wall);
        }
        self.playback_last_wall = now;
        self.playback_playing = !self.playback_playing;
    }

    pub fn restart(&mut self, now: Instant) {
        self.playback_elapsed = Duration::ZERO;
        self.playback_last_wall = now;
        self.playback_playing = true;
        self.tracks.clear();
        self.animation_starts.clear();
        self.completed_once.clear();
        self.frames.clear();
    }

    pub fn scrub(&mut self, document: &Document, progress: f32, now: Instant) {
        let (duration, _) = timeline_duration(document);
        self.playback_elapsed = duration.mul_f32(progress.clamp(0.0, 1.0));
        self.playback_last_wall = now;
        self.playback_playing = false;
        self.tracks.clear();
        self.animation_starts.clear();
        self.completed_once.clear();
        self.frames.clear();
    }

    pub fn snapshot(&self, document: &Document) -> PlaybackSnapshot {
        let (duration, _) = timeline_duration(document);
        let duration_ms = duration.as_secs_f32() * 1000.0;
        let elapsed_ms = self.playback_elapsed.as_secs_f32() * 1000.0;
        PlaybackSnapshot {
            playing: self.playback_playing,
            progress: (elapsed_ms / duration_ms.max(f32::EPSILON)).clamp(0.0, 1.0),
            elapsed_ms,
            duration_ms,
        }
    }
}

fn timeline_duration(document: &Document) -> (Duration, bool) {
    let mut duration_ms = 0.0_f32;
    let mut loops = false;
    for node in document.nodes.values() {
        if let Some(transition) = &node.transition {
            duration_ms =
                duration_ms.max(transition.delay_ms.max(0.0) + transition.duration_ms.max(0.0));
        }
        for attachment in &node.animations {
            let Some(animation) = document
                .animations
                .iter()
                .find(|animation| animation.id == attachment.animation_id)
            else {
                continue;
            };
            loops |= animation.infinite;
            let iterations = if animation.infinite {
                1.0
            } else {
                animation.iterations.max(1.0)
            };
            duration_ms = duration_ms.max(
                attachment.delay_ms.max(0.0)
                    + animation.delay_ms.max(0.0)
                    + animation.duration_ms.max(0.0) * iterations,
            );
        }
    }
    (
        Duration::from_secs_f32(duration_ms.max(1_000.0) / 1000.0),
        loops,
    )
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
    use loora_engine::{AnimationKeyframe, Layout, Node, NodeAnimation};

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

    #[test]
    fn in_view_animation_waits_until_the_node_is_visible() {
        let mut document = Document::empty("In view");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Card", page, Layout::new(0.0, 0.0, 100.0, 60.0));
        node.animations.push(NodeAnimation {
            animation_id: "fade".into(),
            trigger: AnimationTrigger::InView,
            delay_ms: 0.0,
            once: false,
        });
        let node_id = node.id.clone();
        document.nodes.insert(node_id.clone(), node);
        document.animations.push(DocumentAnimation {
            id: "fade".into(),
            name: "Fade".into(),
            duration_ms: 200.0,
            easing: "linear".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                AnimationKeyframe {
                    offset: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    offset: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            iterations: 1.0,
            infinite: false,
            direction: "normal".into(),
            fill: "both".into(),
        });
        let now = Instant::now();
        let mut runtime = MotionRuntime::default();
        assert!(!runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &HashSet::new(),
            now,
            false,
        ));
        assert_eq!(runtime.frames()[&node_id].opacity, 1.0);

        let visible = HashSet::from([node_id.clone()]);
        assert!(runtime.tick(&document, 1, true, None, None, None, &visible, now, false,));
        assert_eq!(runtime.frames()[&node_id].opacity, 0.0);
    }

    #[test]
    fn static_nodes_do_not_enter_the_per_frame_motion_map() {
        let mut document = Document::empty("Static");
        let page = document.root_page_id.clone();
        let node = Node::rectangle("Card", page, Layout::new(0.0, 0.0, 100.0, 60.0));
        let node_id = node.id.clone();
        document.nodes.insert(node_id.clone(), node);
        let mut runtime = MotionRuntime::default();

        assert!(!runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &HashSet::from([node_id.clone()]),
            Instant::now(),
            false,
        ));
        assert!(!runtime.frames().contains_key(&node_id));
    }

    #[test]
    fn playback_can_pause_scrub_and_restart_the_animation_clock() {
        let mut document = Document::empty("Playback");
        let page = document.root_page_id.clone();
        let mut node = Node::rectangle("Card", page, Layout::new(0.0, 0.0, 100.0, 60.0));
        node.animations.push(NodeAnimation {
            animation_id: "fade".into(),
            trigger: AnimationTrigger::Load,
            delay_ms: 0.0,
            once: false,
        });
        let node_id = node.id.clone();
        document.nodes.insert(node_id.clone(), node);
        document.animations.push(DocumentAnimation {
            id: "fade".into(),
            name: "Fade".into(),
            duration_ms: 1_000.0,
            easing: "linear".into(),
            cubic_bezier: None,
            delay_ms: 0.0,
            keyframes: vec![
                AnimationKeyframe {
                    offset: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    offset: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            iterations: 1.0,
            infinite: false,
            direction: "normal".into(),
            fill: "both".into(),
        });
        let start = Instant::now();
        let visible = HashSet::from([node_id.clone()]);
        let mut runtime = MotionRuntime::default();
        runtime.tick(&document, 1, true, None, None, None, &visible, start, false);
        runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &visible,
            start + Duration::from_millis(500),
            false,
        );
        assert!((runtime.frames()[&node_id].opacity - 0.5).abs() < 0.01);

        runtime.toggle_playback(start + Duration::from_millis(500));
        runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &visible,
            start + Duration::from_millis(900),
            false,
        );
        assert!((runtime.frames()[&node_id].opacity - 0.5).abs() < 0.01);
        assert!(!runtime.snapshot(&document).playing);

        runtime.scrub(&document, 0.25, start + Duration::from_millis(900));
        runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &visible,
            start + Duration::from_millis(900),
            false,
        );
        assert!((runtime.frames()[&node_id].opacity - 0.25).abs() < 0.01);

        runtime.restart(start + Duration::from_millis(900));
        runtime.tick(
            &document,
            1,
            true,
            None,
            None,
            None,
            &visible,
            start + Duration::from_millis(900),
            false,
        );
        assert!(runtime.snapshot(&document).playing);
        assert!(runtime.frames()[&node_id].opacity < 0.01);
    }
}
