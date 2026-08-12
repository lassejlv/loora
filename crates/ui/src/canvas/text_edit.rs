//! In-canvas text editing helpers (caret / selection / mutations).

use std::ops::{Deref, DerefMut, Range};

use loora_engine::NodeId;

/// Caret and selection state shared by every editable text field.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextCursor {
    /// UTF-8 byte caret index.
    pub caret: usize,
    /// Selection anchor (UTF-8 bytes). Equal to `caret` means no selection.
    pub anchor: usize,
}

impl TextCursor {
    pub fn at_end(text_len: usize) -> Self {
        Self {
            caret: text_len,
            anchor: text_len,
        }
    }

    pub fn selecting_all(text_len: usize) -> Self {
        Self {
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

/// Active text edit session for a single text node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextEditSession {
    pub id: NodeId,
    pub cursor: TextCursor,
    pub marked_range: Option<Range<usize>>,
}

impl TextEditSession {
    pub fn new(id: NodeId, text_len: usize) -> Self {
        // Select-all on enter so replace/type is one keystroke away.
        Self {
            id,
            cursor: TextCursor::selecting_all(text_len),
            marked_range: None,
        }
    }

    #[cfg(test)]
    pub fn replace_and_mark(
        &mut self,
        text: &mut String,
        replacement_range_utf16: Option<Range<usize>>,
        new_text: &str,
        selected_range_utf16: Range<usize>,
    ) {
        let range = replacement_range_utf16
            .map(|range| range_from_utf16(text, range))
            .or_else(|| self.marked_range.take())
            .unwrap_or_else(|| {
                let (start, end) = self.sorted();
                start..end
            });
        text.replace_range(range.clone(), new_text);
        let marked = range.start..range.start + new_text.len();
        let selected = range_from_utf16(new_text, selected_range_utf16);
        self.anchor = marked.start + selected.start;
        self.caret = marked.start + selected.end;
        self.marked_range = (!new_text.is_empty()).then_some(marked);
    }
}

impl Deref for TextEditSession {
    type Target = TextCursor;

    fn deref(&self) -> &Self::Target {
        &self.cursor
    }
}

impl DerefMut for TextEditSession {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.cursor
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

#[cfg(test)]
fn offset_from_utf16(text: &str, offset: usize) -> usize {
    let mut utf8 = 0;
    let mut utf16 = 0;
    for ch in text.chars() {
        if utf16 >= offset {
            break;
        }
        utf16 += ch.len_utf16();
        utf8 += ch.len_utf8();
    }
    utf8
}

#[cfg(test)]
fn range_from_utf16(text: &str, range: Range<usize>) -> Range<usize> {
    offset_from_utf16(text, range.start)..offset_from_utf16(text, range.end)
}

pub fn move_word_left(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if session.has_selection() && !extend {
        let (start, _) = session.sorted();
        session.set_caret(start, false);
        return;
    }
    let mut offset = session.caret;
    while offset > 0 {
        let previous = prev_boundary(text, offset);
        let ch = text[previous..offset].chars().next().unwrap();
        if !ch.is_whitespace() {
            break;
        }
        offset = previous;
    }
    while offset > 0 {
        let previous = prev_boundary(text, offset);
        let ch = text[previous..offset].chars().next().unwrap();
        if ch.is_whitespace() {
            break;
        }
        offset = previous;
    }
    session.set_caret(offset, extend);
}

pub fn move_word_right(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if session.has_selection() && !extend {
        let (_, end) = session.sorted();
        session.set_caret(end, false);
        return;
    }
    let mut offset = session.caret;
    while offset < text.len() {
        let next = next_boundary(text, offset);
        let ch = text[offset..next].chars().next().unwrap();
        if ch.is_whitespace() {
            break;
        }
        offset = next;
    }
    while offset < text.len() {
        let next = next_boundary(text, offset);
        let ch = text[offset..next].chars().next().unwrap();
        if !ch.is_whitespace() {
            break;
        }
        offset = next;
    }
    session.set_caret(offset, extend);
}

/// Move caret one grapheme-ish (char) left. Extends selection when `extend`.
pub fn move_left(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if !extend && session.has_selection() {
        let (a, _) = session.sorted();
        session.set_caret(a, false);
        return;
    }
    session.set_caret(prev_boundary(text, session.caret), extend);
}

pub fn move_right(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    if !extend && session.has_selection() {
        let (_, b) = session.sorted();
        session.set_caret(b, false);
        return;
    }
    session.set_caret(next_boundary(text, session.caret), extend);
}

pub fn move_home(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let line_start = text[..session.caret]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    session.set_caret(line_start, extend);
}

pub fn move_end(session: &mut TextCursor, text: &str, extend: bool) {
    session.clamp_in_text(text);
    let line_end = text[session.caret..]
        .find('\n')
        .map(|i| session.caret + i)
        .unwrap_or(text.len());
    session.set_caret(line_end, extend);
}

/// Logical-line up (by `\n`), keeping preferred column in chars.
pub fn move_up(session: &mut TextCursor, text: &str, extend: bool) {
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

pub fn move_down(session: &mut TextCursor, text: &str, extend: bool) {
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
pub fn backspace(text: &mut String, session: &mut TextCursor) -> bool {
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
pub fn delete_forward(text: &mut String, session: &mut TextCursor) -> bool {
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

pub fn delete_selection(text: &mut String, session: &mut TextCursor) -> bool {
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
pub fn insert(text: &mut String, session: &mut TextCursor, insert: &str) {
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
        let mut s = TextCursor {
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
        let mut s = TextCursor {
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
        let mut s = TextCursor {
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
        let mut s = TextCursor {
            caret: 3,
            anchor: 1,
        };
        move_left(&mut s, &text, false);
        assert_eq!(s.caret, 1);
        assert!(!s.has_selection());
    }

    #[test]
    fn select_all_then_insert_replaces_the_value() {
        let mut text = String::from("hello");
        let mut session = TextCursor {
            caret: text.len(),
            anchor: text.len(),
        };
        session.select_all(text.len());

        insert(&mut text, &mut session, "x");

        assert_eq!(text, "x");
        assert_eq!(session.sorted(), (1, 1));
    }

    #[test]
    fn shift_arrow_extends_the_selection() {
        let text = String::from("abc");
        let mut session = TextCursor {
            caret: text.len(),
            anchor: text.len(),
        };

        move_left(&mut session, &text, true);
        move_left(&mut session, &text, true);

        assert_eq!(session.sorted(), (1, 3));
    }

    #[test]
    fn option_arrow_moves_across_a_word() {
        let text = "one two three";
        let mut session = TextCursor::at_end(text.len());

        move_word_left(&mut session, text, false);

        assert_eq!(session.sorted(), (8, 8));
    }

    #[test]
    fn marked_text_replaces_the_active_composition() {
        let mut text = String::from("Cafe");
        let mut session = TextEditSession::new(NodeId::from("text"), text.len());
        session.set_caret(text.len(), false);

        session.replace_and_mark(&mut text, None, "é", 2..2);
        assert_eq!(text, "Cafeé");
        assert_eq!(session.marked_range, Some(4..7));

        session.replace_and_mark(&mut text, None, "é", 1..1);
        assert_eq!(text, "Cafeé");
        assert_eq!(session.marked_range, Some(4..6));
    }
}
