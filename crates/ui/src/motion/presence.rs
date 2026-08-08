use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui::{
    div, AnyElement, App, Empty, Global, IntoElement, ParentElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window,
};

use crate::component::StyledSlot;
use crate::motion::style::{apply_style, MotionStyle, ResolvedStyle};
use crate::motion::transition::{ease_out_cubic, Transition};

type PresenceFactory = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement + 'static>;

/// How enter/exit overlap (motion.dev `AnimatePresence` mode).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PresenceMode {
    /// Play exit and enter together.
    Sync,
    /// Wait for exit to finish before enter (default).
    #[default]
    Wait,
}

struct ExitingChild {
    factory: PresenceFactory,
    started: Instant,
    duration: Duration,
    from: MotionStyle,
    exit: MotionStyle,
}

struct PresenceSlot {
    current_key: SharedString,
    current: PresenceFactory,
    exiting: Option<ExitingChild>,
}

/// Global presence tracking keyed by presence host id.
pub struct PresenceStore {
    slots: HashMap<SharedString, PresenceSlot>,
}

impl Global for PresenceStore {}

pub fn init(cx: &mut App) {
    if !cx.has_global::<PresenceStore>() {
        cx.set_global(PresenceStore {
            slots: HashMap::new(),
        });
    }
}

/// Keeps the previous child mounted until its exit animation finishes.
#[derive(IntoElement)]
pub struct AnimatePresence {
    id: SharedString,
    mode: PresenceMode,
    key: SharedString,
    factory: Option<PresenceFactory>,
    exit: MotionStyle,
    exit_transition: Transition,
    style: StyleRefinement,
}

impl AnimatePresence {
    pub fn new(id: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            mode: PresenceMode::Wait,
            key: SharedString::from(""),
            factory: None,
            exit: MotionStyle::new().opacity(0.).y(gpui::px(-10.)),
            exit_transition: Transition::tween(Duration::from_millis(220)),
            style: StyleRefinement::default(),
        }
    }

    pub fn mode(mut self, mode: PresenceMode) -> Self {
        self.mode = mode;
        self
    }

    pub fn exit(mut self, style: MotionStyle) -> Self {
        self.exit = style;
        self
    }

    pub fn exit_transition(mut self, transition: Transition) -> Self {
        self.exit_transition = transition;
        self
    }

    pub fn child<F, E>(mut self, key: impl Into<SharedString>, factory: F) -> Self
    where
        F: Fn(&mut Window, &mut App) -> E + 'static,
        E: IntoElement,
    {
        self.key = key.into();
        self.factory = Some(Rc::new(move |window, cx| {
            factory(window, cx).into_any_element()
        }));
        self
    }
}

impl Styled for AnimatePresence {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for AnimatePresence {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        init(cx);

        let Some(factory) = self.factory else {
            return Empty.into_any_element();
        };

        let exit_duration = self.exit_transition.resolved_duration();
        let now = Instant::now();
        let mode = self.mode;
        let exit_style = self.exit;
        let host_style = self.style;
        let id = self.id;

        {
            let store = cx.global_mut::<PresenceStore>();
            match store.slots.get_mut(&id) {
                Some(slot) => {
                    if slot.current_key != self.key {
                        let old_factory = std::mem::replace(&mut slot.current, factory);
                        slot.current_key = self.key.clone();
                        slot.exiting = Some(ExitingChild {
                            factory: old_factory,
                            started: now,
                            duration: exit_duration,
                            from: MotionStyle::new().opacity(1.).y(gpui::px(0.)),
                            exit: exit_style,
                        });
                    } else {
                        slot.current = factory;
                    }
                }
                None => {
                    store.slots.insert(
                        id.clone(),
                        PresenceSlot {
                            current_key: self.key.clone(),
                            current: factory,
                            exiting: None,
                        },
                    );
                }
            }
        }

        // Snapshot what we need, then drop the store borrow before calling factories.
        let (current_factory, exiting_snap, still_exiting) = {
            let store = cx.global_mut::<PresenceStore>();
            let slot = store.slots.get_mut(&id).unwrap();

            if let Some(exiting) = &slot.exiting {
                if exiting.started.elapsed() >= exiting.duration {
                    slot.exiting = None;
                }
            }

            let still_exiting = slot.exiting.is_some();
            let exiting_snap = slot.exiting.as_ref().map(|exiting| {
                let t = (exiting.started.elapsed().as_secs_f32()
                    / exiting.duration.as_secs_f32().max(0.0001))
                .clamp(0.0, 1.0);
                (exiting.factory.clone(), exiting.from, exiting.exit, t)
            });
            (slot.current.clone(), exiting_snap, still_exiting)
        };

        let show_enter = match mode {
            PresenceMode::Sync => true,
            PresenceMode::Wait => !still_exiting,
        };

        let exiting_el = exiting_snap.map(|(factory, from_style, exit_style, t)| {
            let from = from_style.resolve(ResolvedStyle::default());
            let to = exit_style.resolve(from);
            let frame = from.lerp(to, ease_out_cubic(t));
            let child = factory(window, cx);
            apply_style(div().absolute().inset_0().size_full(), frame).child(child)
        });

        let current_el = if show_enter {
            Some(current_factory(window, cx))
        } else {
            None
        };

        if still_exiting {
            window.request_animation_frame();
        }

        div()
            .refine_style(&host_style)
            .size_full()
            .relative()
            .children(exiting_el)
            .children(current_el)
            .into_any_element()
    }
}
