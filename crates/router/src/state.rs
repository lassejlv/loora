use std::collections::HashMap;

use gpui::{App, Global, SharedString};

/// Normalize a pathname to always start with `/` and never end with `/` (except root).
pub fn normalize_pathname(pathname: impl AsRef<str>) -> SharedString {
    let pathname = pathname.as_ref().trim();
    let mut normalized = if pathname.is_empty() {
        "/".to_string()
    } else if pathname.starts_with('/') {
        pathname.to_string()
    } else {
        format!("/{pathname}")
    };

    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }

    normalized.into()
}

/// A URL-like location in the router.
#[derive(PartialEq, Eq, Clone, Debug)]
pub struct Location {
    /// Pathname beginning with `/`.
    pub pathname: SharedString,
}

impl Default for Location {
    fn default() -> Self {
        Self {
            pathname: normalize_pathname("/"),
        }
    }
}

/// Global router state stored in the GPUI app context.
#[derive(Clone)]
pub struct RouterState {
    pub location: Location,
    pub params: HashMap<SharedString, SharedString>,
}

impl Global for RouterState {}

impl RouterState {
    pub fn init(cx: &mut App) {
        cx.set_global(Self {
            location: Location::default(),
            params: HashMap::new(),
        });
    }

    pub fn with_path(&mut self, pathname: SharedString) -> &mut Self {
        self.location.pathname = normalize_pathname(pathname);
        self
    }

    pub fn global(cx: &App) -> &Self {
        cx.global::<Self>()
    }

    pub fn global_mut(cx: &mut App) -> &mut Self {
        cx.global_mut::<Self>()
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_pathname;

    #[test]
    fn normalize_handles_empty_relative_and_trailing_slashes() {
        assert_eq!(normalize_pathname(""), "/");
        assert_eq!(normalize_pathname("about"), "/about");
        assert_eq!(normalize_pathname("/about/"), "/about");
        assert_eq!(normalize_pathname("  /about/team/  "), "/about/team");
    }

    #[test]
    fn normalize_preserves_root() {
        assert_eq!(normalize_pathname("/"), "/");
        assert_eq!(normalize_pathname("////"), "/");
    }
}
