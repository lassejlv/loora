use gpui::{
    div, prelude::FluentBuilder, AnyElement, Entity, IntoElement, ParentElement, SharedString,
    Styled,
};
use loora_engine::{FlexDirection, Layout, LayoutAlign, LayoutJustify, LayoutMode, SizeMode};

use crate::canvas::properties::controls::{choice_field, number_field, pair, select_field};
use crate::canvas::properties::{format_number, PropsField, PropsView};
use crate::canvas::workspace::CanvasWorkspace;
use crate::context_menu::{ContextMenuAction, ContextMenuEntry};
use crate::theme::Theme;

pub fn stack_section(
    workspace: Entity<CanvasWorkspace>,
    theme: Theme,
    view: &PropsView,
    layout: Option<&Layout>,
) -> impl IntoElement {
    let disabled = view.readonly;
    let numeric = |field: PropsField, label: &'static str, value: Option<f64>| -> AnyElement {
        let start = value.unwrap_or(0.0);
        let ws = workspace.clone();
        let ws2 = workspace.clone();
        let ws3 = workspace.clone();
        let ws4 = workspace.clone();
        let ws5 = workspace.clone();
        number_field(
            theme,
            format!("props-stack-{label}").into(),
            label,
            if view.focus == Some(field) {
                view.draft.clone().into()
            } else {
                match value {
                    Some(v) => format_number(v, 1).into(),
                    None => SharedString::from("Mixed"),
                }
            },
            view.focus == Some(field),
            view.selection_for(field),
            disabled,
            None,
            move |event, window, cx| {
                ws.update(cx, |this, cx| {
                    this.focus_props_field(field, event.click_count, window, cx)
                })
            },
            move |_, _, cx| ws5.update(cx, |this, cx| this.blur_props_if_needed(cx)),
            move |event, _, cx| {
                ws2.update(cx, |this, cx| {
                    this.begin_props_scrub(field, start, f32::from(event.position.x), cx)
                })
            },
            move |event, _, cx| {
                ws3.update(cx, |this, cx| {
                    this.update_props_scrub(f32::from(event.position.x), 1.0, cx)
                })
            },
            move |_, _, cx| ws4.update(cx, |this, cx| this.end_props_scrub(cx)),
        )
        .into_any_element()
    };

    let mode_label = match layout.map(|l| l.mode) {
        Some(LayoutMode::Flex) => Some(SharedString::from("Flex")),
        Some(LayoutMode::Grid) => Some(SharedString::from("Grid")),
        Some(LayoutMode::Absolute) => Some(SharedString::from("Absolute")),
        None => None,
    };
    let show_flex = matches!(layout.map(|l| l.mode), Some(LayoutMode::Flex));
    let show_grid = matches!(layout.map(|l| l.mode), Some(LayoutMode::Grid));
    let direction = layout.map(|l| {
        if l.direction == FlexDirection::Row {
            "Row"
        } else {
            "Column"
        }
    });
    let align = layout.map(|l| match l.align {
        LayoutAlign::Start => "Start",
        LayoutAlign::Center => "Center",
        LayoutAlign::End => "End",
        LayoutAlign::Stretch => "Stretch",
    });
    let justify = layout.map(|l| match l.justify {
        LayoutJustify::Start => "Start",
        LayoutJustify::Center => "Center",
        LayoutJustify::End => "End",
        LayoutJustify::SpaceBetween => "Between",
        LayoutJustify::SpaceAround => "Around",
    });
    let w_mode = layout.map(|l| match l.width_mode {
        SizeMode::Fixed => "Fixed",
        SizeMode::Percent => "Percent",
        SizeMode::Hug => "Hug",
        SizeMode::Fill => "Fill",
    });
    let h_mode = layout.map(|l| match l.height_mode {
        SizeMode::Fixed => "Fixed",
        SizeMode::Percent => "Percent",
        SizeMode::Hug => "Hug",
        SizeMode::Fill => "Fill",
    });

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(select_field(
            theme,
            "props-stack-mode".into(),
            "Mode",
            mode_label,
            disabled,
            {
                let ws = workspace.clone();
                move |event, window, cx| {
                    let entries = vec![
                        ContextMenuEntry::Action(ContextMenuAction::new("enum:mode:absolute", "Absolute")),
                        ContextMenuEntry::Action(ContextMenuAction::new("enum:mode:flex", "Flex")),
                        ContextMenuEntry::Action(ContextMenuAction::new("enum:mode:grid", "Grid")),
                    ];
                    ws.update(cx, |this, cx| {
                        this.open_enum_menu(event.position, entries, window, cx)
                    });
                }
            },
        ))
        .when(show_flex || show_grid, |this| {
            let mut this = this;
            if show_flex {
                this = this
                    .child(pair(
                        select_field(
                            theme,
                            "props-stack-direction".into(),
                            "Direction",
                            direction.map(SharedString::from),
                            disabled,
                            {
                                let ws = workspace.clone();
                                move |event, window, cx| {
                                    let entries = vec![
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:direction:row",
                                            "Row",
                                        )),
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:direction:column",
                                            "Column",
                                        )),
                                    ];
                                    ws.update(cx, |this, cx| {
                                        this.open_enum_menu(event.position, entries, window, cx)
                                    });
                                }
                            },
                        ),
                        select_field(
                            theme,
                            "props-stack-align".into(),
                            "Align",
                            align.map(SharedString::from),
                            disabled,
                            {
                                let ws = workspace.clone();
                                move |event, window, cx| {
                                    let entries = vec![
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:align:start",
                                            "Start",
                                        )),
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:align:center",
                                            "Center",
                                        )),
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:align:end",
                                            "End",
                                        )),
                                        ContextMenuEntry::Action(ContextMenuAction::new(
                                            "enum:align:stretch",
                                            "Stretch",
                                        )),
                                    ];
                                    ws.update(cx, |this, cx| {
                                        this.open_enum_menu(event.position, entries, window, cx)
                                    });
                                }
                            },
                        ),
                    ))
                    .child(select_field(
                        theme,
                        "props-stack-justify".into(),
                        "Justify",
                        justify.map(SharedString::from),
                        disabled,
                        {
                            let ws = workspace.clone();
                            move |event, window, cx| {
                                let entries = vec![
                                    ContextMenuEntry::Action(ContextMenuAction::new(
                                        "enum:justify:start",
                                        "Start",
                                    )),
                                    ContextMenuEntry::Action(ContextMenuAction::new(
                                        "enum:justify:center",
                                        "Center",
                                    )),
                                    ContextMenuEntry::Action(ContextMenuAction::new(
                                        "enum:justify:end",
                                        "End",
                                    )),
                                    ContextMenuEntry::Action(ContextMenuAction::new(
                                        "enum:justify:between",
                                        "Between",
                                    )),
                                    ContextMenuEntry::Action(ContextMenuAction::new(
                                        "enum:justify:around",
                                        "Around",
                                    )),
                                ];
                                ws.update(cx, |this, cx| {
                                    this.open_enum_menu(event.position, entries, window, cx)
                                });
                            }
                        },
                    ));
            }
            this.child(pair(
                select_field(
                    theme,
                    "props-stack-wmode".into(),
                    "W Mode",
                    w_mode.map(SharedString::from),
                    disabled,
                    {
                        let ws = workspace.clone();
                        move |event, window, cx| {
                            let entries = vec![
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:wmode:fixed",
                                    "Fixed",
                                )),
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:wmode:hug",
                                    "Hug",
                                )),
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:wmode:fill",
                                    "Fill",
                                )),
                            ];
                            ws.update(cx, |this, cx| {
                                this.open_enum_menu(event.position, entries, window, cx)
                            });
                        }
                    },
                ),
                select_field(
                    theme,
                    "props-stack-hmode".into(),
                    "H Mode",
                    h_mode.map(SharedString::from),
                    disabled,
                    {
                        let ws = workspace.clone();
                        move |event, window, cx| {
                            let entries = vec![
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:hmode:fixed",
                                    "Fixed",
                                )),
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:hmode:hug",
                                    "Hug",
                                )),
                                ContextMenuEntry::Action(ContextMenuAction::new(
                                    "enum:hmode:fill",
                                    "Fill",
                                )),
                            ];
                            ws.update(cx, |this, cx| {
                                this.open_enum_menu(event.position, entries, window, cx)
                            });
                        }
                    },
                ),
            ))
            .child(pair(
                numeric(PropsField::Gap, "Gap", layout.map(|l| l.gap as f64)),
                if show_flex {
                    choice_field(
                        theme,
                        "props-stack-wrap".into(),
                        "Wrap",
                        layout.map(|l| l.wrap),
                        disabled,
                        {
                            let ws = workspace.clone();
                            move |_, _, cx| {
                                ws.update(cx, |this, cx| this.toggle_selection_wrap(cx))
                            }
                        },
                    )
                    .into_any_element()
                } else {
                    numeric(
                        PropsField::Columns,
                        "Cols",
                        layout.map(|l| l.columns as f64),
                    )
                },
            ))
            .child(pair(
                numeric(
                    PropsField::Grow,
                    "Grow",
                    layout.map(|l| l.grow as f64),
                ),
                numeric(
                    PropsField::Shrink,
                    "Shrink",
                    layout.map(|l| l.shrink.unwrap_or(1.0) as f64),
                ),
            ))
            .child(pair(
                numeric(
                    PropsField::PaddingTop,
                    "Pad T",
                    layout.map(|l| l.padding.top as f64),
                ),
                numeric(
                    PropsField::PaddingRight,
                    "Pad R",
                    layout.map(|l| l.padding.right as f64),
                ),
            ))
            .child(pair(
                numeric(
                    PropsField::PaddingBottom,
                    "Pad B",
                    layout.map(|l| l.padding.bottom as f64),
                ),
                numeric(
                    PropsField::PaddingLeft,
                    "Pad L",
                    layout.map(|l| l.padding.left as f64),
                ),
            ))
        })
}
