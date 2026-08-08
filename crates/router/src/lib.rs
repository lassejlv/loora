//! React-Router inspired routing for GPUI.
//!
//! ```ignore
//! Routes::new().child(
//!     Route::new().path("/").layout(AppShell::new()).children([
//!         Route::new().index().element(|_, _| home()),
//!         Route::new().path("about").element(|_, _| about()),
//!         Route::new().path("{*rest}").element(|_, _| not_found()),
//!     ]),
//! )
//! ```

mod hooks;
mod layout;
mod nav_link;
mod outlet;
mod route;
mod routes;
mod state;

pub use hooks::{use_location, use_navigate, use_params};
pub use layout::Layout;
pub use nav_link::NavLink;
pub use outlet::Outlet;
pub use route::Route;
pub use routes::Routes;
pub use state::{normalize_pathname, Location, RouterState};

/// Initialize the global [`RouterState`]. Call once at app startup.
pub fn init(cx: &mut gpui::App) {
    RouterState::init(cx);
}
