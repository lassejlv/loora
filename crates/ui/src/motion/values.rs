use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use gpui::{App, Global, SharedString};

/// Shared animatable scalar (motion.dev `MotionValue`).
#[derive(Clone)]
pub struct MotionValue {
    name: SharedString,
    store: Arc<RwLock<HashMap<SharedString, f32>>>,
}

impl MotionValue {
    pub fn get(&self) -> f32 {
        self.store
            .read()
            .ok()
            .and_then(|map| map.get(&self.name).copied())
            .unwrap_or(0.0)
    }

    pub fn set(&self, value: f32) {
        if let Ok(mut map) = self.store.write() {
            map.insert(self.name.clone(), value);
        }
    }

    /// Set the value and refresh open windows so bound UI updates.
    pub fn set_with_notify(&self, value: f32, cx: &mut App) {
        self.set(value);
        cx.refresh_windows();
    }

    pub fn name(&self) -> &SharedString {
        &self.name
    }
}

/// Global registry of named motion values.
pub struct MotionValueStore {
    values: Arc<RwLock<HashMap<SharedString, f32>>>,
}

impl Global for MotionValueStore {}

impl MotionValueStore {
    pub fn init(cx: &mut App) {
        if !cx.has_global::<Self>() {
            cx.set_global(Self {
                values: Arc::new(RwLock::new(HashMap::new())),
            });
        }
    }
}

pub fn init(cx: &mut App) {
    MotionValueStore::init(cx);
}

/// Get or create a named [`MotionValue`]. Prefer calling [`init`] at startup.
pub fn use_motion_value(cx: &App, name: impl Into<SharedString>) -> MotionValue {
    let name = name.into();
    let store = if cx.has_global::<MotionValueStore>() {
        cx.global::<MotionValueStore>().values.clone()
    } else {
        // Ephemeral fallback if init was skipped — still usable within this handle.
        Arc::new(RwLock::new(HashMap::new()))
    };
    {
        let mut map = store.write().expect("motion value store poisoned");
        map.entry(name.clone()).or_insert(0.0);
    }
    MotionValue { name, store }
}
