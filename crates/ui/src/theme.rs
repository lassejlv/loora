use gpui::{rgb, rgba, transparent_black, Hsla, Rgba};

/// UI chrome theme mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThemeKind {
    #[default]
    Dark,
    Light,
}

impl ThemeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Light => "light",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "dark" | "groknight" => Some(Self::Dark),
            "light" => Some(Self::Light),
            _ => None,
        }
    }

    pub fn toggle(self) -> Self {
        match self {
            Self::Dark => Self::Light,
            Self::Light => Self::Dark,
        }
    }
}

/// App chrome + ANSI-style palette tokens.
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    pub kind: ThemeKind,
    pub foreground: Hsla,
    pub background: Hsla,
    pub cursor: Hsla,
    pub black: Hsla,
    pub red: Hsla,
    pub green: Hsla,
    pub yellow: Hsla,
    pub blue: Hsla,
    pub magenta: Hsla,
    pub cyan: Hsla,
    pub white: Hsla,
    pub bright_black: Hsla,
    pub bright_red: Hsla,
    pub bright_green: Hsla,
    pub bright_yellow: Hsla,
    pub bright_blue: Hsla,
    pub bright_magenta: Hsla,
    pub bright_cyan: Hsla,
    pub bright_white: Hsla,

    // Chrome
    pub sidebar_bg: Hsla,
    pub main_bg: Hsla,
    pub surface: Hsla,
    pub surface_raised: Hsla,
    pub border: Hsla,
    pub muted: Hsla,
    pub muted_strong: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    pub accent: Hsla,
}

impl Theme {
    pub fn from_kind(kind: ThemeKind) -> Self {
        match kind {
            ThemeKind::Dark => Self::dark(),
            ThemeKind::Light => Self::light(),
        }
    }

    /// Dark chrome (formerly Groknight).
    pub fn dark() -> Self {
        let foreground = hex(0xe1e1e1);
        let background = hex(0x141414);
        let bright_black = hex(0x787878);
        let blue = hex(0x7aa2f7);

        Self {
            kind: ThemeKind::Dark,
            foreground,
            background,
            cursor: hex(0xc8c8c8),
            black: hex(0x0a0a0a),
            red: hex(0xf7768e),
            green: hex(0x9ece6a),
            yellow: hex(0xe0af68),
            blue,
            magenta: hex(0xbb9af7),
            cyan: hex(0x7dcfff),
            white: hex(0xc8c8c8),
            bright_black,
            bright_red: hex(0xff8fa3),
            bright_green: hex(0xb9f27c),
            bright_yellow: hex(0xffc777),
            bright_blue: hex(0x89b4fa),
            bright_magenta: hex(0xcba6f7),
            bright_cyan: hex(0x89ddff),
            bright_white: hex(0xf3f3f3),

            // Translucent chrome so WindowBackgroundAppearance::Blurred shows through.
            sidebar_bg: rgba(0x10101066).into(),
            main_bg: rgba(0x1414144d).into(),
            surface: rgba(0x1a1a1ab3).into(),
            surface_raised: rgba(0x222222cc).into(),
            border: rgba(0x2a2a2a99).into(),
            muted: bright_black,
            muted_strong: hex(0x9a9a9a),
            hover: rgba(0x1e1e1e99).into(),
            selected: rgba(0x252525a6).into(),
            accent: blue,
        }
    }

    /// Light chrome.
    pub fn light() -> Self {
        let foreground = hex(0x1a1a1a);
        let background = hex(0xf5f5f5);
        let bright_black = hex(0x8a8a8a);
        let blue = hex(0x3d6fd9);

        Self {
            kind: ThemeKind::Light,
            foreground,
            background,
            cursor: hex(0x1a1a1a),
            black: hex(0x0a0a0a),
            red: hex(0xd14d60),
            green: hex(0x4c9a4e),
            yellow: hex(0xb8860b),
            blue,
            magenta: hex(0x8b5cf6),
            cyan: hex(0x0891b2),
            white: hex(0x6b6b6b),
            bright_black,
            bright_red: hex(0xe11d48),
            bright_green: hex(0x16a34a),
            bright_yellow: hex(0xca8a04),
            bright_blue: hex(0x2563eb),
            bright_magenta: hex(0x7c3aed),
            bright_cyan: hex(0x0e7490),
            // Primary label color on light surfaces (dark text).
            bright_white: hex(0x111111),

            // Nearly opaque so light mode reads clearly over the blurred window.
            sidebar_bg: rgba(0xf6f6f6f5).into(),
            main_bg: rgba(0xecececff).into(),
            surface: rgba(0xfffffff2).into(),
            surface_raised: rgba(0xffffffff).into(),
            border: rgba(0x00000018).into(),
            muted: bright_black,
            muted_strong: hex(0x5c5c5c),
            hover: rgba(0x0000000c).into(),
            selected: rgba(0x00000012).into(),
            accent: blue,
        }
    }

    /// Alias for [`Self::dark`] — kept for older call sites.
    pub fn groknight() -> Self {
        Self::dark()
    }

    pub fn is_dark(self) -> bool {
        self.kind == ThemeKind::Dark
    }

    pub fn is_light(self) -> bool {
        self.kind == ThemeKind::Light
    }

    /// Root fill must stay fully transparent so the system blur layer is visible.
    pub fn window_fill(self) -> Hsla {
        transparent_black()
    }

    /// Canvas / viewport backdrop behind artboards.
    pub fn canvas_bg(self) -> Hsla {
        if self.is_dark() {
            hex(0x0f0f10)
        } else {
            hex(0xe4e4e6)
        }
    }

    /// Top chrome strip (title / page tabs).
    pub fn header_bg(self) -> Hsla {
        if self.is_dark() {
            rgba(0x121212cc).into()
        } else {
            rgba(0xfffffff0).into()
        }
    }

    /// Side panels (layers / properties).
    pub fn panel_chrome_bg(self) -> Hsla {
        if self.is_dark() {
            rgba(0x121212f2).into()
        } else {
            rgba(0xf7f7f7f5).into()
        }
    }

    /// Dim overlay behind modal dialogs.
    pub fn overlay_scrim(self) -> Hsla {
        if self.is_dark() {
            rgba(0x00000099).into()
        } else {
            rgba(0x1a1a1a40).into()
        }
    }

    /// Elevated panel / popover background.
    pub fn panel_bg(self) -> Hsla {
        if self.is_dark() {
            rgba(0x161616f7).into()
        } else {
            rgba(0xfffffff5).into()
        }
    }

    /// Compact inspector field fill.
    pub fn field_bg(self) -> Hsla {
        if self.is_dark() {
            rgba(0x1c1c1cff).into()
        } else {
            rgba(0xffffffee).into()
        }
    }

    /// Primary hairline (borders on panels).
    pub fn hairline(self) -> Hsla {
        if self.is_dark() {
            rgba(0xffffff18).into()
        } else {
            rgba(0x00000014).into()
        }
    }

    /// Softer divider hairline.
    pub fn hairline_soft(self) -> Hsla {
        if self.is_dark() {
            rgba(0xffffff10).into()
        } else {
            rgba(0x0000000c).into()
        }
    }

    /// Row / item highlight fill.
    pub fn highlight_fill(self) -> Hsla {
        if self.is_dark() {
            rgba(0xffffff14).into()
        } else {
            rgba(0x0000000a).into()
        }
    }

    /// Subtle hover wash.
    pub fn wash(self) -> Hsla {
        if self.is_dark() {
            rgba(0xffffff10).into()
        } else {
            rgba(0x00000008).into()
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self::dark()
    }
}

fn hex(value: u32) -> Hsla {
    let Rgba { r, g, b, a } = rgb(value);
    Rgba { r, g, b, a }.into()
}
