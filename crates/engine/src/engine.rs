use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::hit::{Bounds, Vec2};
use crate::id::NodeId;
use crate::model::{
    Color, Corners, Document, FlexDirection, Layout, LayoutAlign, LayoutJustify, LayoutMode,
    LayoutPosition, Node, NodeKind, Overflow, Paint, Shadow, SizeMode, Stroke, Style, Typography,
    DEFAULT_ORDER_STEP,
};
use crate::ops::{NodePatch, Operation, Transaction};

const COALESCE_WINDOW: Duration = Duration::from_millis(750);
const DEFAULT_HISTORY_MAX: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    NodeExists(String),
    NodeMissing(String),
    InvalidParent(String),
    Cycle,
    EmptyTransaction,
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NodeExists(id) => write!(f, "node already exists: {id}"),
            Self::NodeMissing(id) => write!(f, "node missing: {id}"),
            Self::InvalidParent(msg) => write!(f, "invalid parent: {msg}"),
            Self::Cycle => write!(f, "hierarchy cycle"),
            Self::EmptyTransaction => write!(f, "empty transaction"),
        }
    }
}

impl std::error::Error for EngineError {}

#[derive(Clone, Debug)]
struct HistoryEntry {
    inverse: Transaction,
    coalesce_key: Option<String>,
    timestamp: Instant,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ApplyOptions {
    pub record_history: bool,
}

impl ApplyOptions {
    pub fn with_history() -> Self {
        Self {
            record_history: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ApplyResult {
    pub changed_node_ids: HashSet<NodeId>,
    pub inverse: Transaction,
    pub idempotent: bool,
}

pub struct CanvasEngine {
    document: Document,
    children: HashMap<Option<NodeId>, Vec<NodeId>>,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    revision: u64,
    applied_ids: HashSet<String>,
}

impl CanvasEngine {
    pub fn new(document: Document) -> Self {
        let mut engine = Self {
            document,
            children: HashMap::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            applied_ids: HashSet::new(),
        };
        engine.rebuild_indexes();
        engine
    }

    pub fn demo() -> Self {
        Self::new(crate::model::demo_document())
    }

    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn into_document(self) -> Document {
        self.document
    }

    /// Resolve the same cascading breakpoint patches as the web Canvas V2
    /// renderer, then recompute relative sizes and stacks for that viewport.
    pub fn resolved_document_at_width(&self, width: f64) -> Document {
        let mut document = self.document.clone();
        let mut breakpoints = document.breakpoints.clone();
        breakpoints.sort_by(|left, right| left.min_width.total_cmp(&right.min_width));
        let source_nodes = document.nodes.clone();

        for (id, source) in &source_nodes {
            let mut resolved = source.clone();
            for breakpoint in &breakpoints {
                if breakpoint.min_width > width {
                    break;
                }
                if let Some(patch) = source.responsive.get(&breakpoint.id) {
                    resolved = resolved.apply_override_patch(patch);
                }
            }
            document.nodes.insert(id.clone(), resolved);
        }

        let mut page_ids: Vec<NodeId> = document
            .nodes
            .values()
            .filter(|node| node.kind == NodeKind::Page)
            .map(|node| node.id.clone())
            .collect();
        page_ids.sort_by(|left, right| {
            let left = document.nodes.get(left).map(|node| node.order).unwrap_or(0.0);
            let right = document.nodes.get(right).map(|node| node.order).unwrap_or(0.0);
            left.total_cmp(&right)
        });
        let mut x = 0.0;
        for id in &page_ids {
            if let Some(page) = document.nodes.get_mut(id) {
                page.layout.x = x;
                page.layout.width = width.max(1.0);
                page.layout.width_mode = SizeMode::Fixed;
                page.layout.width_percent = None;
                if let Some(viewport) = page.viewport {
                    page.layout.height = page.layout.height.max(viewport.min_height);
                }
                x += page.layout.width + 200.0;
            }
        }

        let mut engine = Self::new(document);
        engine.resolve_relative_sizes();
        // Nested hug/fill stacks need a bottom-up pass and then one final
        // relative pass after their parents have settled.
        engine.resolve_all_stacks();
        engine.resolve_relative_sizes();
        engine.resolve_all_stacks();
        engine.document
    }

    pub fn replace_document(&mut self, document: Document) {
        self.document = document;
        self.undo.clear();
        self.redo.clear();
        self.applied_ids.clear();
        self.rebuild_indexes();
        self.revision += 1;
    }

    fn resolve_relative_sizes(&mut self) {
        let roots: Vec<NodeId> = self
            .document
            .nodes
            .values()
            .filter(|node| node.parent_id.is_none())
            .map(|node| node.id.clone())
            .collect();
        for root in roots {
            self.resolve_relative_sizes_under(&root);
        }
    }

    fn resolve_relative_sizes_under(&mut self, parent_id: &NodeId) {
        let Some(parent) = self.node(parent_id).cloned() else {
            return;
        };
        let inner_width = (parent.layout.width
            - parent.layout.padding.left as f64
            - parent.layout.padding.right as f64)
            .max(1.0);
        let inner_height = (parent.layout.height
            - parent.layout.padding.top as f64
            - parent.layout.padding.bottom as f64)
            .max(1.0);
        let child_ids: Vec<NodeId> = self
            .children(Some(parent_id))
            .into_iter()
            .map(|node| node.id.clone())
            .collect();

        for child_id in &child_ids {
            let Some(child) = self.node(child_id).cloned() else {
                continue;
            };
            let mut layout = child.layout.clone();
            if layout.width_mode == SizeMode::Percent {
                if let Some(percent) = layout.width_percent {
                    layout.width = inner_width * percent / 100.0;
                }
            } else if layout.width_mode == SizeMode::Fill
                && (parent.layout.mode == LayoutMode::Absolute
                    || layout.position == LayoutPosition::Absolute)
            {
                layout.width = inner_width;
            }
            if layout.height_mode == SizeMode::Percent {
                if let Some(percent) = layout.height_percent {
                    layout.height = inner_height * percent / 100.0;
                }
            } else if layout.height_mode == SizeMode::Fill
                && (parent.layout.mode == LayoutMode::Absolute
                    || layout.position == LayoutPosition::Absolute)
            {
                layout.height = inner_height;
            }
            let (width, height) = layout.clamp_size(layout.width, layout.height);
            layout.width = width;
            layout.height = height;
            if layout != child.layout {
                if let Some(node) = self.document.nodes.get_mut(child_id) {
                    node.layout = layout;
                }
            }
            self.resolve_relative_sizes_under(child_id);
        }
    }

    pub fn set_name(&mut self, name: impl Into<String>) {
        self.document.name = name.into();
        self.revision += 1;
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn node(&self, id: &NodeId) -> Option<&Node> {
        self.document.nodes.get(id)
    }

    pub fn children(&self, parent_id: Option<&NodeId>) -> Vec<&Node> {
        let key = parent_id.cloned();
        self.children
            .get(&key)
            .into_iter()
            .flatten()
            .filter_map(|id| self.document.nodes.get(id))
            .collect()
    }

    pub fn root_page_id(&self) -> &NodeId {
        &self.document.root_page_id
    }

    /// Switch the active page (used for paste/drop targets and page chrome).
    pub fn set_root_page(&mut self, page_id: &NodeId) -> Result<(), EngineError> {
        let Some(node) = self.node(page_id) else {
            return Err(EngineError::NodeMissing(page_id.to_string()));
        };
        if node.kind != NodeKind::Page {
            return Err(EngineError::InvalidParent("not a page".into()));
        }
        if &self.document.root_page_id == page_id {
            return Ok(());
        }
        self.document.root_page_id = page_id.clone();
        self.revision += 1;
        Ok(())
    }

    /// Sorted page ids (stable order).
    pub fn page_ids(&self) -> Vec<NodeId> {
        let mut pages: Vec<NodeId> = self
            .document
            .nodes
            .values()
            .filter(|n| n.kind == NodeKind::Page)
            .map(|n| n.id.clone())
            .collect();
        pages.sort_by(|a, b| {
            let ao = self.node(a).map(|n| n.order).unwrap_or(0.0);
            let bo = self.node(b).map(|n| n.order).unwrap_or(0.0);
            ao.partial_cmp(&bo)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.as_str().cmp(b.as_str()))
        });
        pages
    }

    /// Component masters in the document.
    pub fn component_nodes(&self) -> Vec<&Node> {
        let mut comps: Vec<&Node> = self
            .document
            .nodes
            .values()
            .filter(|n| n.kind == NodeKind::Component)
            .collect();
        comps.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.as_str().cmp(b.id.as_str())));
        comps
    }

    /// Absolute world-space bounds by walking parent offsets.
    pub fn absolute_bounds(&self, id: &NodeId) -> Option<Bounds> {
        let node = self.node(id)?;
        let mut x = node.layout.x;
        let mut y = node.layout.y;
        let mut current = node.parent_id.clone();
        while let Some(parent_id) = current {
            let parent = self.node(&parent_id)?;
            x += parent.layout.x;
            y += parent.layout.y;
            current = parent.parent_id.clone();
        }
        Some(Bounds::new(x, y, node.layout.width, node.layout.height))
    }

    /// Frontmost unlocked + visible node under a world point.
    /// Empty space inside a page selects that page.
    pub fn hit_test(&self, world: Vec2) -> Option<NodeId> {
        let mut pages: Vec<NodeId> = self
            .document
            .nodes
            .values()
            .filter(|n| n.kind == NodeKind::Page)
            .map(|n| n.id.clone())
            .collect();
        pages.sort_by(|a, b| {
            let ao = self.node(a).map(|n| n.order).unwrap_or(0.0);
            let bo = self.node(b).map(|n| n.order).unwrap_or(0.0);
            bo.partial_cmp(&ao)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.as_str().cmp(a.as_str()))
        });
        for page_id in &pages {
            if let Some(hit) = self.hit_test_recursive(page_id, world) {
                return Some(hit);
            }
        }
        // Click on empty artboard / page chrome → select the page.
        for page_id in &pages {
            if let Some(bounds) = self.absolute_bounds(page_id) {
                if bounds.contains(world) {
                    return Some(page_id.clone());
                }
            }
        }
        None
    }

    /// Page whose bounds contain `world`, if any (frontmost by order).
    pub fn page_at(&self, world: Vec2) -> Option<NodeId> {
        let mut pages = self.page_ids();
        pages.reverse();
        for page_id in pages {
            if let Some(bounds) = self.absolute_bounds(&page_id) {
                if bounds.contains(world) {
                    return Some(page_id);
                }
            }
        }
        None
    }

    fn hit_test_recursive(&self, parent_id: &NodeId, world: Vec2) -> Option<NodeId> {
        let kids = self.children(Some(parent_id));
        // Front to back: highest order first.
        for child in kids.into_iter().rev() {
            if child.hidden {
                continue;
            }
            if let Some(hit) = self.hit_test_recursive(&child.id, world) {
                return Some(hit);
            }
            if child.locked {
                continue;
            }
            if let Some(bounds) = self.absolute_bounds(&child.id) {
                if bounds.contains(world) {
                    return Some(child.id.clone());
                }
            }
        }
        None
    }

    pub fn apply(
        &mut self,
        transaction: Transaction,
        options: ApplyOptions,
    ) -> Result<ApplyResult, EngineError> {
        if transaction.operations.is_empty() {
            return Err(EngineError::EmptyTransaction);
        }
        if self.applied_ids.contains(&transaction.id) {
            return Ok(ApplyResult {
                changed_node_ids: HashSet::new(),
                inverse: Transaction::new(format!("Already applied {}", transaction.label), vec![]),
                idempotent: true,
            });
        }

        let (document, inverse_ops, changed) =
            apply_transaction(&self.document, &transaction.operations)?;
        let inverse = Transaction {
            id: format!("{}:inverse", transaction.id),
            label: format!("Undo {}", transaction.label),
            operations: inverse_ops,
            coalesce_key: transaction.coalesce_key.clone(),
        };

        self.document = document;
        self.rebuild_indexes();
        self.revision += 1;
        self.applied_ids.insert(transaction.id.clone());

        if options.record_history {
            let now = Instant::now();
            if let (Some(key), Some(prev)) =
                (transaction.coalesce_key.as_ref(), self.undo.last_mut())
            {
                if prev.coalesce_key.as_ref() == Some(key)
                    && now.duration_since(prev.timestamp) <= COALESCE_WINDOW
                {
                    // Keep oldest inverse ops; prepend new inverse so undo restores furthest.
                    let mut merged = inverse.operations.clone();
                    merged.extend(prev.inverse.operations.clone());
                    prev.inverse.operations = merged;
                    prev.timestamp = now;
                    self.redo.clear();
                    return Ok(ApplyResult {
                        changed_node_ids: changed,
                        inverse,
                        idempotent: false,
                    });
                }
            }
            self.undo.push(HistoryEntry {
                inverse,
                coalesce_key: transaction.coalesce_key.clone(),
                timestamp: now,
            });
            if self.undo.len() > DEFAULT_HISTORY_MAX {
                self.undo.remove(0);
            }
            self.redo.clear();
        }

        Ok(ApplyResult {
            changed_node_ids: changed,
            inverse: Transaction::new("unused", vec![]),
            idempotent: false,
        })
    }

    pub fn undo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.undo.pop() else {
            return Ok(false);
        };
        let (document, inverse_ops, _) =
            apply_transaction(&self.document, &entry.inverse.operations)?;
        self.document = document;
        self.rebuild_indexes();
        self.revision += 1;
        self.redo.push(HistoryEntry {
            inverse: Transaction {
                id: NodeId::new("redo").to_string(),
                label: "Redo".into(),
                operations: inverse_ops,
                coalesce_key: entry.coalesce_key,
            },
            coalesce_key: None,
            timestamp: Instant::now(),
        });
        Ok(true)
    }

    pub fn redo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.redo.pop() else {
            return Ok(false);
        };
        let (document, inverse_ops, _) =
            apply_transaction(&self.document, &entry.inverse.operations)?;
        self.document = document;
        self.rebuild_indexes();
        self.revision += 1;
        self.undo.push(HistoryEntry {
            inverse: Transaction {
                id: NodeId::new("undo").to_string(),
                label: "Undo".into(),
                operations: inverse_ops,
                coalesce_key: None,
            },
            coalesce_key: None,
            timestamp: Instant::now(),
        });
        Ok(true)
    }

    pub fn move_nodes(
        &mut self,
        ids: &[NodeId],
        dx: f64,
        dy: f64,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let mut ops = Vec::new();
        for id in ids {
            let Some(node) = self.node(id) else {
                continue;
            };
            if node.locked || node.kind == NodeKind::Page {
                continue;
            }
            let mut layout = node.layout.clone();
            layout.x += dx;
            layout.y += dy;
            ops.push(Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            });
        }
        if ops.is_empty() {
            return Ok(());
        }
        let mut tx = Transaction::new("Move", ops);
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        }
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Set a node's world-space bounds (converted to parent-local layout).
    pub fn set_world_bounds(
        &mut self,
        id: &NodeId,
        world: Bounds,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let parent_origin = match &node.parent_id {
            Some(parent_id) => {
                self.absolute_bounds(parent_id)
                    .map(|b| Vec2::new(b.x, b.y))
                    .unwrap_or(Vec2::new(0.0, 0.0))
            }
            _ => Vec2::new(0.0, 0.0),
        };
        self.set_world_bounds_from_parent_origin(id, world, parent_origin, coalesce_key)
    }

    /// Commit browser-rendered bounds using the browser's computed parent
    /// origin. This keeps DOM-driven edits stable even when flex/grid/font
    /// layout puts the parent somewhere different from the engine estimate.
    pub fn set_world_bounds_from_parent_origin(
        &mut self,
        id: &NodeId,
        world: Bounds,
        parent_origin: Vec2,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        self.set_rendered_world_bounds(
            id,
            world,
            parent_origin,
            false,
            coalesce_key,
        )
    }

    /// Commit browser-rendered bounds. Leading-edge resizing of an in-flow
    /// node must extract it to absolute positioning; otherwise flex/grid
    /// ignores the new x/y and the node jumps when the preview is replaced.
    pub fn set_rendered_world_bounds(
        &mut self,
        id: &NodeId,
        world: Bounds,
        parent_origin: Vec2,
        extract_from_flow: bool,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.locked {
            return Ok(());
        }

        // Page artboards are the editor viewport itself. Imported viewport
        // `minHeight` values describe the initial responsive canvas, not a
        // permanent resize constraint. Treat a direct page resize as explicit
        // geometry so an old viewport minimum cannot make the artboard snap
        // back under the pointer.
        let (width, height) = if node.kind == NodeKind::Page {
            (world.width.max(1.0), world.height.max(1.0))
        } else {
            node.layout.clamp_size(world.width, world.height)
        };
        let mut layout = node.layout.clone();
        layout.x = world.x - parent_origin.x;
        layout.y = world.y - parent_origin.y;
        layout.width = width;
        layout.height = height;
        // A direct resize is an explicit size. Leaving a node as hug/fill made
        // the next stack pass silently undo the user's drag, most visibly for
        // imported hug-height pages.
        layout.width_mode = SizeMode::Fixed;
        layout.height_mode = SizeMode::Fixed;
        layout.width_percent = None;
        layout.height_percent = None;
        if extract_from_flow && node.kind != NodeKind::Page {
            layout.position = LayoutPosition::Absolute;
        }
        if node.kind == NodeKind::Page {
            layout.min_width = None;
            layout.max_width = None;
            layout.min_height = None;
            layout.max_height = None;
            layout.aspect_ratio = None;
        }
        let mut tx = Transaction::new(
            "Resize",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        }
        self.apply(tx, ApplyOptions::with_history())?;
        let _ = self.resolve_stack(id);
        if let Some(parent) = self.node(id).and_then(|n| n.parent_id.clone()) {
            let _ = self.resolve_stack(&parent);
        }
        Ok(())
    }

    /// Move a node in world space without turning hug/fill sizing into fixed
    /// sizing. Flow children become absolute when pulled freely from a stack so
    /// the stack resolver cannot snap them back under the pointer.
    pub fn set_world_position(
        &mut self,
        id: &NodeId,
        world: Vec2,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let parent_origin = match &node.parent_id {
            Some(parent_id) => {
                self.absolute_bounds(parent_id)
                    .map(|bounds| Vec2::new(bounds.x, bounds.y))
                    .unwrap_or(Vec2::new(0.0, 0.0))
            }
            _ => Vec2::new(0.0, 0.0),
        };
        self.set_world_position_from_parent_origin(id, world, parent_origin, coalesce_key)
    }

    /// Commit a browser-rendered position relative to the browser's computed
    /// parent origin instead of an approximate engine layout origin.
    pub fn set_world_position_from_parent_origin(
        &mut self,
        id: &NodeId,
        world: Vec2,
        parent_origin: Vec2,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.locked {
            return Ok(());
        }

        let mut layout = node.layout.clone();
        layout.x = world.x - parent_origin.x;
        layout.y = world.y - parent_origin.y;
        if node.kind != NodeKind::Page && layout.position == LayoutPosition::Flow {
            layout.position = LayoutPosition::Absolute;
            layout.width_mode = SizeMode::Fixed;
            layout.height_mode = SizeMode::Fixed;
            layout.width_percent = None;
            layout.height_percent = None;
        }

        let mut transaction = Transaction::new(
            "Move",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            transaction = transaction.with_coalesce_key(key);
        }
        self.apply(transaction, ApplyOptions::with_history())?;
        if let Some(parent) = self.node(id).and_then(|current| current.parent_id.clone()) {
            let _ = self.resolve_stack(&parent);
        }
        Ok(())
    }

    /// Reparent `id` under `new_parent`, preserving world-space position.
    pub fn reparent_keep_world(
        &mut self,
        id: &NodeId,
        new_parent: &NodeId,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Err(EngineError::InvalidParent("cannot reparent page".into()));
        }
        if node.parent_id.as_ref() == Some(new_parent) {
            return Ok(());
        }
        let Some(world) = self.absolute_bounds(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };

        let parent = self
            .absolute_bounds(new_parent)
            .ok_or_else(|| EngineError::NodeMissing(new_parent.to_string()))?;
        let parent_origin = Vec2::new(parent.x, parent.y);

        self.reparent_from_rendered_position(
            id,
            new_parent,
            Vec2::new(world.x, world.y),
            parent_origin,
        )
    }

    /// Reparent a node using browser-computed world and parent positions.
    /// Browser layout is authoritative for DOM drag/drop, so this avoids a
    /// second coordinate conversion through approximate engine bounds.
    pub fn reparent_from_rendered_position(
        &mut self,
        id: &NodeId,
        new_parent: &NodeId,
        world: Vec2,
        parent_origin: Vec2,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Err(EngineError::InvalidParent("cannot reparent page".into()));
        }
        if self.node(new_parent).is_none() {
            return Err(EngineError::NodeMissing(new_parent.to_string()));
        }
        if node.parent_id.as_ref() == Some(new_parent) {
            return Ok(());
        }

        let mut layout = node.layout.clone();
        layout.x = world.x - parent_origin.x;
        layout.y = world.y - parent_origin.y;
        if layout.position == LayoutPosition::Flow {
            layout.position = LayoutPosition::Absolute;
            layout.width_mode = SizeMode::Fixed;
            layout.height_mode = SizeMode::Fixed;
            layout.width_percent = None;
            layout.height_percent = None;
        }
        let order = self.next_order(Some(new_parent));

        let tx = Transaction::new(
            "Reparent",
            vec![
                Operation::Move {
                    id: id.clone(),
                    parent_id: Some(new_parent.clone()),
                    order,
                },
                Operation::Patch {
                    id: id.clone(),
                    patch: NodePatch {
                        layout: Some(layout),
                        ..NodePatch::default()
                    },
                },
            ],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Deepest container under `world` that can hold children (frame), excluding `exclude`.
    pub fn drop_target_at(&self, world: Vec2, exclude: Option<&NodeId>) -> NodeId {
        // Prefer a hit on any page's tree; fall back to the active root page.
        for page in self.page_ids().into_iter().rev() {
            if let Some(target) = self.find_drop_target(&page, world, exclude) {
                return target;
            }
            if let Some(bounds) = self.absolute_bounds(&page) {
                if bounds.contains(world) {
                    return page;
                }
            }
        }
        self.root_page_id().clone()
    }

    fn find_drop_target(
        &self,
        parent_id: &NodeId,
        world: Vec2,
        exclude: Option<&NodeId>,
    ) -> Option<NodeId> {
        for child in self.children(Some(parent_id)).into_iter().rev() {
            if exclude == Some(&child.id) || child.hidden || !child.is_container() {
                continue;
            }
            if let Some(nested) = self.find_drop_target(&child.id, world, exclude) {
                return Some(nested);
            }
            if let Some(bounds) = self.absolute_bounds(&child.id) {
                if bounds.contains(world) {
                    return Some(child.id.clone());
                }
            }
        }
        None
    }

    pub fn set_hidden(&mut self, id: &NodeId, hidden: bool) -> Result<(), EngineError> {
        let tx = Transaction::new(
            if hidden { "Hide" } else { "Show" },
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    hidden: Some(hidden),
                    ..NodePatch::default()
                },
            }],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_locked(&mut self, id: &NodeId, locked: bool) -> Result<(), EngineError> {
        let tx = Transaction::new(
            if locked { "Lock" } else { "Unlock" },
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    locked: Some(locked),
                    ..NodePatch::default()
                },
            }],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn insert_rectangle(
        &mut self,
        parent_id: &NodeId,
        name: impl Into<String>,
        layout: crate::model::Layout,
    ) -> Result<NodeId, EngineError> {
        let order = self.next_order(Some(parent_id));
        let mut node = Node::rectangle(name, parent_id.clone(), layout);
        node.order = order;
        let id = node.id.clone();
        let tx = Transaction::new("Add rectangle", vec![Operation::Insert { node }]);
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(id)
    }

    pub fn next_order(&self, parent_id: Option<&NodeId>) -> f64 {
        let max = self
            .children(parent_id)
            .into_iter()
            .map(|n| n.order)
            .fold(0.0_f64, f64::max);
        max + DEFAULT_ORDER_STEP
    }

    /// Delete `id` and its descendants. Pages cannot be deleted.
    pub fn delete_node(&mut self, id: &NodeId) -> Result<(), EngineError> {
        let Some(node) = self.node(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Err(EngineError::InvalidParent("cannot delete page".into()));
        }
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let tx = Transaction::new("Delete", vec![Operation::Delete { id: id.clone() }]);
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Raise `id` above its siblings so it paints and hit-tests on top.
    pub fn bring_to_front(&mut self, id: &NodeId) -> Result<(), EngineError> {
        self.stack_bring_to_front(id, false)
    }

    /// User-facing bring-to-front (undoable).
    pub fn bring_to_front_history(&mut self, id: &NodeId) -> Result<(), EngineError> {
        self.stack_bring_to_front(id, true)
    }

    fn stack_bring_to_front(&mut self, id: &NodeId, history: bool) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Ok(());
        }
        let parent = node.parent_id.clone();
        let siblings = self.children(parent.as_ref());
        if siblings.last().map(|n| &n.id) == Some(id) {
            return Ok(());
        }
        let order = self.next_order(parent.as_ref());
        let tx = Transaction::new(
            "Bring to front",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    order: Some(order),
                    ..NodePatch::default()
                },
            }],
        );
        let opts = if history {
            ApplyOptions::with_history()
        } else {
            ApplyOptions::default()
        };
        self.apply(tx, opts)?;
        Ok(())
    }

    /// Send `id` behind all siblings (undoable).
    pub fn send_to_back(&mut self, id: &NodeId) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Ok(());
        }
        let parent = node.parent_id.clone();
        let siblings = self.children(parent.as_ref());
        if siblings.first().map(|n| &n.id) == Some(id) {
            return Ok(());
        }
        let min = siblings
            .iter()
            .map(|n| n.order)
            .fold(f64::INFINITY, f64::min);
        let order = if min.is_finite() {
            min - DEFAULT_ORDER_STEP
        } else {
            DEFAULT_ORDER_STEP
        };
        let tx = Transaction::new(
            "Send to back",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    order: Some(order),
                    ..NodePatch::default()
                },
            }],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Swap `id` one step toward the front among siblings (undoable).
    pub fn bring_forward(&mut self, id: &NodeId) -> Result<(), EngineError> {
        self.nudge_stack(id, 1)
    }

    /// Swap `id` one step toward the back among siblings (undoable).
    pub fn send_backward(&mut self, id: &NodeId) -> Result<(), EngineError> {
        self.nudge_stack(id, -1)
    }

    fn nudge_stack(&mut self, id: &NodeId, dir: i32) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind == NodeKind::Page {
            return Ok(());
        }
        let parent = node.parent_id.clone();
        let siblings: Vec<NodeId> = self
            .children(parent.as_ref())
            .into_iter()
            .map(|n| n.id.clone())
            .collect();
        let Some(idx) = siblings.iter().position(|s| s == id) else {
            return Ok(());
        };
        let target = idx as i32 + dir;
        if target < 0 || target as usize >= siblings.len() {
            return Ok(());
        }
        let other = &siblings[target as usize];
        let Some(other_node) = self.node(other).cloned() else {
            return Ok(());
        };
        let tx = Transaction::new(
            if dir > 0 {
                "Bring forward"
            } else {
                "Send backward"
            },
            vec![
                Operation::Patch {
                    id: id.clone(),
                    patch: NodePatch {
                        order: Some(other_node.order),
                        ..NodePatch::default()
                    },
                },
                Operation::Patch {
                    id: other.clone(),
                    patch: NodePatch {
                        order: Some(node.order),
                        ..NodePatch::default()
                    },
                },
            ],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Duplicate `ids` (and their descendants). Roots are offset by `offset`.
    /// Returns the new root ids in the same order as `ids`.
    pub fn duplicate_nodes(
        &mut self,
        ids: &[NodeId],
        offset: Vec2,
    ) -> Result<Vec<NodeId>, EngineError> {
        let mut ops = Vec::new();
        let mut new_roots = Vec::new();
        let mut used_ids: HashSet<NodeId> = HashSet::new();

        for root in ids {
            let Some(root_node) = self.node(root) else {
                continue;
            };
            if root_node.kind == NodeKind::Page || root_node.locked {
                continue;
            }
            let subtree = self.collect_subtree(root);
            let mut id_map: HashMap<NodeId, NodeId> = HashMap::new();
            for old_id in &subtree {
                let prefix = old_id
                    .as_str()
                    .split('_')
                    .next()
                    .unwrap_or("node");
                let mut new_id = NodeId::new(prefix);
                // Extremely unlikely, but keep insert valid.
                while self.document.nodes.contains_key(&new_id) || used_ids.contains(&new_id) {
                    new_id = NodeId::new(prefix);
                }
                used_ids.insert(new_id.clone());
                id_map.insert(old_id.clone(), new_id);
            }

            let new_root = id_map.get(root).cloned().unwrap();
            new_roots.push(new_root.clone());

            for old_id in &subtree {
                let Some(src) = self.node(old_id).cloned() else {
                    continue;
                };
                let mut clone = src;
                clone.id = id_map[old_id].clone();
                clone.parent_id = match &clone.parent_id {
                    Some(pid) => Some(id_map.get(pid).cloned().unwrap_or_else(|| pid.clone())),
                    None => None,
                };
                if old_id == root {
                    clone.layout.x += offset.x;
                    clone.layout.y += offset.y;
                    clone.order = self.next_order(clone.parent_id.as_ref());
                    // Avoid colliding with earlier duplicates in this batch.
                    if let Some(last) = ops.iter().rev().find_map(|op| match op {
                        Operation::Insert { node }
                            if node.parent_id == clone.parent_id =>
                        {
                            Some(node.order)
                        }
                        _ => None,
                    }) {
                        clone.order = last + DEFAULT_ORDER_STEP;
                    }
                }
                ops.push(Operation::Insert { node: clone });
            }
        }

        if ops.is_empty() {
            return Ok(Vec::new());
        }
        self.apply(
            Transaction::new("Duplicate", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(new_roots)
    }

    /// Insert an instance of `component_id` under `parent_id` at parent-local `at`,
    /// cloning the component's children into the instance tree.
    pub fn instantiate_component(
        &mut self,
        component_id: &NodeId,
        parent_id: &NodeId,
        at: Vec2,
    ) -> Result<NodeId, EngineError> {
        let master = self
            .node(component_id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(component_id.to_string()))?;
        if master.kind != NodeKind::Component {
            return Err(EngineError::InvalidParent("not a component".into()));
        }
        if self.node(parent_id).is_none() {
            return Err(EngineError::NodeMissing(parent_id.to_string()));
        }

        let layout = Layout::new(
            at.x,
            at.y,
            master.layout.width.max(1.0),
            master.layout.height.max(1.0),
        );
        let mut instance = Node::instance(
            master.name.clone(),
            parent_id.clone(),
            layout,
            component_id.as_str(),
        );
        instance.order = self.next_order(Some(parent_id));
        instance.style = master.style.clone();
        instance.layout.mode = master.layout.mode;
        instance.layout.direction = master.layout.direction;
        instance.layout.align = master.layout.align;
        instance.layout.justify = master.layout.justify;
        instance.layout.gap = master.layout.gap;
        instance.layout.padding = master.layout.padding;
        instance.layout.wrap = master.layout.wrap;
        instance.layout.columns = master.layout.columns;
        instance.variant = master.variant.clone().or_else(|| Some("Default".into()));
        instance.component_variants = master.component_variants.clone();

        let instance_id = instance.id.clone();
        let mut ops = vec![Operation::Insert { node: instance }];

        let subtree = self.collect_subtree(component_id);
        let descendants: Vec<NodeId> = subtree
            .into_iter()
            .filter(|id| id != component_id)
            .collect();

        let mut id_map: HashMap<NodeId, NodeId> = HashMap::new();
        let mut used: HashSet<NodeId> = HashSet::new();
        for old_id in &descendants {
            let prefix = old_id.as_str().split('_').next().unwrap_or("node");
            let mut new_id = NodeId::new(prefix);
            while self.document.nodes.contains_key(&new_id) || used.contains(&new_id) {
                new_id = NodeId::new(prefix);
            }
            used.insert(new_id.clone());
            id_map.insert(old_id.clone(), new_id);
        }

        for old_id in &descendants {
            let Some(src) = self.node(old_id).cloned() else {
                continue;
            };
            let mut clone = src;
            clone.id = id_map[old_id].clone();
            clone.origin_id = Some(old_id.as_str().to_string());
            clone.parent_id = match &clone.parent_id {
                Some(pid) if pid == component_id => Some(instance_id.clone()),
                Some(pid) => Some(id_map.get(pid).cloned().unwrap_or_else(|| pid.clone())),
                None => Some(instance_id.clone()),
            };
            ops.push(Operation::Insert { node: clone });
        }

        // Apply active variant overrides onto the new instance tree.
        let active_variant = master
            .variant
            .clone()
            .or_else(|| master.component_variants.first().cloned())
            .unwrap_or_else(|| "Default".into());
        if let Some(patches) = master.variant_overrides.get(&active_variant) {
            for (master_key, patch) in patches {
                let target = if master_key == component_id.as_str() {
                    Some(instance_id.clone())
                } else {
                    id_map
                        .get(&NodeId::from_static(master_key.clone()))
                        .cloned()
                };
                let Some(target) = target else {
                    continue;
                };
                let base = ops.iter().find_map(|op| match op {
                    Operation::Insert { node } if node.id == target => Some(node.clone()),
                    _ => None,
                });
                if let Some(base) = base {
                    let next = base.apply_override_patch(patch);
                    for op in &mut ops {
                        if let Operation::Insert { node } = op {
                            if node.id == target {
                                *node = next;
                                break;
                            }
                        }
                    }
                }
            }
        }

        self.apply(
            Transaction::new(format!("Insert {}", master.name), ops),
            ApplyOptions::with_history(),
        )?;
        let _ = self.resolve_stack(&instance_id);
        Ok(instance_id)
    }

    /// Wrap selected siblings in a new Frame group. Returns the group id.
    pub fn group_nodes(&mut self, ids: &[NodeId]) -> Result<NodeId, EngineError> {
        let mut nodes: Vec<Node> = ids
            .iter()
            .filter_map(|id| self.node(id).cloned())
            .filter(|n| n.kind != NodeKind::Page && !n.locked)
            .collect();
        if nodes.len() < 2 {
            return Err(EngineError::InvalidParent(
                "group needs at least two layers".into(),
            ));
        }
        let parent = nodes[0]
            .parent_id
            .clone()
            .unwrap_or_else(|| self.root_page_id().clone());
        if nodes.iter().any(|n| n.parent_id.as_ref() != Some(&parent)) {
            return Err(EngineError::InvalidParent(
                "grouped layers must share a parent".into(),
            ));
        }

        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for n in &nodes {
            let Some(b) = self.absolute_bounds(&n.id) else {
                continue;
            };
            min_x = min_x.min(b.x);
            min_y = min_y.min(b.y);
            max_x = max_x.max(b.right());
            max_y = max_y.max(b.bottom());
        }
        if !min_x.is_finite() {
            return Err(EngineError::InvalidParent("no bounds".into()));
        }

        let parent_origin = if self
            .node(&parent)
            .map(|n| n.kind == NodeKind::Page)
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.absolute_bounds(&parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };

        let layout = Layout::new(
            min_x - parent_origin.x,
            min_y - parent_origin.y,
            (max_x - min_x).max(1.0),
            (max_y - min_y).max(1.0),
        );
        let mut group = Node::frame("Group", parent.clone(), layout);
        group.order = self.next_order(Some(&parent));
        let group_id = group.id.clone();

        // Insert group first, then reparent children via Move+layout patch.
        let mut ops = vec![Operation::Insert { node: group }];
        nodes.sort_by(|a, b| {
            a.order
                .partial_cmp(&b.order)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (i, n) in nodes.iter().enumerate() {
            let Some(world) = self.absolute_bounds(&n.id) else {
                continue;
            };
            let mut child_layout = n.layout.clone();
            child_layout.x = world.x - min_x;
            child_layout.y = world.y - min_y;
            let order = (i as f64 + 1.0) * DEFAULT_ORDER_STEP;
            ops.push(Operation::Move {
                id: n.id.clone(),
                parent_id: Some(group_id.clone()),
                order,
            });
            ops.push(Operation::Patch {
                id: n.id.clone(),
                patch: NodePatch {
                    layout: Some(child_layout),
                    ..NodePatch::default()
                },
            });
        }

        self.apply(
            Transaction::new("Group", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(group_id)
    }

    /// Move children of a frame to its parent and delete the frame.
    pub fn ungroup_node(&mut self, id: &NodeId) -> Result<(), EngineError> {
        let node = self
            .node(id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        if !matches!(node.kind, NodeKind::Frame) {
            return Err(EngineError::InvalidParent("can only ungroup frames".into()));
        }
        let parent = node
            .parent_id
            .clone()
            .unwrap_or_else(|| self.root_page_id().clone());
        let parent_origin = if self
            .node(&parent)
            .map(|n| n.kind == NodeKind::Page)
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.absolute_bounds(&parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };

        let children: Vec<Node> = self
            .children(Some(id))
            .into_iter()
            .cloned()
            .collect();
        let mut ops = Vec::new();
        let base_order = self.next_order(Some(&parent));
        for (i, child) in children.iter().enumerate() {
            let Some(world) = self.absolute_bounds(&child.id) else {
                continue;
            };
            let mut layout = child.layout.clone();
            layout.x = world.x - parent_origin.x;
            layout.y = world.y - parent_origin.y;
            let order = base_order + (i as f64) * DEFAULT_ORDER_STEP;
            ops.push(Operation::Move {
                id: child.id.clone(),
                parent_id: Some(parent.clone()),
                order,
            });
            ops.push(Operation::Patch {
                id: child.id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            });
        }
        ops.push(Operation::Delete { id: id.clone() });
        self.apply(
            Transaction::new("Ungroup", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(())
    }

    fn collect_subtree(&self, root: &NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(id) = stack.pop() {
            out.push(id.clone());
            for child in self.children(Some(&id)) {
                stack.push(child.id.clone());
            }
        }
        // Parents before children for insert validation.
        out.sort_by_key(|id| {
            let mut depth = 0usize;
            let mut cur = id.clone();
            while let Some(parent) = self.node(&cur).and_then(|n| n.parent_id.clone()) {
                depth += 1;
                cur = parent;
                if depth > 10_000 {
                    break;
                }
            }
            depth
        });
        out
    }

    pub fn set_text(&mut self, id: &NodeId, text: impl Into<String>) -> Result<(), EngineError> {
        let text = text.into();
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut patch = NodePatch {
            text: Some(text.clone()),
            ..NodePatch::default()
        };
        if node.kind == NodeKind::Text {
            let hug_w = node.layout.width_mode == SizeMode::Hug;
            let hug_h = node.layout.height_mode == SizeMode::Hug;
            if hug_w || hug_h {
                let mut probe = node.clone();
                probe.text = Some(text);
                let (w, h) = probe.estimate_text_size();
                let mut layout = node.layout.clone();
                if hug_w {
                    layout.width = w;
                }
                if hug_h {
                    layout.height = h;
                }
                patch.layout = Some(layout);
            }
        }
        let tx = Transaction::new(
            "Edit text",
            vec![Operation::Patch {
                id: id.clone(),
                patch,
            }],
        )
        .with_coalesce_key(format!("edit-text:{id}"));
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn rename_node(&mut self, id: &NodeId, name: impl Into<String>) -> Result<(), EngineError> {
        if self.node(id).is_none() {
            return Err(EngineError::NodeMissing(id.to_string()));
        }
        let tx = Transaction::new(
            "Rename",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    name: Some(name.into()),
                    ..NodePatch::default()
                },
            }],
        )
        .with_coalesce_key(format!("rename:{id}"));
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_style(
        &mut self,
        id: &NodeId,
        style: Style,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let mut tx = Transaction::new(
            "Edit style",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    style: Some(style),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        }
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_fill(
        &mut self,
        id: &NodeId,
        fill: Option<Color>,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.set_solid_fill(fill);
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:fill:{id}"))),
        )
    }

    pub fn set_fills(
        &mut self,
        id: &NodeId,
        fills: Vec<Paint>,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.fills = fills;
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:fills:{id}"))),
        )
    }

    pub fn set_opacity(
        &mut self,
        id: &NodeId,
        opacity: f32,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.opacity = opacity.clamp(0.0, 1.0);
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:opacity:{id}"))),
        )
    }

    pub fn set_radius(
        &mut self,
        id: &NodeId,
        radius: f32,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        self.set_corners(id, Corners::uniform(radius), coalesce_key)
    }

    pub fn set_corners(
        &mut self,
        id: &NodeId,
        corners: Corners,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.corners = corners;
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:radius:{id}"))),
        )
    }

    pub fn set_stroke(
        &mut self,
        id: &NodeId,
        stroke: Option<Stroke>,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.stroke = stroke;
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:stroke:{id}"))),
        )
    }

    pub fn set_shadows(
        &mut self,
        id: &NodeId,
        shadows: Vec<Shadow>,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.shadows = shadows;
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:shadow:{id}"))),
        )
    }

    pub fn set_overflow(
        &mut self,
        id: &NodeId,
        overflow: Overflow,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        let mut style = node.style.clone();
        style.overflow = overflow;
        self.set_style(
            id,
            style,
            coalesce_key.or_else(|| Some(format!("property:overflow:{id}"))),
        )
    }

    pub fn set_layout(
        &mut self,
        id: &NodeId,
        layout: Layout,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let parent_for_resolve = id.clone();
        let mut tx = Transaction::new(
            "Edit layout",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        }
        self.apply(tx, ApplyOptions::with_history())?;
        let _ = self.resolve_stack(&parent_for_resolve);
        Ok(())
    }

    pub fn set_rotation(
        &mut self,
        id: &NodeId,
        rotation: f32,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let mut tx = Transaction::new(
            "Rotate",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    rotation: Some(rotation),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        } else {
            tx = tx.with_coalesce_key(format!("property:rotation:{id}"));
        }
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_responsive(
        &mut self,
        id: &NodeId,
        responsive: crate::extras::ResponsiveMap,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    responsive: Some(responsive),
                    ..NodePatch::default()
                },
            )],
            "Responsive",
            None,
        )
    }

    pub fn set_visual_states(
        &mut self,
        id: &NodeId,
        visual_states: Option<crate::extras::VisualStates>,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    visual_states: Some(visual_states),
                    ..NodePatch::default()
                },
            )],
            "Visual states",
            None,
        )
    }

    pub fn set_transition(
        &mut self,
        id: &NodeId,
        transition: Option<crate::extras::Transition>,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    transition: Some(transition),
                    ..NodePatch::default()
                },
            )],
            "Transition",
            None,
        )
    }

    pub fn set_interactions(
        &mut self,
        id: &NodeId,
        interactions: Vec<crate::extras::Interaction>,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    interactions: Some(interactions),
                    ..NodePatch::default()
                },
            )],
            "Interactions",
            None,
        )
    }

    pub fn set_variant(
        &mut self,
        id: &NodeId,
        variant: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(variant_name) = variant else {
            return self.patch_nodes(
                vec![(
                    id.clone(),
                    NodePatch {
                        variant: Some(None),
                        ..NodePatch::default()
                    },
                )],
                "Variant",
                None,
            );
        };
        self.apply_variant(id, variant_name)
    }

    /// Set the active variant and apply stored variant overrides onto the tree.
    pub fn apply_variant(&mut self, id: &NodeId, variant: String) -> Result<(), EngineError> {
        let node = self
            .node(id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }

        let mut ops = vec![Operation::Patch {
            id: id.clone(),
            patch: NodePatch {
                variant: Some(Some(variant.clone())),
                ..NodePatch::default()
            },
        }];

        match node.kind {
            NodeKind::Component => {
                if let Some(patches) = node.variant_overrides.get(&variant) {
                    for (master_key, patch) in patches {
                        let target = NodeId::from_static(master_key.clone());
                        if let Some(target_node) = self.node(&target).cloned() {
                            let next = target_node.apply_override_patch(patch);
                            ops.push(Operation::Patch {
                                id: target,
                                patch: node_diff_patch(&target_node, &next),
                            });
                        }
                    }
                }
            }
            NodeKind::Instance => {
                let Some(component_key) = node.component_id.clone() else {
                    self.apply(
                        Transaction::new("Variant", ops),
                        ApplyOptions::with_history(),
                    )?;
                    return Ok(());
                };
                let component_id = NodeId::from_static(component_key.clone());
                let Some(master) = self.node(&component_id).cloned() else {
                    self.apply(
                        Transaction::new("Variant", ops),
                        ApplyOptions::with_history(),
                    )?;
                    return Ok(());
                };

                // Rebuild children from the master so prior variant patches don't linger.
                let old_children: Vec<NodeId> = self
                    .collect_subtree(id)
                    .into_iter()
                    .filter(|cid| cid != id)
                    .collect();
                for child_id in old_children.iter().rev() {
                    ops.push(Operation::Delete {
                        id: child_id.clone(),
                    });
                }

                let descendants: Vec<NodeId> = self
                    .collect_subtree(&component_id)
                    .into_iter()
                    .filter(|cid| cid != &component_id)
                    .collect();
                let mut id_map: HashMap<NodeId, NodeId> = HashMap::new();
                let mut used: HashSet<NodeId> = HashSet::new();
                for old_id in &descendants {
                    let prefix = old_id.as_str().split('_').next().unwrap_or("node");
                    let mut new_id = NodeId::new(prefix);
                    while self.document.nodes.contains_key(&new_id)
                        || used.contains(&new_id)
                        || ops.iter().any(|op| match op {
                            Operation::Insert { node } => node.id == new_id,
                            _ => false,
                        })
                    {
                        new_id = NodeId::new(prefix);
                    }
                    used.insert(new_id.clone());
                    id_map.insert(old_id.clone(), new_id);
                }

                let mut inserts: Vec<Node> = Vec::new();
                for old_id in &descendants {
                    let Some(src) = self.node(old_id).cloned() else {
                        continue;
                    };
                    let mut clone = src;
                    clone.id = id_map[old_id].clone();
                    clone.origin_id = Some(old_id.as_str().to_string());
                    clone.parent_id = match &clone.parent_id {
                        Some(pid) if pid == &component_id => Some(id.clone()),
                        Some(pid) => Some(id_map.get(pid).cloned().unwrap_or_else(|| pid.clone())),
                        None => Some(id.clone()),
                    };
                    inserts.push(clone);
                }

                // Apply variant patches onto the fresh clones + instance root.
                if let Some(patches) = master.variant_overrides.get(&variant) {
                    for (master_key, patch) in patches {
                        if master_key == component_id.as_str() {
                            let next = node.apply_override_patch(patch);
                            // Keep instance identity / parent / component link.
                            let mut patched = next;
                            patched.id = node.id.clone();
                            patched.kind = NodeKind::Instance;
                            patched.parent_id = node.parent_id.clone();
                            patched.component_id = node.component_id.clone();
                            patched.variant = Some(variant.clone());
                            patched.overrides = node.overrides.clone();
                            patched.component_variants = master.component_variants.clone();
                            patched.layout.x = node.layout.x;
                            patched.layout.y = node.layout.y;
                            patched.order = node.order;
                            ops[0] = Operation::Patch {
                                id: id.clone(),
                                patch: node_diff_patch(&node, &patched),
                            };
                            // Ensure variant field stays set.
                            if let Operation::Patch { patch, .. } = &mut ops[0] {
                                patch.variant = Some(Some(variant.clone()));
                            }
                        } else if let Some(target) =
                            id_map.get(&NodeId::from_static(master_key.clone()))
                        {
                            if let Some(base) = inserts.iter_mut().find(|n| &n.id == target) {
                                *base = base.apply_override_patch(patch);
                            }
                        }
                    }
                }

                // Re-apply instance-level overrides (keys are master ids).
                for (master_key, patch) in &node.overrides {
                    if master_key == component_id.as_str() {
                        if let Operation::Patch { patch: p, .. } = &mut ops[0] {
                            // Merge via temporary apply on current node state is hard;
                            // fold override fields into the patch.
                            if let Some(name) = &patch.name {
                                p.name = Some(name.clone());
                            }
                            if let Some(layout) = &patch.layout {
                                let mut l = layout.clone();
                                l.x = node.layout.x;
                                l.y = node.layout.y;
                                p.layout = Some(l);
                            }
                            if let Some(style) = &patch.style {
                                p.style = Some(style.clone());
                            }
                            if let Some(text) = &patch.text {
                                p.text = Some(text.clone());
                            }
                            if let Some(typography) = &patch.typography {
                                p.typography = Some(Some(typography.clone()));
                            }
                            if let Some(rotation) = patch.rotation {
                                p.rotation = Some(rotation);
                            }
                        }
                    } else if let Some(target) =
                        id_map.get(&NodeId::from_static(master_key.clone()))
                    {
                        if let Some(base) = inserts.iter_mut().find(|n| &n.id == target) {
                            *base = base.apply_override_patch(patch);
                        }
                    }
                }

                for insert in inserts {
                    ops.push(Operation::Insert { node: insert });
                }
            }
            _ => {}
        }

        self.apply(
            Transaction::new("Variant", ops),
            ApplyOptions::with_history(),
        )?;
        let _ = self.resolve_stack(id);
        Ok(())
    }

    pub fn set_overrides(
        &mut self,
        id: &NodeId,
        overrides: crate::extras::OverrideMap,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    overrides: Some(overrides),
                    ..NodePatch::default()
                },
            )],
            "Overrides",
            None,
        )
    }

    /// Resolve a Component master from a Component or Instance id.
    fn resolve_component_master(&self, id: &NodeId) -> Result<NodeId, EngineError> {
        let node = self
            .node(id)
            .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
        match node.kind {
            NodeKind::Component => Ok(id.clone()),
            NodeKind::Instance => {
                let Some(component_key) = node.component_id.as_ref() else {
                    return Err(EngineError::InvalidParent(
                        "instance has no component_id".into(),
                    ));
                };
                let component_id = NodeId::from_static(component_key.clone());
                let Some(master) = self.node(&component_id) else {
                    return Err(EngineError::NodeMissing(component_id.to_string()));
                };
                if master.kind != NodeKind::Component {
                    return Err(EngineError::InvalidParent("not a component".into()));
                }
                Ok(component_id)
            }
            _ => Err(EngineError::InvalidParent(
                "not a component or instance".into(),
            )),
        }
    }

    /// Register a named variant on a component master (empty overrides).
    pub fn add_variant(&mut self, id: &NodeId, name: String) -> Result<(), EngineError> {
        let component_id = self.resolve_component_master(id)?;
        let master = self
            .node(&component_id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(component_id.to_string()))?;
        if master.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }

        let mut component_variants = master.component_variants.clone();
        if component_variants.is_empty() {
            component_variants.push("Default".into());
        }
        if !component_variants.iter().any(|v| v == &name) {
            component_variants.push(name.clone());
        }

        let mut variant_overrides = master.variant_overrides.clone();
        variant_overrides
            .entry(name.clone())
            .or_insert_with(crate::extras::OverrideMap::new);

        let mut ops = vec![Operation::Patch {
            id: component_id.clone(),
            patch: NodePatch {
                component_variants: Some(component_variants),
                variant_overrides: Some(variant_overrides),
                variant: if &component_id == id {
                    Some(Some(name.clone()))
                } else {
                    None
                },
                ..NodePatch::default()
            },
        }];
        if &component_id != id {
            ops.push(Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    variant: Some(Some(name)),
                    ..NodePatch::default()
                },
            });
        }

        self.apply(
            Transaction::new("Add variant", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(())
    }

    /// Snapshot the component subtree into `variant_overrides[name]`.
    pub fn capture_variant(&mut self, id: &NodeId, name: String) -> Result<(), EngineError> {
        let component_id = self.resolve_component_master(id)?;
        let master = self
            .node(&component_id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(component_id.to_string()))?;
        if master.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }

        let mut component_variants = master.component_variants.clone();
        if component_variants.is_empty() {
            component_variants.push("Default".into());
        }
        if !component_variants.iter().any(|v| v == &name) {
            component_variants.push(name.clone());
        }

        let mut captured = crate::extras::OverrideMap::new();
        for node_id in self.collect_subtree(&component_id) {
            let Some(node) = self.node(&node_id) else {
                continue;
            };
            captured.insert(
                node.id.to_string(),
                crate::extras::OverridePatch {
                    layout: Some(node.layout.clone()),
                    style: Some(node.style.clone()),
                    text: node.text.clone(),
                    typography: node.typography.clone(),
                    rotation: Some(node.rotation),
                    opacity: Some(node.style.opacity),
                    name: None,
                    ..Default::default()
                },
            );
        }

        let mut variant_overrides = master.variant_overrides.clone();
        variant_overrides.insert(name.clone(), captured);

        let mut ops = vec![Operation::Patch {
            id: component_id.clone(),
            patch: NodePatch {
                component_variants: Some(component_variants),
                variant_overrides: Some(variant_overrides),
                variant: Some(Some(name.clone())),
                ..NodePatch::default()
            },
        }];
        if &component_id != id {
            ops.push(Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    variant: Some(Some(name)),
                    ..NodePatch::default()
                },
            });
        }

        self.apply(
            Transaction::new("Capture variant", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(())
    }

    /// Remove a named variant from a component master.
    pub fn delete_variant(&mut self, id: &NodeId, name: &str) -> Result<(), EngineError> {
        let component_id = self.resolve_component_master(id)?;
        let master = self
            .node(&component_id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(component_id.to_string()))?;
        if master.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }

        if master.component_variants.len() <= 1 {
            return Err(EngineError::InvalidParent(
                "cannot delete the only variant".into(),
            ));
        }
        if !master.component_variants.iter().any(|v| v == name)
            && !master.variant_overrides.contains_key(name)
        {
            return Err(EngineError::InvalidParent(format!(
                "variant `{name}` not found"
            )));
        }

        let mut component_variants = master.component_variants.clone();
        component_variants.retain(|v| v != name);
        let mut variant_overrides = master.variant_overrides.clone();
        variant_overrides.remove(name);

        let master_was_active = master.variant.as_deref() == Some(name);
        let next_variant = if master_was_active {
            if component_variants.iter().any(|v| v == "Default") {
                Some("Default".to_string())
            } else {
                component_variants.first().cloned()
            }
        } else {
            None
        };

        let mut ops = vec![Operation::Patch {
            id: component_id.clone(),
            patch: NodePatch {
                component_variants: Some(component_variants),
                variant_overrides: Some(variant_overrides.clone()),
                variant: match &next_variant {
                    Some(v) => Some(Some(v.clone())),
                    None if master_was_active => Some(None),
                    None => None,
                },
                ..NodePatch::default()
            },
        }];

        // If we switched away from the deleted variant, re-apply the fallback patches.
        if let Some(variant) = &next_variant {
            if let Some(patches) = variant_overrides.get(variant) {
                for (master_key, patch) in patches {
                    let target = NodeId::from_static(master_key.clone());
                    if let Some(target_node) = self.node(&target).cloned() {
                        let next = target_node.apply_override_patch(patch);
                        ops.push(Operation::Patch {
                            id: target,
                            patch: node_diff_patch(&target_node, &next),
                        });
                    }
                }
            }
        }

        if &component_id != id {
            let instance = self
                .node(id)
                .cloned()
                .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
            if instance.variant.as_deref() == Some(name) {
                ops.push(Operation::Patch {
                    id: id.clone(),
                    patch: NodePatch {
                        variant: Some(
                            next_variant
                                .clone()
                                .or_else(|| Some("Default".into())),
                        ),
                        ..NodePatch::default()
                    },
                });
            }
        }

        self.apply(
            Transaction::new("Delete variant", ops),
            ApplyOptions::with_history(),
        )?;
        Ok(())
    }

    /// Clear instance overrides and re-apply the active (or Default) variant.
    pub fn reset_instance(&mut self, id: &NodeId) -> Result<(), EngineError> {
        let node = self
            .node(id)
            .cloned()
            .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
        if node.kind != NodeKind::Instance {
            return Err(EngineError::InvalidParent("not an instance".into()));
        }
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let variant = node
            .variant
            .clone()
            .unwrap_or_else(|| "Default".to_string());
        self.set_overrides(id, crate::extras::OverrideMap::new())?;
        self.apply_variant(id, variant)
    }

    pub fn set_paths(
        &mut self,
        id: &NodeId,
        paths: Vec<crate::extras::VectorPath>,
    ) -> Result<(), EngineError> {
        self.patch_nodes(
            vec![(
                id.clone(),
                NodePatch {
                    paths: Some(paths),
                    ..NodePatch::default()
                },
            )],
            "Paths",
            None,
        )
    }

    pub fn set_document_breakpoints(
        &mut self,
        breakpoints: Vec<crate::extras::Breakpoint>,
    ) -> Result<(), EngineError> {
        self.document.breakpoints = breakpoints;
        self.revision += 1;
        Ok(())
    }

    pub fn set_document_tokens(
        &mut self,
        tokens: Vec<crate::extras::DesignToken>,
    ) -> Result<(), EngineError> {
        self.document.tokens = tokens;
        self.revision += 1;
        Ok(())
    }

    pub fn set_typography(
        &mut self,
        id: &NodeId,
        typography: Typography,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id) else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind != NodeKind::Text {
            return Err(EngineError::InvalidParent("not a text node".into()));
        }
        if node.locked {
            return Err(EngineError::InvalidParent("node is locked".into()));
        }
        let font_size = typography.size;
        let mut tx = Transaction::new(
            "Typography",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    typography: Some(Some(typography)),
                    font_size: Some(font_size),
                    ..NodePatch::default()
                },
            }],
        );
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        } else {
            tx = tx.with_coalesce_key(format!("typography:{id}"));
        }
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_font_size(
        &mut self,
        id: &NodeId,
        font_size: f32,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        let Some(node) = self.node(id).cloned() else {
            return Err(EngineError::NodeMissing(id.to_string()));
        };
        if node.kind != NodeKind::Text {
            return Err(EngineError::InvalidParent("not a text node".into()));
        }
        let mut typography = node.effective_typography();
        typography.size = font_size.max(1.0);
        self.set_typography(
            id,
            typography,
            coalesce_key.or_else(|| Some(format!("font-size:{id}"))),
        )
    }

    /// Recompute flow children's local positions for Flex / Grid frames.
    pub fn resolve_stack(&mut self, parent_id: &NodeId) -> Result<(), EngineError> {
        let Some(parent) = self.node(parent_id).cloned() else {
            return Err(EngineError::NodeMissing(parent_id.to_string()));
        };
        match parent.layout.mode {
            LayoutMode::Absolute => return Ok(()),
            LayoutMode::Flex => self.resolve_flex(parent_id, &parent)?,
            LayoutMode::Grid => self.resolve_grid(parent_id, &parent)?,
        }
        Ok(())
    }

    /// Walk the whole document and resolve every flex/grid stack (no history).
    pub fn resolve_all_stacks(&mut self) {
        let roots: Vec<NodeId> = self
            .document
            .nodes
            .values()
            .filter(|n| n.parent_id.is_none())
            .map(|n| n.id.clone())
            .collect();
        for root in roots {
            self.resolve_tree_stacks(&root);
        }
    }

    fn resolve_tree_stacks(&mut self, id: &NodeId) -> bool {
        let _ = self.resolve_stack(id);
        let kids: Vec<NodeId> = self
            .children(Some(id))
            .into_iter()
            .map(|n| n.id.clone())
            .collect();
        let mut descendant_size_changed = false;
        for kid in kids {
            descendant_size_changed |= self.resolve_tree_stacks(&kid);
        }
        // A nested hug child can grow without changing this parent's outer
        // size (later siblings still end at the same stale bottom). Reflow the
        // parent anyway so those siblings move instead of overlapping it.
        if descendant_size_changed {
            let _ = self.resolve_stack(id);
        }
        let own_size_changed = self.apply_hug_size(id);
        if own_size_changed {
            let _ = self.resolve_stack(id);
        }
        own_size_changed || descendant_size_changed
    }

    /// Shrink-wrap a Hug parent to its flow children. Returns true if size changed.
    fn apply_hug_size(&mut self, id: &NodeId) -> bool {
        let Some(parent) = self.node(id).cloned() else {
            return false;
        };
        if !matches!(parent.layout.mode, LayoutMode::Flex | LayoutMode::Grid) {
            return false;
        }
        let hug_w = parent.layout.width_mode == SizeMode::Hug;
        let hug_h = parent.layout.height_mode == SizeMode::Hug;
        if !hug_w && !hug_h {
            return false;
        }

        let pad = parent.layout.padding;
        let children: Vec<Node> = self
            .children(Some(id))
            .into_iter()
            .filter(|c| !c.hidden && c.layout.position == LayoutPosition::Flow)
            .cloned()
            .collect();
        if children.is_empty() {
            return false;
        }

        let mut max_r = 0.0_f64;
        let mut max_b = 0.0_f64;
        for child in &children {
            max_r = max_r.max(child.layout.x + child.layout.width);
            max_b = max_b.max(child.layout.y + child.layout.height);
        }
        let content_w = (max_r - pad.left as f64).max(1.0);
        let content_h = (max_b - pad.top as f64).max(1.0);
        let mut layout = parent.layout.clone();
        if hug_w {
            layout.width = content_w + pad.left as f64 + pad.right as f64;
        }
        if hug_h {
            layout.height = content_h + pad.top as f64 + pad.bottom as f64;
        }
        let (w, h) = layout.clamp_size(layout.width, layout.height);
        layout.width = w;
        layout.height = h;
        if (layout.width - parent.layout.width).abs() < f64::EPSILON
            && (layout.height - parent.layout.height).abs() < f64::EPSILON
        {
            return false;
        }
        let tx = Transaction::new(
            "Hug size",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    layout: Some(layout),
                    ..NodePatch::default()
                },
            }],
        );
        let _ = self.apply(
            tx,
            ApplyOptions {
                record_history: false,
            },
        );
        true
    }

    fn resolve_flex(&mut self, parent_id: &NodeId, parent: &Node) -> Result<(), EngineError> {
        let pad = parent.layout.padding;
        let gap = parent.layout.gap as f64;
        let inner_w = (parent.layout.width - pad.left as f64 - pad.right as f64).max(0.0);
        let inner_h = (parent.layout.height - pad.top as f64 - pad.bottom as f64).max(0.0);

        let children: Vec<Node> = self
            .children(Some(parent_id))
            .into_iter()
            .filter(|c| !c.hidden && c.layout.position == LayoutPosition::Flow)
            .cloned()
            .collect();
        if children.is_empty() {
            return Ok(());
        }

        let is_row = parent.layout.direction == FlexDirection::Row;
        let hug_main_axis = if is_row {
            parent.layout.width_mode == SizeMode::Hug
        } else {
            parent.layout.height_mode == SizeMode::Hug
        };

        // Preferred main/cross sizes with Fill → grow.
        let mut pref_main: Vec<f64> = Vec::with_capacity(children.len());
        let mut pref_cross: Vec<f64> = Vec::with_capacity(children.len());
        let mut grow: Vec<f32> = Vec::with_capacity(children.len());
        let mut shrink: Vec<f32> = Vec::with_capacity(children.len());
        for child in &children {
            let (mut main, mut cross) = if is_row {
                (child.layout.width, child.layout.height)
            } else {
                (child.layout.height, child.layout.width)
            };
            let main_mode = if is_row {
                child.layout.width_mode
            } else {
                child.layout.height_mode
            };
            let cross_mode = if is_row {
                child.layout.height_mode
            } else {
                child.layout.width_mode
            };
            let mut g = child.layout.grow;
            if main_mode == SizeMode::Fill {
                g = g.max(1.0);
                main = child
                    .layout
                    .min_width
                    .or(child.layout.min_height)
                    .unwrap_or(0.0)
                    .max(0.0);
                if is_row {
                    if let Some(min) = child.layout.min_width {
                        main = min;
                    }
                } else if let Some(min) = child.layout.min_height {
                    main = min;
                }
            }
            if cross_mode == SizeMode::Fill {
                // Prefer stretch on cross axis.
                cross = if is_row { inner_h } else { inner_w };
            }
            if main_mode == SizeMode::Hug && child.kind == NodeKind::Text {
                let (tw, th) = child.estimate_text_size();
                main = if is_row { tw } else { th };
            }
            if cross_mode == SizeMode::Hug && child.kind == NodeKind::Text {
                let (tw, th) = child.estimate_text_size();
                cross = if is_row { th } else { tw };
            }
            let (cw, ch) = if is_row {
                child.layout.clamp_size(main, cross)
            } else {
                child.layout.clamp_size(cross, main)
            };
            if is_row {
                pref_main.push(cw);
                pref_cross.push(ch);
            } else {
                pref_main.push(ch);
                pref_cross.push(cw);
            }
            grow.push(g);
            shrink.push(
                child
                    .layout
                    .shrink
                    .unwrap_or(if matches!(main_mode, SizeMode::Fixed | SizeMode::Percent) {
                        0.0
                    } else {
                        1.0
                    })
                    .max(0.0),
            );
        }

        let mut lines: Vec<Vec<usize>> = vec![Vec::new()];
        let mut line_main = 0.0_f64;
        for (i, &main) in pref_main.iter().enumerate() {
            let limit = if is_row { inner_w } else { inner_h };
            let needs_wrap = !hug_main_axis
                && parent.layout.wrap
                && !lines.last().map(|l| l.is_empty()).unwrap_or(true)
                && line_main + gap + main > limit + f64::EPSILON;
            if needs_wrap {
                lines.push(Vec::new());
                line_main = 0.0;
            }
            if let Some(line) = lines.last_mut() {
                if !line.is_empty() {
                    line_main += gap;
                }
                line.push(i);
                line_main += main;
            }
        }

        let mut ops = Vec::new();
        let mut cross_cursor = 0.0_f64;
        for line in &lines {
            let mut main_sizes: Vec<f64> = line.iter().map(|&i| pref_main[i]).collect();
            let mut cross_sizes: Vec<f64> = line.iter().map(|&i| pref_cross[i]).collect();
            let gaps = gap * (line.len().saturating_sub(1) as f64);
            let total_main: f64 = main_sizes.iter().sum::<f64>() + gaps;
            let free = if hug_main_axis {
                0.0
            } else if is_row {
                inner_w - total_main
            } else {
                inner_h - total_main
            };

            // Grow into free space / shrink on overflow.
            if free > f64::EPSILON {
                let grow_sum: f32 = line.iter().map(|&i| grow[i]).sum();
                if grow_sum > 0.0 {
                    for (j, &i) in line.iter().enumerate() {
                        if grow[i] > 0.0 {
                            main_sizes[j] += free * (grow[i] as f64 / grow_sum as f64);
                        }
                    }
                }
            } else if free < -f64::EPSILON {
                let shrink_sum: f64 = line
                    .iter()
                    .map(|&i| shrink[i] as f64 * pref_main[i])
                    .sum();
                if shrink_sum > f64::EPSILON {
                    for (j, &i) in line.iter().enumerate() {
                        let weight = shrink[i] as f64 * pref_main[i];
                        main_sizes[j] =
                            (main_sizes[j] + free * (weight / shrink_sum)).max(1.0);
                    }
                }
            }

            // Clamp after grow/shrink.
            for (j, &i) in line.iter().enumerate() {
                let (w, h) = if is_row {
                    children[i].layout.clamp_size(main_sizes[j], cross_sizes[j])
                } else {
                    children[i].layout.clamp_size(cross_sizes[j], main_sizes[j])
                };
                if is_row {
                    main_sizes[j] = w;
                    cross_sizes[j] = h;
                } else {
                    main_sizes[j] = h;
                    cross_sizes[j] = w;
                }
            }

            let line_cross = cross_sizes.iter().cloned().fold(0.0_f64, f64::max);
            let used_main: f64 = main_sizes.iter().sum::<f64>() + gaps;
            let free_after = if is_row {
                inner_w - used_main
            } else {
                inner_h - used_main
            };

            let (mut cursor, spacing) = match parent.layout.justify {
                LayoutJustify::Start => (0.0_f64, 0.0),
                LayoutJustify::Center => (free_after.max(0.0) * 0.5, 0.0),
                LayoutJustify::End => (free_after.max(0.0), 0.0),
                LayoutJustify::SpaceBetween if line.len() > 1 => {
                    (0.0, free_after.max(0.0) / (line.len() - 1) as f64)
                }
                LayoutJustify::SpaceBetween => (0.0, 0.0),
                LayoutJustify::SpaceAround => {
                    let slot = free_after.max(0.0) / line.len().max(1) as f64;
                    (slot * 0.5, slot)
                }
            };

            for (j, &i) in line.iter().enumerate() {
                let child = &children[i];
                let main = main_sizes[j];
                let mut cross = cross_sizes[j];
                let align = child.layout.align_self.unwrap_or(parent.layout.align);
                let cross_mode = if is_row {
                    child.layout.height_mode
                } else {
                    child.layout.width_mode
                };
                // CSS `align-items: stretch` only stretches an auto cross-size.
                // Every Canvas size mode except Fill emits an explicit size
                // (`px`, `%`, or max-content), so those dimensions must win.
                if cross_mode == SizeMode::Fill {
                    cross = if is_row {
                        inner_h.max(1.0)
                    } else {
                        inner_w.max(1.0)
                    };
                }
                let cross_free = line_cross.max(cross) - cross;
                let cross_off = match align {
                    LayoutAlign::Start | LayoutAlign::Stretch => 0.0,
                    LayoutAlign::Center => cross_free.max(0.0) * 0.5,
                    LayoutAlign::End => cross_free.max(0.0),
                };

                let mut layout = child.layout.clone();
                if is_row {
                    layout.x = pad.left as f64 + cursor;
                    layout.y = pad.top as f64 + cross_cursor + cross_off;
                    layout.width = main;
                    layout.height = cross;
                } else {
                    layout.x = pad.left as f64 + cross_cursor + cross_off;
                    layout.y = pad.top as f64 + cursor;
                    layout.width = cross;
                    layout.height = main;
                }
                let (w, h) = layout.clamp_size(layout.width, layout.height);
                layout.width = w;
                layout.height = h;

                if (layout.x - child.layout.x).abs() > f64::EPSILON
                    || (layout.y - child.layout.y).abs() > f64::EPSILON
                    || (layout.width - child.layout.width).abs() > f64::EPSILON
                    || (layout.height - child.layout.height).abs() > f64::EPSILON
                {
                    ops.push(Operation::Patch {
                        id: child.id.clone(),
                        patch: NodePatch {
                            layout: Some(layout),
                            ..NodePatch::default()
                        },
                    });
                }

                cursor += main + gap + spacing;
            }

            cross_cursor += line_cross + gap;
        }

        if ops.is_empty() {
            return Ok(());
        }
        let tx = Transaction::new("Resolve stack", ops);
        self.apply(
            tx,
            ApplyOptions {
                record_history: false,
            },
        )?;
        Ok(())
    }

    fn resolve_grid(&mut self, parent_id: &NodeId, parent: &Node) -> Result<(), EngineError> {
        let pad = parent.layout.padding;
        let gap = parent.layout.gap as f64;
        let cols = parent.layout.columns.max(1) as usize;
        let inner_w = (parent.layout.width - pad.left as f64 - pad.right as f64).max(0.0);
        let cell_w = ((inner_w - gap * (cols.saturating_sub(1) as f64)) / cols as f64).max(1.0);

        let children: Vec<Node> = self
            .children(Some(parent_id))
            .into_iter()
            .filter(|c| !c.hidden && c.layout.position == LayoutPosition::Flow)
            .cloned()
            .collect();
        if children.is_empty() {
            return Ok(());
        }

        let mut ops = Vec::new();
        let mut row_y = pad.top as f64;
        let mut row_max_h = 0.0_f64;
        for (i, child) in children.iter().enumerate() {
            let col = i % cols;
            if col == 0 && i > 0 {
                row_y += row_max_h + gap;
                row_max_h = 0.0;
            }
            row_max_h = row_max_h.max(child.layout.height);

            let mut layout = child.layout.clone();
            layout.x = pad.left as f64 + col as f64 * (cell_w + gap);
            layout.y = row_y;
            layout.width = cell_w;

            if (layout.x - child.layout.x).abs() > f64::EPSILON
                || (layout.y - child.layout.y).abs() > f64::EPSILON
                || (layout.width - child.layout.width).abs() > f64::EPSILON
            {
                ops.push(Operation::Patch {
                    id: child.id.clone(),
                    patch: NodePatch {
                        layout: Some(layout),
                        ..NodePatch::default()
                    },
                });
            }
        }

        if ops.is_empty() {
            return Ok(());
        }
        let tx = Transaction::new("Resolve grid", ops);
        self.apply(
            tx,
            ApplyOptions {
                record_history: false,
            },
        )?;
        Ok(())
    }

    pub fn patch_nodes(
        &mut self,
        patches: Vec<(NodeId, NodePatch)>,
        label: &str,
        coalesce_key: Option<String>,
    ) -> Result<(), EngineError> {
        if patches.is_empty() {
            return Ok(());
        }
        let ops = patches
            .into_iter()
            .map(|(id, patch)| Operation::Patch { id, patch })
            .collect();
        let mut tx = Transaction::new(label, ops);
        if let Some(key) = coalesce_key {
            tx = tx.with_coalesce_key(key);
        }
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    pub fn set_image_path(&mut self, id: &NodeId, path: Option<String>) -> Result<(), EngineError> {
        let name = path
            .as_ref()
            .and_then(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Image".into());
        let tx = Transaction::new(
            "Set image",
            vec![Operation::Patch {
                id: id.clone(),
                patch: NodePatch {
                    name: Some(name),
                    image_path: Some(path),
                    ..NodePatch::default()
                },
            }],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    /// Drop `dragged` onto `target` in the layers sidebar.
    /// Containers receive the node as a child; otherwise it becomes the sibling above target.
    pub fn sidebar_drop(
        &mut self,
        dragged_id: &NodeId,
        target_id: &NodeId,
    ) -> Result<(), EngineError> {
        if dragged_id == target_id {
            return Ok(());
        }
        let Some(dragged) = self.node(dragged_id).cloned() else {
            return Err(EngineError::NodeMissing(dragged_id.to_string()));
        };
        let Some(target) = self.node(target_id).cloned() else {
            return Err(EngineError::NodeMissing(target_id.to_string()));
        };
        if dragged.kind == NodeKind::Page {
            return Err(EngineError::InvalidParent("cannot move page".into()));
        }
        if would_cycle(self.document(), dragged_id, Some(target_id)) {
            return Err(EngineError::Cycle);
        }

        if target.is_container() {
            return self.reparent_keep_world(dragged_id, target_id);
        }

        let new_parent = target
            .parent_id
            .clone()
            .unwrap_or_else(|| self.root_page_id().clone());
        if would_cycle(self.document(), dragged_id, Some(&new_parent)) {
            return Err(EngineError::Cycle);
        }

        let siblings = self.children(Some(&new_parent));
        let above = siblings
            .iter()
            .find(|n| n.order > target.order)
            .map(|n| n.order);
        let new_order = match above {
            Some(hi) => (target.order + hi) * 0.5,
            None => target.order + DEFAULT_ORDER_STEP,
        };

        let Some(world) = self.absolute_bounds(dragged_id) else {
            return Err(EngineError::NodeMissing(dragged_id.to_string()));
        };
        let parent_origin = if self
            .node(&new_parent)
            .map(|n| n.kind == NodeKind::Page)
            .unwrap_or(true)
        {
            Vec2::new(0.0, 0.0)
        } else if let Some(b) = self.absolute_bounds(&new_parent) {
            Vec2::new(b.x, b.y)
        } else {
            Vec2::new(0.0, 0.0)
        };
        let mut layout = dragged.layout.clone();
        layout.x = world.x - parent_origin.x;
        layout.y = world.y - parent_origin.y;

        let tx = Transaction::new(
            "Reorder layer",
            vec![
                Operation::Move {
                    id: dragged_id.clone(),
                    parent_id: Some(new_parent),
                    order: new_order,
                },
                Operation::Patch {
                    id: dragged_id.clone(),
                    patch: NodePatch {
                        layout: Some(layout),
                        ..NodePatch::default()
                    },
                },
            ],
        );
        self.apply(tx, ApplyOptions::with_history())?;
        Ok(())
    }

    fn rebuild_indexes(&mut self) {
        self.children.clear();
        for node in self.document.nodes.values() {
            self.children
                .entry(node.parent_id.clone())
                .or_default()
                .push(node.id.clone());
        }
        for ids in self.children.values_mut() {
            ids.sort_by(|a, b| {
                let left = &self.document.nodes[a];
                let right = &self.document.nodes[b];
                left.order
                    .partial_cmp(&right.order)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| left.id.as_str().cmp(right.id.as_str()))
            });
        }
    }
}

fn apply_transaction(
    source: &Document,
    operations: &[Operation],
) -> Result<(Document, Vec<Operation>, HashSet<NodeId>), EngineError> {
    let mut document = source.clone();
    let mut inverse: Vec<Operation> = Vec::new();
    let mut changed = HashSet::new();

    for op in operations {
        match op {
            Operation::Insert { node } => {
                if document.nodes.contains_key(&node.id) {
                    return Err(EngineError::NodeExists(node.id.to_string()));
                }
                validate_parent(&document, node)?;
                if let Some(parent) = &node.parent_id {
                    changed.insert(parent.clone());
                }
                changed.insert(node.id.clone());
                inverse.insert(
                    0,
                    Operation::Delete {
                        id: node.id.clone(),
                    },
                );
                document.nodes.insert(node.id.clone(), node.clone());
            }
            Operation::Patch { id, patch } => {
                let current = document
                    .nodes
                    .get(id)
                    .cloned()
                    .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
                let before = snapshot_patch(&current, patch);
                let next = apply_patch(current, patch);
                document.nodes.insert(id.clone(), next);
                changed.insert(id.clone());
                inverse.insert(
                    0,
                    Operation::Patch {
                        id: id.clone(),
                        patch: before,
                    },
                );
            }
            Operation::Move {
                id,
                parent_id,
                order,
            } => {
                let current = document
                    .nodes
                    .get(id)
                    .cloned()
                    .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
                if would_cycle(&document, id, parent_id.as_ref()) {
                    return Err(EngineError::Cycle);
                }
                inverse.insert(
                    0,
                    Operation::Move {
                        id: id.clone(),
                        parent_id: current.parent_id.clone(),
                        order: current.order,
                    },
                );
                if let Some(p) = &current.parent_id {
                    changed.insert(p.clone());
                }
                if let Some(p) = parent_id {
                    changed.insert(p.clone());
                }
                changed.insert(id.clone());
                let mut next = current;
                next.parent_id = parent_id.clone();
                next.order = *order;
                if next.kind != NodeKind::Page {
                    validate_parent(
                        &Document {
                            nodes: {
                                let mut n = document.nodes.clone();
                                n.insert(id.clone(), next.clone());
                                n
                            },
                            ..document.clone()
                        },
                        &next,
                    )?;
                }
                document.nodes.insert(id.clone(), next);
            }
            Operation::Delete { id } => {
                let removed = collect_descendants(&document, id)?;
                if let Some(root) = removed.first() {
                    if let Some(parent) = &root.parent_id {
                        changed.insert(parent.clone());
                    }
                }
                for node in removed.iter().rev() {
                    inverse.insert(0, Operation::Insert { node: node.clone() });
                    changed.insert(node.id.clone());
                    document.nodes.remove(&node.id);
                }
            }
        }
    }

    Ok((document, inverse, changed))
}

fn snapshot_patch(node: &Node, patch: &NodePatch) -> NodePatch {
    NodePatch {
        name: patch.name.as_ref().map(|_| node.name.clone()),
        hidden: patch.hidden.map(|_| node.hidden),
        locked: patch.locked.map(|_| node.locked),
        layout: patch.layout.as_ref().map(|_| node.layout.clone()),
        style: patch.style.as_ref().map(|_| node.style.clone()),
        order: patch.order.map(|_| node.order),
        text: patch
            .text
            .as_ref()
            .map(|_| node.text.clone().unwrap_or_default()),
        font_size: patch.font_size.map(|_| node.font_size),
        typography: patch.typography.as_ref().map(|_| node.typography.clone()),
        image_path: patch.image_path.as_ref().map(|_| node.image_path.clone()),
        rotation: patch.rotation.map(|_| node.rotation),
        responsive: patch.responsive.as_ref().map(|_| node.responsive.clone()),
        visual_states: patch
            .visual_states
            .as_ref()
            .map(|_| node.visual_states.clone()),
        transition: patch.transition.as_ref().map(|_| node.transition.clone()),
        animations: patch.animations.as_ref().map(|_| node.animations.clone()),
        interactions: patch
            .interactions
            .as_ref()
            .map(|_| node.interactions.clone()),
        component_id: patch
            .component_id
            .as_ref()
            .map(|_| node.component_id.clone()),
        variant: patch.variant.as_ref().map(|_| node.variant.clone()),
        overrides: patch.overrides.as_ref().map(|_| node.overrides.clone()),
        paths: patch.paths.as_ref().map(|_| node.paths.clone()),
        component_variants: patch
            .component_variants
            .as_ref()
            .map(|_| node.component_variants.clone()),
        variant_overrides: patch
            .variant_overrides
            .as_ref()
            .map(|_| node.variant_overrides.clone()),
        origin_id: patch.origin_id.as_ref().map(|_| node.origin_id.clone()),
    }
}

fn node_diff_patch(before: &Node, after: &Node) -> NodePatch {
    let mut patch = NodePatch::default();
    if before.name != after.name {
        patch.name = Some(after.name.clone());
    }
    if before.layout != after.layout {
        patch.layout = Some(after.layout.clone());
    }
    if before.style != after.style {
        patch.style = Some(after.style.clone());
    }
    if before.text != after.text {
        patch.text = after.text.clone();
    }
    if before.typography != after.typography {
        patch.typography = Some(after.typography.clone());
    }
    if before.rotation != after.rotation {
        patch.rotation = Some(after.rotation);
    }
    if before.variant != after.variant {
        patch.variant = Some(after.variant.clone());
    }
    if before.component_variants != after.component_variants {
        patch.component_variants = Some(after.component_variants.clone());
    }
    if before.paths != after.paths {
        patch.paths = Some(after.paths.clone());
    }
    patch
}

fn apply_patch(mut node: Node, patch: &NodePatch) -> Node {
    if let Some(name) = &patch.name {
        node.name = name.clone();
    }
    if let Some(hidden) = patch.hidden {
        node.hidden = hidden;
    }
    if let Some(locked) = patch.locked {
        node.locked = locked;
    }
    if let Some(layout) = &patch.layout {
        node.layout = layout.clone();
    }
    if let Some(style) = &patch.style {
        node.style = style.clone();
    }
    if let Some(order) = patch.order {
        node.order = order;
    }
    if let Some(text) = &patch.text {
        node.text = Some(text.clone());
    }
    if let Some(font_size) = patch.font_size {
        node.font_size = font_size;
        if let Some(typo) = node.typography.as_mut() {
            typo.size = font_size;
        }
    }
    if let Some(typography) = &patch.typography {
        node.typography = typography.clone();
        if let Some(t) = typography {
            node.font_size = t.size;
        }
    }
    if let Some(image_path) = &patch.image_path {
        node.image_path = image_path.clone();
    }
    if let Some(rotation) = patch.rotation {
        node.rotation = rotation;
    }
    if let Some(responsive) = &patch.responsive {
        node.responsive = responsive.clone();
    }
    if let Some(visual_states) = &patch.visual_states {
        node.visual_states = visual_states.clone();
    }
    if let Some(transition) = &patch.transition {
        node.transition = transition.clone();
    }
    if let Some(animations) = &patch.animations {
        node.animations = animations.clone();
    }
    if let Some(interactions) = &patch.interactions {
        node.interactions = interactions.clone();
    }
    if let Some(component_id) = &patch.component_id {
        node.component_id = component_id.clone();
    }
    if let Some(variant) = &patch.variant {
        node.variant = variant.clone();
    }
    if let Some(overrides) = &patch.overrides {
        node.overrides = overrides.clone();
    }
    if let Some(paths) = &patch.paths {
        node.paths = paths.clone();
    }
    if let Some(component_variants) = &patch.component_variants {
        node.component_variants = component_variants.clone();
    }
    if let Some(variant_overrides) = &patch.variant_overrides {
        node.variant_overrides = variant_overrides.clone();
    }
    if let Some(origin_id) = &patch.origin_id {
        node.origin_id = origin_id.clone();
    }
    node
}

fn validate_parent(document: &Document, node: &Node) -> Result<(), EngineError> {
    match node.kind {
        NodeKind::Page => {
            if node.parent_id.is_some() {
                return Err(EngineError::InvalidParent("page must be a root".into()));
            }
        }
        NodeKind::Frame
        | NodeKind::Rectangle
        | NodeKind::Text
        | NodeKind::Image
        | NodeKind::Component
        | NodeKind::Instance
        | NodeKind::Vector => {
            let Some(parent_id) = &node.parent_id else {
                return Err(EngineError::InvalidParent("node requires a parent".into()));
            };
            let Some(parent) = document.nodes.get(parent_id) else {
                return Err(EngineError::InvalidParent(format!(
                    "missing parent {parent_id}"
                )));
            };
            if !parent.is_container() {
                return Err(EngineError::InvalidParent(format!(
                    "{:?} cannot contain children",
                    parent.kind
                )));
            }
        }
    }
    Ok(())
}

fn would_cycle(document: &Document, id: &NodeId, new_parent: Option<&NodeId>) -> bool {
    let mut current = new_parent.cloned();
    while let Some(parent_id) = current {
        if &parent_id == id {
            return true;
        }
        current = document
            .nodes
            .get(&parent_id)
            .and_then(|n| n.parent_id.clone());
    }
    false
}

fn collect_descendants(document: &Document, id: &NodeId) -> Result<Vec<Node>, EngineError> {
    let root = document
        .nodes
        .get(id)
        .cloned()
        .ok_or_else(|| EngineError::NodeMissing(id.to_string()))?;
    let mut result = vec![root];
    let mut i = 0;
    while i < result.len() {
        let parent = result[i].id.clone();
        for node in document.nodes.values() {
            if node.parent_id.as_ref() == Some(&parent) {
                result.push(node.clone());
            }
        }
        i += 1;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extras::OverrideMap;
    use crate::model::{Color, Document, Layout, Node, Paint};

    fn component_fixture() -> (CanvasEngine, NodeId, NodeId) {
        let mut doc = Document::empty("Variants");
        let page = doc.root_page_id.clone();
        let mut component = Node::component("Button", page.clone(), Layout::new(40.0, 40.0, 120.0, 40.0));
        component
            .style
            .set_solid_fill(Some(Color::rgb(0x33, 0x33, 0x44)));
        let component_id = component.id.clone();
        let mut child = Node::rectangle("Label", component_id.clone(), Layout::new(8.0, 8.0, 100.0, 24.0));
        child
            .style
            .set_solid_fill(Some(Color::rgb(0xaa, 0xaa, 0xaa)));
        let child_id = child.id.clone();
        doc.nodes.insert(component_id.clone(), component);
        doc.nodes.insert(child_id, child);
        (CanvasEngine::new(doc), page, component_id)
    }

    #[test]
    fn add_capture_and_apply_variant() {
        let (mut engine, _page, component_id) = component_fixture();

        engine
            .add_variant(&component_id, "Hover".into())
            .expect("add variant");
        let master = engine.node(&component_id).unwrap();
        assert!(master.component_variants.iter().any(|v| v == "Hover"));
        assert_eq!(master.variant.as_deref(), Some("Hover"));
        assert_eq!(
            master.variant_overrides.get("Hover"),
            Some(&OverrideMap::new())
        );

        // Mutate the component, then capture as Hover.
        let mut style = engine.node(&component_id).unwrap().style.clone();
        style.set_solid_fill(Some(Color::rgb(0xff, 0x00, 0x00)));
        engine.set_style(&component_id, style, None).unwrap();

        engine
            .capture_variant(&component_id, "Hover".into())
            .expect("capture");
        let master = engine.node(&component_id).unwrap();
        let hover = master.variant_overrides.get("Hover").unwrap();
        assert!(hover.contains_key(component_id.as_str()));
        let patch = hover.get(component_id.as_str()).unwrap();
        assert_eq!(
            patch.style.as_ref().and_then(|s| s.solid_fill()),
            Some(Color::rgb(0xff, 0x00, 0x00))
        );

        // Restore Default look, then apply Hover and verify fill returns.
        let mut style = engine.node(&component_id).unwrap().style.clone();
        style.set_solid_fill(Some(Color::rgb(0x33, 0x33, 0x44)));
        engine.set_style(&component_id, style, None).unwrap();
        engine
            .apply_variant(&component_id, "Hover".into())
            .expect("apply");
        let fill = engine
            .node(&component_id)
            .unwrap()
            .style
            .solid_fill()
            .unwrap();
        assert_eq!(fill, Color::rgb(0xff, 0x00, 0x00));

        engine
            .delete_variant(&component_id, "Hover")
            .expect("delete");
        let master = engine.node(&component_id).unwrap();
        assert!(!master.component_variants.iter().any(|v| v == "Hover"));
        assert!(!master.variant_overrides.contains_key("Hover"));
        assert_eq!(master.variant.as_deref(), Some("Default"));
    }

    #[test]
    fn reset_instance_clears_overrides_and_applies_variant() {
        let (mut engine, page, component_id) = component_fixture();
        engine
            .capture_variant(&component_id, "Default".into())
            .unwrap();

        let instance_id = engine
            .instantiate_component(&component_id, &page, Vec2::new(200.0, 40.0))
            .unwrap();

        let mut overrides = OverrideMap::new();
        overrides.insert(
            component_id.to_string(),
            crate::extras::OverridePatch {
                style: Some(Style {
                    fills: vec![Paint::solid(Color::rgb(0x00, 0xff, 0x00))],
                    ..Style::default()
                }),
                ..Default::default()
            },
        );
        engine.set_overrides(&instance_id, overrides).unwrap();
        assert!(!engine.node(&instance_id).unwrap().overrides.is_empty());

        engine.reset_instance(&instance_id).unwrap();
        let instance = engine.node(&instance_id).unwrap();
        assert!(instance.overrides.is_empty());
        assert_eq!(instance.variant.as_deref(), Some("Default"));
    }

    #[test]
    fn flex_grow_fills_free_main_space() {
        let mut doc = Document::empty("Grow");
        let page = doc.root_page_id.clone();
        let mut frame = Node::frame("Stack", page.clone(), Layout::new(0.0, 0.0, 300.0, 100.0));
        frame.layout.mode = LayoutMode::Flex;
        frame.layout.direction = FlexDirection::Row;
        frame.layout.gap = 0.0;
        let frame_id = frame.id.clone();
        doc.nodes.insert(frame_id.clone(), frame);

        let mut a = Node::rectangle("A", frame_id.clone(), Layout::new(0.0, 0.0, 50.0, 40.0));
        a.layout.position = LayoutPosition::Flow;
        a.layout.grow = 0.0;
        let a_id = a.id.clone();
        doc.nodes.insert(a_id.clone(), a);

        let mut b = Node::rectangle("B", frame_id.clone(), Layout::new(0.0, 0.0, 50.0, 40.0));
        b.order = 2048.0;
        b.layout.position = LayoutPosition::Flow;
        b.layout.grow = 1.0;
        b.layout.width_mode = SizeMode::Fill;
        let b_id = b.id.clone();
        doc.nodes.insert(b_id.clone(), b);

        let mut engine = CanvasEngine::new(doc);
        engine.resolve_stack(&frame_id).unwrap();
        let a = engine.node(&a_id).unwrap();
        let b = engine.node(&b_id).unwrap();
        assert!((a.layout.width - 50.0).abs() < 0.5);
        assert!((b.layout.width - 250.0).abs() < 0.5, "got {}", b.layout.width);
        assert!((b.layout.x - 50.0).abs() < 0.5);
    }

    #[test]
    fn sidebar_drop_onto_page_reparents_into_page() {
        let mut doc = Document::empty("Drop");
        let page = doc.root_page_id.clone();
        let frame = Node::frame("Frame", page.clone(), Layout::new(10.0, 10.0, 200.0, 120.0));
        let frame_id = frame.id.clone();
        doc.nodes.insert(frame_id.clone(), frame);
        let rect = Node::rectangle("Box", frame_id.clone(), Layout::new(8.0, 8.0, 40.0, 20.0));
        let rect_id = rect.id.clone();
        doc.nodes.insert(rect_id.clone(), rect);

        let mut engine = CanvasEngine::new(doc);
        engine.sidebar_drop(&rect_id, &page).unwrap();
        let node = engine.node(&rect_id).unwrap();
        assert_eq!(node.parent_id.as_ref(), Some(&page));
    }

    #[test]
    fn set_text_only_resizes_hug_axes() {
        let mut doc = Document::empty("Text");
        let page = doc.root_page_id.clone();
        let mut text = Node::text("Label", page, Layout::new(10.0, 10.0, 120.0, 24.0), "Hi");
        text.layout.width_mode = SizeMode::Fixed;
        text.layout.height_mode = SizeMode::Hug;
        let id = text.id.clone();
        let fixed_w = text.layout.width;
        doc.nodes.insert(id.clone(), text);
        let mut engine = CanvasEngine::new(doc);
        engine.set_text(&id, "Hello world").unwrap();
        let node = engine.node(&id).unwrap();
        assert_eq!(node.layout.width, fixed_w);
        assert!(node.layout.height > 1.0);
        assert_eq!(node.text.as_deref(), Some("Hello world"));
    }
}
