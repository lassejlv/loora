use gpui::{App, SharedString};

use crate::RouterState;

/// Navigate programmatically.
pub fn use_navigate(cx: &mut App) -> impl FnMut(SharedString) + '_ {
    move |path: SharedString| {
        cx.global_mut::<RouterState>().with_path(path);
    }
}

/// Current location.
pub fn use_location(cx: &App) -> &crate::Location {
    &cx.global::<RouterState>().location
}

/// Dynamic route params for the matched path (e.g. `{id}` → `"id"`).
pub fn use_params(cx: &App) -> &std::collections::HashMap<SharedString, SharedString> {
    &cx.global::<RouterState>().params
}
