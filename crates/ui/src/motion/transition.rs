use std::rc::Rc;
use std::time::Duration;

use gpui::{ease_in_out, ease_out_quint, linear, quadratic, Animation};

/// Named easing curves (motion.dev / CSS-like).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Ease {
    Linear,
    EaseIn,
    #[default]
    EaseOut,
    EaseInOut,
    EaseOutQuint,
}

impl Ease {
    pub(crate) fn function(self) -> Rc<dyn Fn(f32) -> f32> {
        match self {
            Self::Linear => Rc::new(linear),
            Self::EaseIn => Rc::new(quadratic),
            Self::EaseOut => Rc::new(ease_out_cubic),
            Self::EaseInOut => Rc::new(ease_in_out),
            Self::EaseOutQuint => Rc::new(ease_out_quint()),
        }
    }
}

pub fn ease_out_cubic(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

pub fn ease_in_cubic(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t
}

pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32) -> impl Fn(f32) -> f32 {
    move |t: f32| {
        let t = t.clamp(0.0, 1.0);
        let one_t = 1.0 - t;
        let one_t2 = one_t * one_t;
        let t2 = t * t;
        let t3 = t2 * t;
        let _x = 3.0 * x1 * one_t2 * t + 3.0 * x2 * one_t * t2 + t3;
        3.0 * y1 * one_t2 * t + 3.0 * y2 * one_t * t2 + t3
    }
}

pub(crate) fn spring_out(t: f32, bounce: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if bounce <= 0.001 {
        return ease_out_cubic(t);
    }
    let freq = 1.0 + bounce * 2.5;
    let decay = (-5.0 * t).exp();
    let wave = (t * freq * std::f32::consts::TAU).sin();
    (1.0 - decay + decay * wave * bounce * 0.45).clamp(0.0, 1.0 + bounce * 0.2)
}

#[derive(Clone)]
enum TransitionKind {
    Tween {
        duration: Duration,
        ease: Ease,
    },
    Spring {
        duration: Duration,
        bounce: f32,
    },
    SpringPhysics {
        stiffness: f32,
        damping: f32,
        mass: f32,
    },
}

/// motion.dev-style `transition` config.
#[derive(Clone)]
pub struct Transition {
    kind: TransitionKind,
    delay: Duration,
    repeat: bool,
    /// Delay before animating each child in a [`crate::motion::Stagger`] group.
    pub(crate) stagger_children: Duration,
    /// Extra delay before the first staggered child starts.
    pub(crate) delay_children: Duration,
}

impl Default for Transition {
    fn default() -> Self {
        Self::tween(Duration::from_millis(300)).ease(Ease::EaseOut)
    }
}

impl Transition {
    pub fn tween(duration: Duration) -> Self {
        Self {
            kind: TransitionKind::Tween {
                duration,
                ease: Ease::EaseOut,
            },
            delay: Duration::ZERO,
            repeat: false,
            stagger_children: Duration::ZERO,
            delay_children: Duration::ZERO,
        }
    }

    pub fn spring() -> Self {
        Self {
            kind: TransitionKind::Spring {
                duration: Duration::from_millis(500),
                bounce: 0.25,
            },
            delay: Duration::ZERO,
            repeat: false,
            stagger_children: Duration::ZERO,
            delay_children: Duration::ZERO,
        }
    }

    pub fn ease(mut self, ease: Ease) -> Self {
        if let TransitionKind::Tween {
            ease: ref mut e, ..
        } = self.kind
        {
            *e = ease;
        }
        self
    }

    pub fn duration(mut self, duration: Duration) -> Self {
        match &mut self.kind {
            TransitionKind::Tween {
                duration: ref mut d,
                ..
            }
            | TransitionKind::Spring {
                duration: ref mut d,
                ..
            } => *d = duration,
            TransitionKind::SpringPhysics { .. } => {
                self.kind = TransitionKind::Spring {
                    duration,
                    bounce: 0.25,
                };
            }
        }
        self
    }

    pub fn bounce(mut self, bounce: f32) -> Self {
        let bounce = bounce.clamp(0.0, 1.0);
        match &mut self.kind {
            TransitionKind::Spring {
                bounce: ref mut b, ..
            } => *b = bounce,
            _ => {
                let duration = self.resolved_duration();
                self.kind = TransitionKind::Spring { duration, bounce };
            }
        }
        self
    }

    pub fn stiffness(mut self, stiffness: f32) -> Self {
        self.ensure_physics();
        if let TransitionKind::SpringPhysics {
            stiffness: ref mut s,
            ..
        } = self.kind
        {
            *s = stiffness.max(1.0);
        }
        self
    }

    pub fn damping(mut self, damping: f32) -> Self {
        self.ensure_physics();
        if let TransitionKind::SpringPhysics {
            damping: ref mut d, ..
        } = self.kind
        {
            *d = damping.max(0.0);
        }
        self
    }

    pub fn mass(mut self, mass: f32) -> Self {
        self.ensure_physics();
        if let TransitionKind::SpringPhysics {
            mass: ref mut m, ..
        } = self.kind
        {
            *m = mass.max(0.01);
        }
        self
    }

    pub fn delay(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }

    pub fn repeat(mut self) -> Self {
        self.repeat = true;
        self
    }

    /// Stagger delay between children (motion.dev `staggerChildren`).
    pub fn stagger_children(mut self, stagger: Duration) -> Self {
        self.stagger_children = stagger;
        self
    }

    /// Delay before the first staggered child (motion.dev `delayChildren`).
    pub fn delay_children(mut self, delay: Duration) -> Self {
        self.delay_children = delay;
        self
    }

    fn ensure_physics(&mut self) {
        if !matches!(self.kind, TransitionKind::SpringPhysics { .. }) {
            self.kind = TransitionKind::SpringPhysics {
                stiffness: 300.0,
                damping: 25.0,
                mass: 1.0,
            };
        }
    }

    pub(crate) fn resolved_duration(&self) -> Duration {
        match self.kind {
            TransitionKind::Tween { duration, .. } | TransitionKind::Spring { duration, .. } => {
                duration
            }
            TransitionKind::SpringPhysics {
                stiffness,
                damping,
                mass,
            } => {
                let omega = (stiffness / mass).sqrt();
                let zeta = damping / (2.0 * (stiffness * mass).sqrt());
                let seconds = if zeta < 1.0 {
                    4.0 / (zeta * omega).max(0.1)
                } else {
                    4.0 / omega.max(0.1)
                };
                Duration::from_secs_f32(seconds.clamp(0.12, 2.0))
            }
        }
    }

    fn resolved_bounce(&self) -> f32 {
        match self.kind {
            TransitionKind::Spring { bounce, .. } => bounce,
            TransitionKind::SpringPhysics {
                stiffness,
                damping,
                mass,
            } => {
                let zeta = damping / (2.0 * (stiffness * mass).sqrt()).max(0.001);
                (1.0 - zeta.clamp(0.0, 1.0)) * 0.5
            }
            TransitionKind::Tween { .. } => 0.0,
        }
    }

    pub(crate) fn with_extra_delay(mut self, extra: Duration) -> Self {
        self.delay = self.delay.saturating_add(extra);
        self
    }

    pub(crate) fn into_animation(self) -> Animation {
        let duration = self.resolved_duration().saturating_add(self.delay);
        let bounce = self.resolved_bounce();
        let delay_frac = if duration.as_secs_f32() > 0.0 {
            self.delay.as_secs_f32() / duration.as_secs_f32()
        } else {
            0.0
        };

        let easing: Rc<dyn Fn(f32) -> f32> = match self.kind {
            TransitionKind::Tween { ease, .. } => {
                let ease = ease.function();
                Rc::new(move |t: f32| gated_ease(t, delay_frac, |local| ease(local)))
            }
            TransitionKind::Spring { .. } | TransitionKind::SpringPhysics { .. } => {
                Rc::new(move |t: f32| gated_ease(t, delay_frac, |local| spring_out(local, bounce)))
            }
        };

        let mut animation = Animation::new(duration).with_easing(move |t| easing(t));
        if self.repeat {
            animation = animation.repeat();
        }
        animation
    }
}

fn gated_ease(t: f32, delay_frac: f32, ease: impl Fn(f32) -> f32) -> f32 {
    if t < delay_frac {
        0.0
    } else {
        let local = ((t - delay_frac) / (1.0 - delay_frac).max(0.0001)).clamp(0.0, 1.0);
        ease(local)
    }
}

#[cfg(test)]
mod tests {
    use super::{ease_out_cubic, spring_out};

    #[test]
    fn ease_out_ends_at_one() {
        assert!((ease_out_cubic(1.0) - 1.0).abs() < 0.001);
        assert!(ease_out_cubic(0.0).abs() < 0.001);
    }

    #[test]
    fn spring_out_settles() {
        assert!(spring_out(0.0, 0.25).abs() < 0.05);
        assert!((spring_out(1.0, 0.25) - 1.0).abs() < 0.05);
    }
}
