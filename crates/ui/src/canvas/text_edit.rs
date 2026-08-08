//! In-canvas text editing helpers (caret / selection / mutations).

use loora_engine::NodeId;

/// Active text edit session for a single text node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextEditSession {
    pub id: NodeId,
    /// UTF-8 byte caret index.
    pub caret: usize,
    /// Selection anchor (UTF-8 bytes). Equal to `caret` means no selection.
    pub anchor: usize,
}

impl TextEditSession {
    pub fn new(id: NodeId, text_len: usize) -> Self {
        // Select-all on enter so replace/type is one keystroke away.
        Self {
            id,
            caret: text_len,
            anchor: 0,
        }
    }

    pub fn sorted(&self) -> (usize, usize) {
        if self.anchor <= self.caret {
            (self.anchor, self.caret)
        } else {
            (self.caret, self.anchor)
        }
    }

    pub fn has_selection(&self) -> bool {
        self.anchor != self.caret
    }

    pub fn clear_selection(&mut self) {
        self.anchor = self.caret;
    }

    pub fn select_all(&mut self, text_len: usize) {
        self.anchor = 0;
        self.caret = text_len;
    }

    pub fn clamp_in_text(&mut self, text: &str) {
        self.caret = clamp_boundary(text, self.caret);
        self.anchor = clamp_boundary(text, self.anchor);
    }

    pub fn set_caret(&mut self, caret: usize, extend: bool) {
        self.caret = caret;
        if !extend {
            self.anchor = caret;
        }
    }
}

pub fn clamp_boundary(text: &str, i: usize) -> usize {
    if i >= text.len() {
        return text.len();
    }
    if text.is_char_boundary(i) {
        return i;
    }
    let mut p = i;
    while p > 0 && !text.is_char_boundary(p) {
        p -= 1;
    }
    p
}

pub fn prev_boundary(text: &str, i: usize) -> usize {
    let i = clamp_boundary(text, i);
    if i == 0 {
        return 0;
    }
    let mut p = i - 1;
    while p > 0 && !text.is_char_boundary(p) {
        p -= 1;
    }
    p
}

pub fn next_boundary(text: &str, i: usize) -> usize {
    let i = clamp_boundary(text, i);
    if i >= text.len() {
        return text.len();
    }
    let mut p = i + 1;
    while p < text.len() && !text.is_char_boundary(p) {
        p += 1;
    }
    p
}

/// Move caret one grapheme-ish (char) left. Extends selection when `extend`.
pub fn move_left(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if !extend && session.has_selection() {
        let (a, _) = session.sorted();
        session.set_caret(a, false);
        return;
    }
    session.set_caret(prev_boundary(text, session.caret), extend);
}

pub fn move_right(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if !extend && session.has_selection() {
        let (_, b) = session.sorted();
        session.set_caret(b, false);
        return;
    }
    session.set_caret(next_boundary(text, session.caret), extend);
}

pub fn move_home(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let line_start = text[..session.caret].rfind('\n').map(|i| i + 1).unwrap_or(0);
    session.set_caret(line_start, extend);
}

pub fn move_end(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let line_end = text[session.caret..]
        .find('\n')
        .map(|i| session.caret + i)
        .unwrap_or(text.len());
    session.set_caret(line_end, extend);
}

/// Logical-line up (by `\n`), keeping preferred column in chars.
pub fn move_up(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let caret = session.caret;
    let line_start = text[..caret].rfind('\n').map(|i| i + 1).unwrap_or(0);
    if line_start == 0 {
        session.set_caret(0, extend);
        return;
    }
    let col = text[line_start..caret].chars().count();
    let prev_end = line_start - 1;
    let prev_start = text[..prev_end].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let idx = match text[prev_start..prev_end].char_indices().nth(col) {
        Some((i, _)) => prev_start + i,
        None => prev_end,
    };
    session.set_caret(idx, extend);
}

pub fn move_down(session: &mut TextEditSession, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let caret = session.caret;
    let line_start = text[..caret].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let col = text[line_start..caret].chars().count();
    let Some(rel) = text[caret..].find('\n') else {
        session.set_caret(text.len(), extend);
        return;
    };
    let next_start = caret + rel + 1;
    let next_end = text[next_start..]
        .find('\n')
        .map(|i| next_start + i)
        .unwrap_or(text.len());
    let idx = match text[next_start..next_end].char_indices().nth(col) {
        Some((i, _)) => next_start + i,
        None => next_end,
    };
    session.set_caret(idx, extend);
}

/// Delete selection, or one char before caret (backspace).
pub fn backspace(text: &mut String, session: &mut TextEditSession) -> bool {
    session.clamp_in_text(text);
    if session.has_selection() {
        return delete_selection(text, session);
    }
    if session.caret == 0 {
        return false;
    }
    let from = prev_boundary(text, session.caret);
    text.replace_range(from..session.caret, "");
    session.set_caret(from, false);
    true
}

/// Delete selection, or one char after caret (forward delete).
pub fn delete_forward(text: &mut String, session: &mut TextEditSession) -> bool {
    session.clamp_in_text(text);
    if session.has_selection() {
        return delete_selection(text, session);
    }
    if session.caret >= text.len() {
        return false;
    }
    let to = next_boundary(text, session.caret);
    text.replace_range(session.caret..to, "");
    session.clear_selection();
    true
}

pub fn delete_selection(text: &mut String, session: &mut TextEditSession) -> bool {
    session.clamp_in_text(text);
    let (a, b) = session.sorted();
    if a == b {
        return false;
    }
    text.replace_range(a..b, "");
    session.set_caret(a, false);
    true
}

/// Insert `insert` at caret (replacing selection).
pub fn insert(text: &mut String, session: &mut TextEditSession, insert: &str) {
    session.clamp_in_text(text);
    if session.has_selection() {
        let _ = delete_selection(text, session);
    }
    text.insert_str(session.caret, insert);
    let new_caret = session.caret + insert.len();
    session.set_caret(new_caret, false);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_backspace_at_caret() {
        let mut text = String::from("abc");
        let mut s = TextEditSession {
            id: NodeId::from("t"),
            caret: 1,
            anchor: 1,
        };
        insert(&mut text, &mut s, "X");
        assert_eq!(text, "aXbc");
        assert_eq!(s.caret, 2);
        assert!(backspace(&mut text, &mut s));
        assert_eq!(text, "abc");
        assert_eq!(s.caret, 1);
    }

    #[test]
    fn replace_selection() {
        let mut text = String::from("hello");
        let mut s = TextEditSession {
            id: NodeId::from("t"),
            caret: 4,
            anchor: 1,
        };
        insert(&mut text, &mut s, "i");
        assert_eq!(text, "hio");
        assert_eq!(s.caret, 2);
    }

    #[test]
    fn newline_insert() {
        let mut text = String::from("ab");
        let mut s = TextEditSession {
            id: NodeId::from("t"),
            caret: 1,
            anchor: 1,
        };
        insert(&mut text, &mut s, "\n");
        assert_eq!(text, "a\nb");
        assert_eq!(s.caret, 2);
    }

    #[test]
    fn move_across_selection_collapses() {
        let text = String::from("abcd");
        let mut s = TextEditSession {
            id: NodeId::from("t"),
            caret: 3,
            anchor: 1,
        };
        move_left(&mut s, &text, false);
        assert_eq!(s.caret, 1);
        assert!(!s.has_selection());
    }
}
