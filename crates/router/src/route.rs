use gpui::{AnyElement, App, Empty, IntoElement, RenderOnce, SharedString, Window};

use crate::layout::Layout;
use crate::state::{normalize_pathname, RouterState};

type RouteElementFactory = Box<dyn Fn(&mut Window, &mut App) -> AnyElement>;

/// A route that matches a path pattern and renders an element or layout.
#[derive(IntoElement)]
pub struct Route {
    basename: SharedString,
    path: Option<SharedString>,
    pub(crate) element: Option<RouteElementFactory>,
    pub(crate) routes: Vec<Box<Route>>,
    pub(crate) layout: Option<Box<dyn Layout>>,
}

impl Default for Route {
    fn default() -> Self {
        Self {
            basename: SharedString::default(),
            path: None,
            element: None,
            routes: Vec::new(),
            layout: None,
        }
    }
}

impl std::fmt::Debug for Route {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Route")
            .field("basename", &self.basename)
            .field("path", &self.path)
            .field("layout", &self.layout.is_some())
            .field("element", &self.element.is_some())
            .field("routes", &self.routes.len())
            .finish()
    }
}

impl Route {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn basename(mut self, basename: impl Into<SharedString>) -> Self {
        self.basename = basename.into();
        self
    }

    /// Path segment to match (relative to parent), e.g. `"about"` or `"{id}"`.
    pub fn path(mut self, path: impl Into<SharedString>) -> Self {
        self.path = Some(path.into());
        self
    }

    /// Index route (empty path under the parent).
    pub fn index(self) -> Self {
        debug_assert!(
            self.path.is_none(),
            "Route index and path cannot be set at the same time"
        );
        self.path("")
    }

    /// Lazy element rendered when this leaf route matches.
    pub fn element<F, E>(mut self, element_fn: F) -> Self
    where
        F: Fn(&mut Window, &mut App) -> E + 'static,
        E: IntoElement,
    {
        debug_assert!(
            self.layout.is_none(),
            "Route element and layout cannot be set at the same time"
        );
        self.element = Some(Box::new(move |window, cx| {
            element_fn(window, cx).into_any_element()
        }));
        self
    }

    /// Layout rendered when this route matches; children render into its outlet.
    pub fn layout(mut self, layout: impl Layout + 'static) -> Self {
        debug_assert!(
            self.element.is_none(),
            "Route element and layout cannot be set at the same time"
        );
        self.layout = Some(Box::new(layout));
        self
    }

    pub fn child(mut self, child: Route) -> Self {
        self.routes.push(Box::new(child));
        self
    }

    pub fn children(mut self, children: impl IntoIterator<Item = Route>) -> Self {
        for child in children {
            self = self.child(child);
        }
        self
    }

    pub(crate) fn full_path(&self, basename: &str) -> SharedString {
        let basename = basename.trim_end_matches('/');
        let path = match &self.path {
            Some(path) => format!("{basename}/{path}"),
            None => basename.to_string(),
        };
        normalize_pathname(path)
    }

    pub(crate) fn build_route_map(&self, basename: &str) -> matchit::Router<SharedString> {
        let mut router_map = matchit::Router::new();
        let path = self.full_path(basename);

        if self.element.is_some() {
            router_map.insert(path.as_ref(), path.clone()).unwrap();
            return router_map;
        }

        for route in &self.routes {
            router_map
                .merge(route.build_route_map(path.as_ref()))
                .unwrap();
        }

        router_map
    }

    pub(crate) fn contains_pattern(&self, basename: &str, pattern: &str) -> bool {
        if self.element.is_some() {
            return self.full_path(basename).as_ref() == pattern;
        }

        let basename = self.full_path(basename);
        self.routes
            .iter()
            .any(|route| route.contains_pattern(basename.as_ref(), pattern))
    }
}

impl RenderOnce for Route {
    fn render(mut self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        if let Some(element_fn) = self.element {
            return element_fn(window, cx);
        }

        let basename = self.full_path(self.basename.as_ref());

        if let Some(mut layout) = self.layout {
            let pathname =
                normalize_pathname(cx.global::<RouterState>().location.pathname.as_ref());
            let routes = std::mem::take(&mut self.routes);
            let mut route_map = matchit::Router::new();
            for route in routes.iter() {
                route_map
                    .merge(route.build_route_map(basename.as_ref()))
                    .unwrap();
            }

            let route = route_map.at(pathname.as_ref()).ok().and_then(|matched| {
                routes
                    .into_iter()
                    .find(|route| route.contains_pattern(basename.as_ref(), matched.value.as_ref()))
            });

            if let Some(route) = route {
                layout.outlet(
                    route
                        .basename(basename)
                        .render(window, cx)
                        .into_any_element(),
                );
            }
            return layout.render_layout(window, cx);
        }

        Empty.into_any_element()
    }
}
