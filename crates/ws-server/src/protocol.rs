use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::Sha256;

pub const TICKET_PROTOCOL: &str = "loora.realtime.v1";
pub const CONNECTION_TTL_MS: u64 = 15 * 60_000;
pub const PRESENCE_TTL_MS: u64 = 45_000;
pub const MAX_PRESENCE_PEERS: usize = 50;
const TICKET_TTL_MS: f64 = 60_000.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketClaims {
    pub v: u8,
    pub jti: String,
    pub user_id: String,
    pub session_id: String,
    pub owner_user_id: String,
    pub design_id: String,
    pub draft_id: Option<String>,
    pub role: String,
    pub name: String,
    pub image: Option<String>,
    pub color: String,
    pub issued_at: f64,
    pub expires_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub label: String,
    pub node_ids: Vec<String>,
    pub phase: String,
    pub updated_at: f64,
    pub expires_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub session_id: String,
    pub user_id: String,
    pub name: String,
    pub image: Option<String>,
    pub color: String,
    pub role: String,
    pub cursor: Option<Cursor>,
    pub selection: Vec<String>,
    pub updated_at: f64,
}

#[derive(Clone, Debug)]
pub struct Target {
    pub design_id: String,
    pub draft_id: Option<String>,
}

#[derive(Debug)]
pub enum ClientMessage {
    Ping,
    Presence {
        cursor: Option<Cursor>,
        selection: Vec<String>,
    },
}

#[derive(Debug)]
pub enum IngestMessage {
    Event {
        owner: String,
        target: Target,
        event: Value,
    },
    Activity {
        owner: String,
        target: Target,
        activity: Option<Activity>,
    },
    Presence {
        owner: String,
        target: Target,
        peer: Peer,
    },
    PresenceClear {
        owner: String,
        target: Target,
        session_id: String,
    },
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn verify_ticket(token: &str, secrets: &[String], now: u64) -> Option<TicketClaims> {
    if token.is_empty() || token.len() > 4096 {
        return None;
    }
    let (body, signature) = token.split_once('.')?;
    if body.is_empty() || signature.is_empty() {
        return None;
    }
    let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
    let valid = secrets.iter().any(|secret| {
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).is_ok_and(|mut mac| {
            mac.update(body.as_bytes());
            mac.verify_slice(&signature).is_ok()
        })
    });
    if !valid {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(body).ok()?;
    let raw_claims: Value = serde_json::from_slice(&decoded).ok()?;
    let raw_claims = raw_claims.as_object()?;
    if !raw_claims.contains_key("draftId") || !raw_claims.contains_key("image") {
        return None;
    }
    let claims: TicketClaims = serde_json::from_value(Value::Object(raw_claims.clone())).ok()?;
    let finite = claims.issued_at.is_finite() && claims.expires_at.is_finite();
    let text = |value: &str, max| !value.is_empty() && value.len() <= max;
    if claims.v != 1
        || !text(&claims.jti, 128)
        || !text(&claims.user_id, 128)
        || !text(&claims.session_id, 128)
        || !text(&claims.owner_user_id, 128)
        || !text(&claims.design_id, 128)
        || claims
            .draft_id
            .as_ref()
            .is_some_and(|value| !text(value, 128))
        || !matches!(claims.role.as_str(), "owner" | "edit" | "view")
        || js_len(&claims.name) > 200
        || !valid_color(&claims.color)
        || !finite
        || claims.expires_at <= now as f64
        || claims.expires_at - now as f64 > 10.0 * TICKET_TTL_MS
    {
        return None;
    }
    Some(claims)
}

pub fn parse_client_message(raw: &str) -> Option<ClientMessage> {
    if raw.len() > 8192 {
        return None;
    }
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;
    match object.get("type")?.as_str()? {
        "ping" => Some(ClientMessage::Ping),
        "presence" => {
            let cursor = object.get("cursor").and_then(valid_input_cursor);
            let selection = object
                .get("selection")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|id| text(id, 128))
                        .take(64)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            Some(ClientMessage::Presence { cursor, selection })
        }
        _ => None,
    }
}

pub fn parse_ingest(value: &Value) -> Option<IngestMessage> {
    let raw = value.as_object()?;
    let owner = raw.get("ownerUserId")?.as_str()?.to_owned();
    if !text(&owner, 128) {
        return None;
    }
    let target = parse_target(raw.get("target")?)?;
    match raw.get("kind")?.as_str()? {
        "event" => Some(IngestMessage::Event {
            owner,
            target,
            event: parse_event_input(raw.get("event")?)?,
        }),
        "activity" => {
            let activity = match raw.get("activity")? {
                Value::Null => None,
                value => Some(parse_activity(value)?),
            };
            Some(IngestMessage::Activity {
                owner,
                target,
                activity,
            })
        }
        "presence" => Some(IngestMessage::Presence {
            owner,
            target,
            peer: parse_peer(raw.get("peer")?)?,
        }),
        "presence.clear" => {
            let session_id = raw.get("sessionId")?.as_str()?.to_owned();
            text(&session_id, 128).then_some(IngestMessage::PresenceClear {
                owner,
                target,
                session_id,
            })
        }
        _ => None,
    }
}

pub fn parse_state_request(value: &Value) -> Option<(String, Target)> {
    let raw = value.as_object()?;
    let owner = raw.get("ownerUserId")?.as_str()?.to_owned();
    if !text(&owner, 128) {
        return None;
    }
    Some((owner, parse_target(raw.get("target")?)?))
}

pub fn channel_for(owner: &str, target: &Target) -> String {
    let leaf = target
        .draft_id
        .as_ref()
        .map(|id| format!("draft:{id}"))
        .unwrap_or_else(|| "main".to_owned());
    format!(
        "loora:canvas:{}:{}:{}",
        encode_component(owner),
        encode_component(&target.design_id),
        encode_component(&leaf)
    )
}

pub fn validate_peer(peer: &Peer) -> bool {
    text(&peer.session_id, 128)
        && text(&peer.user_id, 128)
        && js_len(&peer.name) <= 200
        && valid_color(&peer.color)
        && matches!(peer.role.as_str(), "owner" | "edit" | "view")
        && peer
            .cursor
            .as_ref()
            .is_none_or(|cursor| cursor.x.is_finite() && cursor.y.is_finite())
        && valid_node_ids(&peer.selection)
        && peer.updated_at.is_finite()
}

pub fn validate_activity(activity: &Activity) -> bool {
    text(&activity.id, 200)
        && text(&activity.label, 160)
        && valid_node_ids(&activity.node_ids)
        && matches!(activity.phase.as_str(), "working" | "settled")
        && activity.updated_at.is_finite()
        && activity.expires_at.is_finite()
}

fn parse_target(value: &Value) -> Option<Target> {
    let raw = value.as_object()?;
    let design_id = raw.get("designId")?.as_str()?.trim().to_owned();
    if !text(&design_id, 128) {
        return None;
    }
    let draft_id = raw
        .get("draftId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if draft_id.as_ref().is_some_and(|value| js_len(value) > 128) {
        return None;
    }
    Some(Target {
        design_id,
        draft_id,
    })
}

fn parse_event_input(value: &Value) -> Option<Value> {
    let raw = value.as_object()?;
    match raw.get("type")?.as_str()? {
        "canvas.changed" => {
            let revision = raw.get("revision")?;
            let numeric_revision = revision.as_f64()?;
            let node_ids = strings(raw.get("nodeIds")?, 64, 128)?;
            if !numeric_revision.is_finite()
                || numeric_revision < 0.0
                || numeric_revision.fract() != 0.0
            {
                return None;
            }
            Some(serde_json::json!({
                "type": "canvas.changed",
                "revision": revision,
                "nodeIds": node_ids,
            }))
        }
        "branch.changed" => {
            let draft_id = nullable_text(raw.get("draftId")?, 128)?;
            let status = match raw.get("status")? {
                Value::Null => Value::Null,
                Value::String(value) => Value::String(value.clone()),
                _ => return None,
            };
            Some(serde_json::json!({
                "type": "branch.changed",
                "draftId": draft_id,
                "status": status,
            }))
        }
        _ => None,
    }
}

fn parse_activity(value: &Value) -> Option<Activity> {
    let activity: Activity = serde_json::from_value(value.clone()).ok()?;
    validate_activity(&activity).then_some(activity)
}

fn parse_peer(value: &Value) -> Option<Peer> {
    let raw = value.as_object()?;
    if !raw.contains_key("image") || !raw.contains_key("cursor") {
        return None;
    }
    let peer: Peer = serde_json::from_value(value.clone()).ok()?;
    validate_peer(&peer).then_some(peer)
}

fn valid_input_cursor(value: &Value) -> Option<Cursor> {
    let raw = value.as_object()?;
    let x = raw.get("x")?.as_f64()?;
    let y = raw.get("y")?.as_f64()?;
    if !x.is_finite() || !y.is_finite() || x.abs() >= 1e7 || y.abs() >= 1e7 {
        return None;
    }
    Some(Cursor {
        x: js_round(x),
        y: js_round(y),
    })
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn valid_node_ids(values: &[String]) -> bool {
    values.len() <= 64 && values.iter().all(|value| text(value, 128))
}

fn strings(value: &Value, count: usize, length: usize) -> Option<Vec<String>> {
    let values = value.as_array()?;
    if values.len() > count {
        return None;
    }
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|value| text(value, length))
                .map(str::to_owned)
        })
        .collect()
}

fn nullable_text(value: &Value, max: usize) -> Option<Value> {
    match value {
        Value::Null => Some(Value::Null),
        Value::String(value) if text(value, max) => Some(Value::String(value.clone())),
        _ => None,
    }
}

fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && js_len(value) <= max
}

fn js_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

// encodeURIComponent leaves exactly these printable ASCII characters unescaped.
const COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

fn encode_component(value: &str) -> String {
    utf8_percent_encode(value, COMPONENT).to_string()
}

pub fn with_sent_at(mut event: Value) -> Option<String> {
    event
        .as_object_mut()?
        .insert("sentAt".to_owned(), Value::from(now_ms()));
    serde_json::to_string(&event).ok()
}

pub fn presence_author(payload: &str) -> Option<String> {
    if !payload.contains("\"presence.peer\"") {
        return None;
    }
    let value: Value = serde_json::from_str(payload).ok()?;
    let raw: &Map<String, Value> = value.as_object()?;
    (raw.get("type")?.as_str()? == "presence.peer")
        .then(|| raw.get("sessionId")?.as_str().map(str::to_owned))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_matches_typescript_encoding() {
        assert_eq!(
            channel_for(
                "user:one",
                &Target {
                    design_id: "a/b".into(),
                    draft_id: Some("x y".into())
                }
            ),
            "loora:canvas:user%3Aone:a%2Fb:draft%3Ax%20y"
        );
    }

    #[test]
    fn normalizes_presence_like_javascript() {
        let message = parse_client_message(
            r#"{"type":"presence","cursor":{"x":12.4,"y":-1.5},"selection":["a",3]}"#,
        )
        .unwrap();
        let ClientMessage::Presence { cursor, selection } = message else {
            panic!()
        };
        let cursor = cursor.unwrap();
        assert_eq!((cursor.x, cursor.y), (12.0, -1.0));
        assert_eq!(selection, ["a"]);
    }

    #[test]
    fn verifies_a_ticket_signed_by_the_typescript_package() {
        let token = "eyJ2IjoxLCJqdGkiOiJydXN0LWZpeHR1cmUiLCJ1c2VySWQiOiJ1c2VyLTEiLCJzZXNzaW9uSWQiOiJzZXNzaW9uLTEiLCJvd25lclVzZXJJZCI6Im93bmVyLTEiLCJkZXNpZ25JZCI6ImRlc2lnbi0xIiwiZHJhZnRJZCI6bnVsbCwicm9sZSI6Im93bmVyIiwibmFtZSI6IkFkYSIsImltYWdlIjpudWxsLCJjb2xvciI6IiM2YzVjZTciLCJpc3N1ZWRBdCI6MTcwMDAwMDAwMDAwMCwiZXhwaXJlc0F0IjoxNzAwMDAwMDYwMDAwfQ.mlMi6g2GRXo2LXjLz5qxnnHJLnoupmnbCTabbRyCW3A";
        let claims = verify_ticket(token, &["s".repeat(32)], 1_700_000_000_001).unwrap();
        assert_eq!(claims.jti, "rust-fixture");
        assert_eq!(claims.role, "owner");
    }
}
