use std::borrow::Cow;

use gpui::{AssetSource, Result, SharedString};

/// Bundled UI assets (Hugeicons SVGs).
pub struct Assets;

macro_rules! icons {
    ($($path:literal),+ $(,)?) => {
        fn load_icon(path: &str) -> Option<&'static [u8]> {
            match path {
                $($path => Some(include_bytes!(concat!("../assets/", $path))),)+
                _ => None,
            }
        }

        fn list_icons() -> &'static [&'static str] {
            &[$($path),+]
        }
    };
}

icons! {
    "icons/home-01.svg",
    "icons/search-01.svg",
    "icons/dashboard-square-01.svg",
    "icons/folder-01.svg",
    "icons/message-01.svg",
    "icons/notification-03.svg",
    "icons/settings-01.svg",
    "icons/user-circle.svg",
    "icons/cursor-02.svg",
    "icons/hand.svg",
    "icons/view.svg",
    "icons/view-off.svg",
    "icons/layout-right.svg",
    "icons/grid.svg",
    "icons/text.svg",
    "icons/square.svg",
    "icons/shapes.svg",
    "icons/image-01.svg",
    "icons/diamond.svg",
    "icons/undo.svg",
    "icons/redo.svg",
    "icons/add-01.svg",
    "icons/lock.svg",
    "icons/unlock.svg",
    "icons/arrow-right-01.svg",
    "icons/arrow-down-01.svg",
    "icons/drag-drop-vertical.svg",
    "icons/circle.svg",
    "icons/pen-tool-01.svg",
    "icons/more-horizontal.svg",
    "icons/layers-01.svg",
    "icons/group-items.svg",
    "icons/ungroup-items.svg",
    "icons/sidebar-left.svg",
    "icons/bounding-box.svg",
    "icons/scissors.svg",
    "icons/copy-01.svg",
    "icons/copy-02.svg",
    "icons/clipboard-paste.svg",
    "icons/layer-bring-to-front.svg",
    "icons/layer-bring-forward.svg",
    "icons/layer-send-backward.svg",
    "icons/layer-send-to-back.svg",
    "icons/cancel-square.svg",
    "icons/delete-02.svg",
}

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        Ok(load_icon(path).map(Cow::Borrowed))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(list_icons()
            .iter()
            .copied()
            .filter(|p| p.starts_with(path))
            .map(SharedString::from)
            .collect())
    }
}
