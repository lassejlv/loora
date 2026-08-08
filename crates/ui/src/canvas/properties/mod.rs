mod appearance;
mod constraints;
mod controls;
mod layout;
mod shadow;
mod stack;
mod systems;

use std::collections::HashSet;

use gpui::{
    div, prelude::FluentBuilder, px, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
};
use loora_engine::{Node, NodeKind};

use crate::canvas::properties::appearance::{
    appearance_section, image_section, stroke_section, type_section,
};
use crate::canvas::properties::constraints::constraints_section;
use crate::canvas::properties::controls::{section, text_field};
use crate::canvas::properties::layout::layout_section;
use crate::canvas::properties::shadow::shadow_section;
use crate::canvas::properties::stack::stack_section;
use crate::canvas::properties::systems::{
    actions_section, component_section, motion_section, responsive_section, tokens_section,
    vector_section,
};
use crate::canvas::workspace::CanvasWorkspace;
use crate::theme::Theme;

pub use controls::{format_hex, format_number, parse_hex};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PropsField {
    Name,
    X,
    Y,
    W,
    H,
    Rotation,
    Position,
    LayoutMode,
    Direction,
    Align,
    Justify,
    Gap,
    Grow,
    Shrink,
    Wrap,
    PaddingTop,
    PaddingRight,
    PaddingBottom,
    PaddingLeft,
    Fill,
    GradientAngle,
    Opacity,
    Radius,
    CornerTl,
    CornerTr,
    CornerBr,
    CornerBl,
    Overflow,
    StrokeColor,
    StrokeWidth,
    StrokeStyle,
    ShadowColor,
    ShadowX,
    ShadowY,
    ShadowBlur,
    ShadowSpread,
    FontSize,
    FontFamily,
    FontWeight,
    LineHeight,
    LetterSpacing,
    TextColor,
    TextAlign,
    Text,
    MinWidth,
    MaxWidth,
    MinHeight,
    MaxHeight,
    AspectRatio,
    Columns,
    MotionDuration,
    ActionUrl,
    VectorFill,
    VectorWeight,
}

#[derive(Clone, Debug)]
pub struct PropsView {
    pub focus: Option<PropsField>,
    pub draft: String,
    pub selection: Option<(usize, usize)>,
    pub readonly: bool,
    pub collapsed: HashSet<&'static str>,
}

impl Default for PropsView {
    fn default() -> Self {
        Self {
            focus: None,
            draft: String::new(),
            selection: None,
            readonly: false,
            collapsed: HashSet::new(),
        }
    }
}

impl PropsView {
    pub fn selection_for(&self, field: PropsField) -> Option<(usize, usize)> {
        (self.focus == Some(field)).then_some(self.selection).flatten()
    }
}

/// Returns a value only when every selected layer agrees.
pub fn shared<T: PartialEq + Clone>(values: impl IntoIterator<Item = T>) -> Option<T> {
    let mut values = values.into_iter();
    let first = values.next()?;
    values.all(|value| value == first).then_some(first)
}

#[derive(IntoElement)]
pub struct PropertiesPanel {
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    selection: Vec<Node>,
    world_bounds: Option<loora_engine::Bounds>,
    view: PropsView,
}

impl PropertiesPanel {
    pub fn new(
        workspace: Entity<CanvasWorkspace>,
        theme: Theme,
        selection: Vec<Node>,
        world_bounds: Option<loora_engine::Bounds>,
        view: PropsView,
    ) -> Self {
        Self {
            workspace,
            theme,
            selection,
            world_bounds,
            view,
        }
    }
}

impl RenderOnce for PropertiesPanel {
    fn render(self, _window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let theme = self.theme;
        let workspace = self.workspace;
        let view = self.view;

        div()
            .flex()
            .flex_col()
            .w(px(272.))
            .h_full()
            .min_h_0()
            .border_l_1()
            .border_color(theme.border)
            .bg(theme.panel_chrome_bg())
            .child(
                div()
                    .id("properties-titlebar")
                    .flex()
                    .items_center()
                    .h(px(52.))
                    .flex_shrink_0()
                    .px_3()
                    .border_b_1()
                    .border_color(theme.border)
                    .on_click(|event, window, _| {
                        if event.click_count() == 2 {
                            window.titlebar_double_click();
                        }
                    })
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.bright_white)
                            .child("Properties"),
                    ),
            )
            .child(match (self.selection.first(), self.world_bounds) {
                (Some(node), Some(bounds)) => {
                    let node = node.clone();
                    let selection = self.selection.clone();
                    let selection_count = selection.len();
                    let shared_rotation = shared(selection.iter().map(|n| n.rotation));
                    let shared_layout = shared(selection.iter().map(|n| n.layout.clone()));
                    let shared_bounds = if selection_count == 1 {
                        Some(bounds)
                    } else {
                        None
                    };
                    let action_url = node
                        .interactions
                        .iter()
                        .flat_map(|i| i.actions.iter())
                        .find_map(|a| match a {
                            loora_engine::CanvasAction::OpenUrl { url, .. } => Some(url.clone()),
                            loora_engine::CanvasAction::Navigate { page_id } => {
                                Some(format!("page:{page_id}"))
                            }
                            _ => None,
                        });
                    let ws = workspace.read(cx);
                    let breakpoints = ws.engine.document().breakpoints.clone();
                    let tokens = ws.engine.document().tokens.clone();
                    let active_breakpoint = ws.active_breakpoint_id.clone();
                    let variant_names = ws.variant_names_for(&node);
                    let has_responsive_override = active_breakpoint
                        .as_ref()
                        .map(|id| selection.iter().any(|n| n.responsive.contains_key(id)))
                        .unwrap_or(false);

                    div()
                        .id("properties-scroll")
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(header_section(
                            workspace.clone(),
                            theme,
                            &node,
                            &selection,
                            &view,
                        ))
                        .child(section(
                            theme,
                            "Layout",
                            !view.collapsed.contains("Layout"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Layout", cx)
                                    });
                                }
                            },
                            layout_section(
                                workspace.clone(),
                                theme,
                                &view,
                                shared_bounds,
                                shared_rotation,
                            ),
                        ))
                        .when(
                            selection.iter().any(|n| {
                                matches!(n.kind, NodeKind::Frame | NodeKind::Component)
                            }),
                            |this| {
                            this.child(section(
                                theme,
                                "Stack",
                                !view.collapsed.contains("Stack"),
                                {
                                    let ws = workspace.clone();
                                    move |_, _, cx| {
                                        ws.update(cx, |this, cx| {
                                            this.toggle_props_section("Stack", cx)
                                        });
                                    }
                                },
                                stack_section(
                                    workspace.clone(),
                                    theme,
                                    &view,
                                    shared_layout.as_ref(),
                                ),
                            ))
                        })
                        .child(section(
                            theme,
                            "Appearance",
                            !view.collapsed.contains("Appearance"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Appearance", cx)
                                    });
                                }
                            },
                            appearance_section(workspace.clone(), theme, &view, &node.style),
                        ))
                        .child(section(
                            theme,
                            "Stroke",
                            !view.collapsed.contains("Stroke"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Stroke", cx)
                                    });
                                }
                            },
                            stroke_section(
                                workspace.clone(),
                                theme,
                                &view,
                                node.style.stroke.as_ref(),
                            ),
                        ))
                        .child(section(
                            theme,
                            "Shadow",
                            !view.collapsed.contains("Shadow"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Shadow", cx)
                                    })
                                }
                            },
                            shadow_section(
                                workspace.clone(),
                                theme,
                                &view,
                                node.style.shadows.first(),
                            ),
                        ))
                        .when(selection.iter().any(|n| n.kind == NodeKind::Text), |this| {
                            this.child(section(
                                theme,
                                "Type",
                                !view.collapsed.contains("Type"),
                                {
                                    let ws = workspace.clone();
                                    move |_, _, cx| {
                                        ws.update(cx, |this, cx| {
                                            this.toggle_props_section("Type", cx)
                                        });
                                    }
                                },
                                type_section(
                                    workspace.clone(),
                                    theme,
                                    &view,
                                    node.font_size,
                                    node.text_content(),
                                    &node.effective_typography(),
                                ),
                            ))
                        })
                        .child(section(
                            theme,
                            "Constraints",
                            !view.collapsed.contains("Constraints"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Constraints", cx)
                                    })
                                }
                            },
                            constraints_section(workspace.clone(), theme, &view, &node.layout),
                        ))
                        .child(section(
                            theme,
                            "Responsive",
                            !view.collapsed.contains("Responsive"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Responsive", cx)
                                    })
                                }
                            },
                            responsive_section(
                                workspace.clone(),
                                theme,
                                &view,
                                &breakpoints,
                                active_breakpoint.as_deref(),
                                has_responsive_override,
                            ),
                        ))
                        .child(section(
                            theme,
                            "Motion",
                            !view.collapsed.contains("Motion"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Motion", cx)
                                    })
                                }
                            },
                            motion_section(
                                workspace.clone(),
                                theme,
                                &view,
                                node.visual_states.as_ref(),
                                node.transition.as_ref(),
                            ),
                        ))
                        .when(
                            matches!(node.kind, NodeKind::Component | NodeKind::Instance),
                            |this| {
                                this.child(section(
                                    theme,
                                    "Component",
                                    !view.collapsed.contains("Component"),
                                    {
                                        let ws = workspace.clone();
                                        move |_, _, cx| {
                                            ws.update(cx, |this, cx| {
                                                this.toggle_props_section("Component", cx)
                                            })
                                        }
                                    },
                                    component_section(
                                        workspace.clone(),
                                        theme,
                                        &view,
                                        &node,
                                        &variant_names,
                                    ),
                                ))
                            },
                        )
                        .child(section(
                            theme,
                            "Actions",
                            !view.collapsed.contains("Actions"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Actions", cx)
                                    })
                                }
                            },
                            actions_section(workspace.clone(), theme, &view, action_url.clone()),
                        ))
                        .when(node.kind == NodeKind::Vector, |this| {
                            this.child(section(
                                theme,
                                "Vector",
                                !view.collapsed.contains("Vector"),
                                {
                                    let ws = workspace.clone();
                                    move |_, _, cx| {
                                        ws.update(cx, |this, cx| {
                                            this.toggle_props_section("Vector", cx)
                                        })
                                    }
                                },
                                vector_section(
                                    workspace.clone(),
                                    theme,
                                    &view,
                                    node.paths.first(),
                                ),
                            ))
                        })
                        .child(section(
                            theme,
                            "Tokens",
                            !view.collapsed.contains("Tokens"),
                            {
                                let ws = workspace.clone();
                                move |_, _, cx| {
                                    ws.update(cx, |this, cx| {
                                        this.toggle_props_section("Tokens", cx)
                                    })
                                }
                            },
                            tokens_section(
                                workspace.clone(),
                                theme,
                                &tokens,
                                view.readonly,
                            ),
                        ))
                        .when(node.kind == NodeKind::Image, |this| {
                            this.child(section(
                                theme,
                                "Image",
                                !view.collapsed.contains("Image"),
                                {
                                    let ws = workspace.clone();
                                    move |_, _, cx| {
                                        ws.update(cx, |this, cx| {
                                            this.toggle_props_section("Image", cx)
                                        });
                                    }
                                },
                                image_section(workspace, theme, &view),
                            ))
                        })
                        .into_any_element()

                }
                _ => div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .child(empty_state(theme))
                    .into_any_element(),
            })
    }
}

fn header_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    node: &Node,
    selection: &[Node],
    view: &PropsView,
) -> impl IntoElement {
    let selection_count = selection.len();
    let name_display = if view.focus == Some(PropsField::Name) {
        SharedString::from(view.draft.clone())
    } else {
        SharedString::from(if selection_count > 1 {
            format!("{selection_count} layers")
        } else {
            node.name.clone()
        })
    };
    let kind = shared(selection.iter().map(|n| n.kind))
        .map(kind_label)
        .unwrap_or("Mixed");
    let ws = workspace.clone();
    let ws_blur = workspace;

    div()
        .flex()
        .flex_col()
        .gap_1()
        .px_2()
        .py_2()
        .border_b_1()
        .border_color(theme.border)
        .child(text_field(
            theme,
            "props-name".into(),
            name_display,
            "Name".into(),
            view.focus == Some(PropsField::Name),
            view.selection_for(PropsField::Name),
            view.readonly,
            move |event, window, cx| {
                ws.update(cx, |this, cx| {
                    this.focus_props_field(PropsField::Name, event.click_count, window, cx)
                });
            },
            move |_, _, cx| ws_blur.update(cx, |this, cx| this.blur_props_if_needed(cx)),
        ))
        .child(
            div().flex().items_center().h(px(20.)).px_1().child(
                div()
                    .px_1p5()
                    .py_0p5()
                    .rounded(px(4.))
                    .bg(theme.highlight_fill())
                    .text_size(px(10.))
                    .text_color(theme.muted_strong)
                    .child(kind),
            ),
        )
}

fn empty_state(theme: Theme) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .flex_1()
        .px_4()
        .child(
            div()
                .text_size(px(12.))
                .text_color(theme.muted)
                .child("No selection"),
        )
        .child(
            div()
                .mt_1()
                .text_size(px(11.))
                .text_color(theme.muted)
                .child("Select a layer to edit properties"),
        )
}

fn kind_label(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Frame => "Frame",
        NodeKind::Rectangle => "Rectangle",
        NodeKind::Text => "Text",
        NodeKind::Image => "Image",
        NodeKind::Component => "Component",
        NodeKind::Instance => "Instance",
        NodeKind::Vector => "Vector",
    }
}
