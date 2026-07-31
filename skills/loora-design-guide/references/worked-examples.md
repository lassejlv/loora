# Worked MCP payload patterns

These examples illustrate structure and sequencing. Replace all design, branch,
Page, node, component, breakpoint, token, and asset IDs with values returned by
the current MCP session. Tool schemas shown by the connected server are
authoritative.

## Contents

- [Create a responsive Page foundation](#create-a-responsive-page-foundation)
- [Add a reusable component and instances](#add-a-reusable-component-and-instances)
- [Patch a section responsively](#patch-a-section-responsively)
- [Add interaction state](#add-interaction-state)
- [Add restrained motion](#add-restrained-motion)
- [Refine through screenshots](#refine-through-screenshots)
- [Complete a branch review](#complete-a-branch-review)

## Create a responsive Page foundation

First define a compact visual system:

`setTokens`

```json
{
  "designId": "DESIGN_ID",
  "themes": [
    { "id": "light", "name": "Light" },
    { "id": "dark", "name": "Dark" }
  ],
  "tokens": [
    {
      "id": "canvas",
      "name": "Canvas",
      "type": "color",
      "value": "#f4f3ef",
      "modes": { "dark": "#151614" }
    },
    {
      "id": "surface",
      "name": "Surface",
      "type": "color",
      "value": "#ffffff",
      "modes": { "dark": "#20221f" }
    },
    {
      "id": "text",
      "name": "Text",
      "type": "color",
      "value": "#1b1d1a",
      "modes": { "dark": "#f1f2ed" }
    },
    {
      "id": "muted",
      "name": "Muted text",
      "type": "color",
      "value": "#686d65",
      "modes": { "dark": "#a8ada4" }
    },
    {
      "id": "accent",
      "name": "Accent",
      "type": "color",
      "value": "#315c49",
      "modes": { "dark": "#77b99a" }
    },
    {
      "id": "border",
      "name": "Border",
      "type": "color",
      "value": "#dcded8",
      "modes": { "dark": "#363a34" }
    }
  ]
}
```

Then create the Page and its first complete hierarchy:

`createPage`

```json
{
  "designId": "DESIGN_ID",
  "name": "Overview",
  "width": 1440,
  "minHeight": 1000,
  "layout": {
    "mode": "flex",
    "direction": "column",
    "align": "stretch",
    "gap": 0
  },
  "style": {
    "fills": [
      { "type": "solid", "color": { "token": "canvas" } }
    ]
  },
  "children": [
    {
      "ref": "header",
      "type": "frame",
      "name": "Primary navigation",
      "semanticTag": "header",
      "layout": {
        "mode": "flex",
        "direction": "row",
        "width": { "unit": "fill" },
        "height": { "unit": "hug" },
        "padding": {
          "top": 20,
          "right": 48,
          "bottom": 20,
          "left": 48
        },
        "align": "center",
        "justify": "space-between"
      },
      "style": {
        "stroke": {
          "color": { "token": "border" },
          "width": 1
        }
      },
      "children": [
        {
          "type": "text",
          "name": "Product wordmark",
          "text": "Northstar",
          "layout": {
            "width": { "unit": "hug" },
            "height": { "unit": "hug" }
          },
          "style": {
            "typography": {
              "family": "Inter",
              "size": 18,
              "weight": 650,
              "lineHeight": 1.2,
              "letterSpacing": -0.3,
              "align": "left"
            },
            "fills": [
              { "type": "solid", "color": { "token": "text" } }
            ]
          }
        },
        {
          "ref": "header-action",
          "type": "frame",
          "name": "New report button",
          "semanticTag": "button",
          "layout": {
            "mode": "flex",
            "direction": "row",
            "width": { "unit": "hug" },
            "height": { "unit": "hug" },
            "padding": {
              "top": 10,
              "right": 16,
              "bottom": 10,
              "left": 16
            },
            "align": "center",
            "justify": "center"
          },
          "style": {
            "fills": [
              { "type": "solid", "color": { "token": "accent" } }
            ],
            "radius": 8
          },
          "children": [
            {
              "type": "text",
              "name": "New report label",
              "text": "New report",
              "layout": {
                "width": { "unit": "hug" },
                "height": { "unit": "hug" }
              },
              "style": {
                "typography": {
                  "family": "Inter",
                  "size": 14,
                  "weight": 600,
                  "lineHeight": 1.2,
                  "letterSpacing": 0,
                  "align": "center"
                },
                "fills": [
                  { "type": "solid", "color": "#ffffff" }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "ref": "main",
      "type": "frame",
      "name": "Overview content",
      "semanticTag": "main",
      "layout": {
        "mode": "flex",
        "direction": "column",
        "width": { "unit": "fill" },
        "height": { "unit": "hug" },
        "gap": 40,
        "padding": {
          "top": 64,
          "right": 48,
          "bottom": 96,
          "left": 48
        },
        "align": "center"
      },
      "children": [
        {
          "type": "frame",
          "name": "Overview heading",
          "layout": {
            "mode": "flex",
            "direction": "column",
            "width": { "unit": "fill" },
            "height": { "unit": "hug" },
            "maxWidth": 1180,
            "gap": 12
          },
          "children": [
            {
              "type": "text",
              "name": "Eyebrow",
              "text": "WEEK 31 · PRODUCT",
              "layout": {
                "width": { "unit": "hug" },
                "height": { "unit": "hug" }
              },
              "style": {
                "typography": {
                  "family": "Inter",
                  "size": 12,
                  "weight": 650,
                  "lineHeight": 1.2,
                  "letterSpacing": 1.1,
                  "align": "left",
                  "transform": "uppercase"
                },
                "fills": [
                  { "type": "solid", "color": { "token": "accent" } }
                ]
              }
            },
            {
              "type": "text",
              "name": "Overview title",
              "text": "The signal is getting clearer.",
              "layout": {
                "width": { "unit": "fill" },
                "height": { "unit": "hug" }
              },
              "style": {
                "typography": {
                  "family": "Inter",
                  "size": 48,
                  "weight": 620,
                  "lineHeight": 1.08,
                  "letterSpacing": -1.8,
                  "align": "left",
                  "wrap": true
                },
                "fills": [
                  { "type": "solid", "color": { "token": "text" } }
                ]
              }
            },
            {
              "type": "text",
              "name": "Overview summary",
              "text": "Activation improved while support volume held steady. Two onboarding moments still need attention.",
              "layout": {
                "width": { "unit": "fill" },
                "height": { "unit": "hug" },
                "maxWidth": 680
              },
              "style": {
                "typography": {
                  "family": "Inter",
                  "size": 17,
                  "weight": 420,
                  "lineHeight": 1.55,
                  "letterSpacing": -0.1,
                  "align": "left",
                  "wrap": true
                },
                "fills": [
                  { "type": "solid", "color": { "token": "muted" } }
                ]
              }
            }
          ]
        },
        {
          "ref": "metrics",
          "type": "frame",
          "name": "Key metrics",
          "layout": {
            "mode": "grid",
            "columns": 3,
            "width": { "unit": "fill" },
            "height": { "unit": "hug" },
            "maxWidth": 1180,
            "gap": 16
          }
        }
      ]
    }
  ]
}
```

Save the returned permanent IDs for `metrics`, `main`, and
`header-action`. Continue by inserting metric cards into the permanent
`metrics` NodeRef.

## Add a reusable component and instances

Create the component:

`createComponent`

```json
{
  "designId": "DESIGN_ID",
  "name": "Metric card",
  "width": 360,
  "height": 180,
  "variants": ["default", "positive", "warning"],
  "layout": {
    "mode": "flex",
    "direction": "column",
    "gap": 18,
    "padding": {
      "top": 24,
      "right": 24,
      "bottom": 24,
      "left": 24
    }
  },
  "style": {
    "fills": [
      { "type": "solid", "color": { "token": "surface" } }
    ],
    "stroke": {
      "color": { "token": "border" },
      "width": 1
    },
    "radius": 12
  },
  "children": [
    {
      "ref": "label",
      "type": "text",
      "name": "Metric label",
      "text": "Activation",
      "layout": {
        "width": { "unit": "fill" },
        "height": { "unit": "hug" }
      },
      "style": {
        "typography": {
          "family": "Inter",
          "size": 13,
          "weight": 550,
          "lineHeight": 1.3,
          "letterSpacing": 0,
          "align": "left"
        },
        "fills": [
          { "type": "solid", "color": { "token": "muted" } }
        ]
      }
    },
    {
      "ref": "value",
      "type": "text",
      "name": "Metric value",
      "text": "68.4%",
      "layout": {
        "width": { "unit": "fill" },
        "height": { "unit": "hug" }
      },
      "style": {
        "typography": {
          "family": "Inter",
          "size": 36,
          "weight": 620,
          "lineHeight": 1,
          "letterSpacing": -1.2,
          "align": "left"
        },
        "fills": [
          { "type": "solid", "color": { "token": "text" } }
        ]
      }
    }
  ]
}
```

The returned variant names are only identities until their source-node
overrides are defined. For example:

`patchNodes`

```json
{
  "designId": "DESIGN_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "METRIC_COMPONENT_ID",
        "instancePath": []
      },
      "patch": {
        "variantOverrides": {
          "positive": {
            "METRIC_VALUE_SOURCE_ID": {
              "style": {
                "fills": [
                  {
                    "type": "solid",
                    "color": {
                      "token": "accent"
                    }
                  }
                ]
              }
            }
          },
          "warning": {
            "METRIC_VALUE_SOURCE_ID": {
              "style": {
                "fills": [
                  {
                    "type": "solid",
                    "color": "#a85d22"
                  }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

Create three instances with separate `createInstance` calls, or include
instance descriptors in a coherent insertion when the component ID already
exists. Then patch the component descendants through instance NodeRefs returned
by `readTree`:

`patchNodes`

```json
{
  "designId": "DESIGN_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "METRIC_LABEL_SOURCE_ID",
        "instancePath": ["SECOND_INSTANCE_ID"]
      },
      "patch": { "text": "Weekly retention" }
    },
    {
      "ref": {
        "nodeId": "METRIC_VALUE_SOURCE_ID",
        "instancePath": ["SECOND_INSTANCE_ID"]
      },
      "patch": { "text": "42.7%" }
    }
  ]
}
```

Do not try to insert children into `SECOND_INSTANCE_ID`.

## Patch a section responsively

Read the real breakpoint ID from `getDesignContext`, then patch the grid and
outer Page frame:

`patchNodes`

```json
{
  "designId": "DESIGN_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "METRICS_FRAME_ID",
        "instancePath": []
      },
      "patch": {
        "responsive": {
          "MOBILE_BREAKPOINT_ID": {
            "layout": {
              "columns": 1,
              "gap": 12
            }
          }
        }
      }
    },
    {
      "ref": {
        "nodeId": "MAIN_FRAME_ID",
        "instancePath": []
      },
      "patch": {
        "responsive": {
          "MOBILE_BREAKPOINT_ID": {
            "layout": {
              "gap": 28,
              "padding": {
                "top": 36,
                "right": 20,
                "bottom": 64,
                "left": 20
              }
            }
          }
        }
      }
    },
    {
      "ref": {
        "nodeId": "TITLE_ID",
        "instancePath": []
      },
      "patch": {
        "responsive": {
          "MOBILE_BREAKPOINT_ID": {
            "style": {
              "typography": {
                "family": "Inter",
                "size": 36,
                "weight": 620,
                "lineHeight": 1.1,
                "letterSpacing": -1.2,
                "align": "left",
                "wrap": true
              }
            }
          }
        }
      }
    }
  ]
}
```

Render the Page at 1440 and a narrow width. A schema-valid responsive patch can
still produce cramped or overflowing pixels.

## Add interaction state

Add state to the Page and wire a control:

`patchNodes`

```json
{
  "designId": "DESIGN_ID",
  "changes": [
    {
      "ref": {
        "nodeId": "PAGE_ID",
        "instancePath": []
      },
      "patch": {
        "states": {
          "detailsOpen": {
            "id": "detailsOpen",
            "name": "Details open",
            "type": "boolean",
            "initial": false
          }
        }
      }
    },
    {
      "ref": {
        "nodeId": "DETAILS_BUTTON_ID",
        "instancePath": []
      },
      "patch": {
        "interactions": [
          {
            "trigger": "click",
            "actions": [
              {
                "type": "toggle-state",
                "stateId": "detailsOpen"
              },
              {
                "type": "visibility",
                "nodeId": "DETAILS_PANEL_ID",
                "value": "toggle"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

Use `readNode` afterward to verify the state record and interactions. Do not
guess the details panel ID from its name.

## Add restrained motion

Define once:

`setAnimations`

```json
{
  "designId": "DESIGN_ID",
  "presets": ["fade-in-up"]
}
```

Apply to the actual refs in visual order:

`animateNodes`

```json
{
  "designId": "DESIGN_ID",
  "refs": [
    { "nodeId": "CARD_1_ID", "instancePath": [] },
    { "nodeId": "CARD_2_ID", "instancePath": [] },
    { "nodeId": "CARD_3_ID", "instancePath": [] }
  ],
  "play": [
    {
      "animationId": "fade-in-up",
      "trigger": "in-view",
      "once": true
    }
  ],
  "hover": "lift",
  "stagger": 60
}
```

Avoid adding this before inspecting the static cards.

## Refine through screenshots

Render:

`getScreenshot`

```json
{
  "designId": "DESIGN_ID",
  "pageId": "PAGE_ID",
  "width": 1440,
  "pixelRatio": 1
}
```

Suppose the screenshot shows a weak title, over-wide body copy, and cards that
blend into the background. Fix those related issues in one `patchNodes` call,
then render again. Do not rebuild the Page or apply random decoration.

Render narrow:

```json
{
  "designId": "DESIGN_ID",
  "pageId": "PAGE_ID",
  "width": 390,
  "pixelRatio": 2
}
```

Check both the PNG and `skippedImages`. Finish by calling `viewPage` to return
the canonical editor URL.

## Complete a branch review

Compare:

`compareBranch`

```json
{
  "designId": "DESIGN_ID",
  "draftId": "BRANCH_ID"
}
```

If the user authorizes application and conflicts are understood:

`applyBranch`

```json
{
  "designId": "DESIGN_ID",
  "draftId": "BRANCH_ID",
  "expectedMainRevision": 14,
  "expectedDraftRevision": 9,
  "resolutions": {
    "CONFLICT_ID_FROM_COMPARE": "draft"
  }
}
```

Use the revisions and conflict IDs from the immediately preceding comparison.
If the call says either target changed, compare again. Do not automatically
choose `"draft"` for every conflict; explain consequential choices.
