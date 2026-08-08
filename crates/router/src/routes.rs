use std::collections::HashMap;

use gpui::{App, Empty, IntoElement, RenderOnce, SharedString, Window};

use crate::route::Route;
use crate::state::{normalize_pathname, RouterState};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MatchedRoute {
    pub(crate) pattern: SharedString,
    pub(crate) params: HashMap<SharedString, SharedString>,
}

/// Renders the [`Route`] branch that best matches the current path.
#[derive(IntoElement)]
pub struct Routes {
    basename: SharedString,
    routes: Vec<Route>,
}

impl Default for Routes {
    fn default() -> Self {
        Self::new()
    }
}

impl Routes {
    pub fn new() -> Self {
        Self {
            basename: SharedString::from("/"),
            routes: Vec::new(),
        }
    }

    pub fn basename(mut self, basename: impl Into<SharedString>) -> Self {
        self.basename = normalize_pathname(basename.into());
        self
    }

    pub fn child(mut self, child: Route) -> Self {
        self.routes.push(child);
        self
    }

    pub fn children(mut self, children: impl IntoIterator<Item = Route>) -> Self {
        for child in children {
            self = self.child(child);
        }
        self
    }

    pub(crate) fn match_route(&self, pathname: &str) -> Option<MatchedRoute> {
        let pathname = normalize_pathname(pathname);
        let mut route_map = matchit::Router::new();
        for route in &self.routes {
            route_map
                .merge(route.build_route_map(self.basename.as_ref()))
                .unwrap();
        }

        let matched = route_map.at(pathname.as_ref()).ok()?;
        let params = matched
            .params
            .iter()
            .map(|(key, value)| {
                (
                    SharedString::from(key.to_owned()),
                    SharedString::from(value.to_owned()),
                )
            })
            .collect();

        Some(MatchedRoute {
            pattern: matched.value.clone(),
            params,
        })
    }

    pub(crate) fn apply_match(
        cx: &mut App,
        pathname: SharedString,
        matched: Option<&MatchedRoute>,
    ) {
        let state = cx.global_mut::<RouterState>();
        state.location.pathname = pathname;
        if let Some(matched) = matched {
            state.params = matched.params.clone();
        } else {
            state.params.clear();
        }
    }
}

impl RenderOnce for Routes {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        debug_assert!(
            cx.has_global::<RouterState>(),
            "RouterState not initialized — call gpui_router::init(cx) at startup"
        );

        let pathname = normalize_pathname(cx.global::<RouterState>().location.pathname.as_ref());
        let matched = self.match_route(pathname.as_ref());
        Self::apply_match(cx, pathname, matched.as_ref());

        if let Some(matched) = matched {
            let route = self.routes.into_iter().find(|route| {
                route.contains_pattern(self.basename.as_ref(), matched.pattern.as_ref())
            });
            if let Some(route) = route {
                return route.basename(self.basename).into_any_element();
            }
        }

        Empty.into_any_element()
    }
}
