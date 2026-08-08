use crate::extras::{
    Interaction, NodeAnimation, OverrideMap, ResponsiveMap, Transition, VectorPath, VisualStates,
};
use crate::id::NodeId;
use crate::model::{Layout, Node, Style, Typography};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NodePatch {
    pub name: Option<String>,
    pub hidden: Option<bool>,
    pub locked: Option<bool>,
    pub layout: Option<Layout>,
    pub style: Option<Style>,
    pub order: Option<f64>,
    pub text: Option<String>,
    pub font_size: Option<f32>,
    pub typography: Option<Option<Typography>>,
    pub image_path: Option<Option<String>>,
    pub rotation: Option<f32>,
    pub responsive: Option<ResponsiveMap>,
    pub visual_states: Option<Option<VisualStates>>,
    pub transition: Option<Option<Transition>>,
    pub animations: Option<Vec<NodeAnimation>>,
    pub interactions: Option<Vec<Interaction>>,
    pub component_id: Option<Option<String>>,
    pub variant: Option<Option<String>>,
    pub overrides: Option<OverrideMap>,
    pub paths: Option<Vec<VectorPath>>,
    pub component_variants: Option<Vec<String>>,
    pub variant_overrides: Option<std::collections::HashMap<String, OverrideMap>>,
    pub origin_id: Option<Option<String>>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    Insert {
        node: Node,
    },
    Patch {
        id: NodeId,
        patch: NodePatch,
    },
    Move {
        id: NodeId,
        parent_id: Option<NodeId>,
        order: f64,
    },
    Delete {
        id: NodeId,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Transaction {
    pub id: String,
    pub label: String,
    pub operations: Vec<Operation>,
    pub coalesce_key: Option<String>,
}

impl Transaction {
    pub fn new(label: impl Into<String>, operations: Vec<Operation>) -> Self {
        Self {
            id: NodeId::new("tx").to_string(),
            label: label.into(),
            operations,
            coalesce_key: None,
        }
    }

    pub fn with_coalesce_key(mut self, key: impl Into<String>) -> Self {
        self.coalesce_key = Some(key.into());
        self
    }
}
