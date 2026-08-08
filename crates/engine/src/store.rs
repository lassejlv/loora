use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::model::Document;

const APP_DIR: &str = "Loora";
const LEGACY_APP_DIR: &str = "Luuma";
const DESIGNS_DIR: &str = "designs";
const SESSION_FILE: &str = "session.json";
const FILE_SUFFIX: &str = ".loora.json";
const LEGACY_FILE_SUFFIX: &str = ".luuma.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesignFileInfo {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct Session {
    active_id: Option<String>,
    /// App chrome theme: `"dark"` or `"light"`.
    #[serde(default)]
    ui_theme: Option<String>,
}

/// Result of importing one or more design files.
#[derive(Clone, Debug, Default)]
pub struct ImportReport {
    pub imported: Vec<DesignFileInfo>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct DesignStore {
    root: PathBuf,
}

impl DesignStore {
    pub fn open() -> io::Result<Self> {
        let base = dirs::data_dir()
            .or_else(dirs::home_dir)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no data directory"))?;
        Self::open_at(base.join(APP_DIR))
    }

    pub fn open_at(root: PathBuf) -> io::Result<Self> {
        let designs = root.join(DESIGNS_DIR);
        fs::create_dir_all(&designs)?;
        Ok(Self { root })
    }

    pub fn designs_dir(&self) -> PathBuf {
        self.root.join(DESIGNS_DIR)
    }

    /// Directory for pasted / imported binary assets (images).
    pub fn assets_dir(&self) -> PathBuf {
        self.root.join("assets")
    }

    /// Copy a local file into the assets directory; returns the stored path.
    pub fn import_asset_file(&self, source: &Path) -> io::Result<PathBuf> {
        let assets = self.assets_dir();
        fs::create_dir_all(&assets)?;
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("asset.bin");
        let stem = Path::new(file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("asset");
        let ext = Path::new(file_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("bin");
        let mut dest = assets.join(file_name);
        if dest.exists() {
            let stamp = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            dest = assets.join(format!("{stem}-{stamp}.{ext}"));
        }
        fs::copy(source, &dest)?;
        Ok(dest)
    }

    /// List image files already in the local asset library.
    pub fn list_assets(&self) -> io::Result<Vec<PathBuf>> {
        let dir = self.assets_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut files = Vec::new();
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
            ) {
                files.push(path);
            }
        }
        files.sort();
        Ok(files)
    }

    /// Default location of older Luuma desktop designs.
    pub fn luuma_designs_dir() -> Option<PathBuf> {
        dirs::data_dir()
            .or_else(dirs::home_dir)
            .map(|base| base.join(LEGACY_APP_DIR).join(DESIGNS_DIR))
    }

    pub fn path_for(&self, id: &str) -> PathBuf {
        self.designs_dir().join(format!("{id}{FILE_SUFFIX}"))
    }

    pub fn exists(&self, id: &str) -> bool {
        self.path_for(id).exists()
            || self
                .designs_dir()
                .join(format!("{id}{LEGACY_FILE_SUFFIX}"))
                .exists()
    }

    pub fn list(&self) -> io::Result<Vec<DesignFileInfo>> {
        let mut files = Vec::new();
        let dir = self.designs_dir();
        if !dir.exists() {
            return Ok(files);
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if !(name.ends_with(FILE_SUFFIX) || name.ends_with(LEGACY_FILE_SUFFIX)) {
                continue;
            }
            match self.read_info(&path) {
                Ok(info) => files.push(info),
                Err(_) => continue,
            }
        }
        files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(files)
    }

    fn read_info(&self, path: &Path) -> io::Result<DesignFileInfo> {
        let bytes = fs::read(path)?;
        let doc: Document = serde_json::from_slice(&bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let updated_at = fs::metadata(path)?
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(DesignFileInfo {
            id: doc.id,
            name: doc.name,
            path: path.to_path_buf(),
            updated_at,
        })
    }

    pub fn load(&self, id: &str) -> io::Result<Document> {
        let path = self.path_for(id);
        let path = if path.exists() {
            path
        } else {
            let legacy = self.designs_dir().join(format!("{id}{LEGACY_FILE_SUFFIX}"));
            if legacy.exists() {
                legacy
            } else {
                path
            }
        };
        let bytes = fs::read(path)?;
        serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    pub fn save(&self, document: &Document) -> io::Result<()> {
        let path = self.path_for(&document.id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("loora.json.tmp");
        let json = serde_json::to_vec_pretty(document)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// Parse a design JSON file (`.loora.json`, `.luuma.json`, plain Document JSON,
    /// or web `loora.canvas` export) and save it into this store as `.loora.json`.
    pub fn import_file(&self, path: &Path) -> io::Result<Document> {
        let bytes = fs::read(path)?;
        let doc = crate::canvas_import::parse_design_bytes(&bytes).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: {e}", path.display()),
            )
        })?;
        self.save(&doc)?;
        Ok(doc)
    }

    /// Write a document to an arbitrary path (native Document JSON).
    pub fn export_document(&self, document: &Document, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(document)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, &json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Import multiple design files. Existing ids are skipped unless `overwrite`.
    pub fn import_paths(&self, paths: &[PathBuf], overwrite: bool) -> io::Result<ImportReport> {
        let mut report = ImportReport::default();
        for path in paths {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let looks_design = is_design_filename(&name)
                || path.extension().and_then(|e| e.to_str()) == Some("json");
            if !looks_design {
                report
                    .errors
                    .push(format!("skipped unsupported file: {name}"));
                continue;
            }
            match self.peek_document_id(path) {
                Ok(id) if !overwrite && self.exists(&id) => {
                    report.skipped.push(format!("{name} ({id})"));
                }
                Ok(_) | Err(_) => match self.import_file(path) {
                    Ok(doc) => match self.read_info(&self.path_for(&doc.id)) {
                        Ok(info) => report.imported.push(info),
                        Err(err) => report.errors.push(format!("{name}: {err}")),
                    },
                    Err(err) => report.errors.push(format!("{name}: {err}")),
                },
            }
        }
        Ok(report)
    }

    fn peek_document_id(&self, path: &Path) -> io::Result<String> {
        let bytes = fs::read(path)?;
        crate::canvas_import::peek_design_id(&bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    /// Copy older Luuma Application Support designs into this Loora store.
    pub fn migrate_from_luuma(&self) -> io::Result<ImportReport> {
        let Some(dir) = Self::luuma_designs_dir() else {
            return Ok(ImportReport::default());
        };
        if !dir.exists() {
            return Ok(ImportReport::default());
        }
        let mut paths = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if name.ends_with(LEGACY_FILE_SUFFIX)
                || name.ends_with(FILE_SUFFIX)
                || name.ends_with(".json")
            {
                paths.push(path);
            }
        }
        paths.sort();
        self.import_paths(&paths, false)
    }

    pub fn create(&self, name: impl Into<String>) -> io::Result<Document> {
        let doc = Document::empty(name);
        self.save(&doc)?;
        self.set_active(&doc.id)?;
        Ok(doc)
    }

    pub fn delete(&self, id: &str) -> io::Result<()> {
        let path = self.path_for(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        let session = self.session()?;
        if session.active_id.as_deref() == Some(id) {
            self.set_active_opt(None)?;
        }
        Ok(())
    }

    pub fn set_active(&self, id: &str) -> io::Result<()> {
        self.set_active_opt(Some(id.to_string()))
    }

    fn set_active_opt(&self, id: Option<String>) -> io::Result<()> {
        let mut session = self.session()?;
        session.active_id = id;
        self.write_session(&session)
    }

    fn write_session(&self, session: &Session) -> io::Result<()> {
        let path = self.root.join(SESSION_FILE);
        let json = serde_json::to_vec_pretty(session)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(path, json)?;
        Ok(())
    }

    fn session(&self) -> io::Result<Session> {
        let path = self.root.join(SESSION_FILE);
        if !path.exists() {
            return Ok(Session::default());
        }
        let bytes = fs::read(path)?;
        Ok(serde_json::from_slice(&bytes).unwrap_or_default())
    }

    pub fn active_id(&self) -> io::Result<Option<String>> {
        Ok(self.session()?.active_id)
    }

    /// Persisted app chrome theme id (`"dark"` / `"light"`).
    pub fn ui_theme(&self) -> io::Result<Option<String>> {
        Ok(self.session()?.ui_theme)
    }

    pub fn set_ui_theme(&self, theme: &str) -> io::Result<()> {
        let mut session = self.session()?;
        session.ui_theme = Some(theme.to_string());
        self.write_session(&session)
    }

    /// Load last session file, or create a fresh Untitled design.
    pub fn load_or_create_default(&self) -> io::Result<Document> {
        if let Some(id) = self.active_id()? {
            if let Ok(doc) = self.load(&id) {
                return Ok(doc);
            }
        }
        if let Some(first) = self.list()?.into_iter().next() {
            self.set_active(&first.id)?;
            return self.load(&first.id);
        }
        self.create("Untitled")
    }
}

fn is_design_filename(name: &str) -> bool {
    name.ends_with(FILE_SUFFIX) || name.ends_with(LEGACY_FILE_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Color, Layout, Node};
    use std::time::SystemTime;

    fn temp_store(label: &str) -> (DesignStore, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "loora-store-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = DesignStore::open_at(root.clone()).unwrap();
        (store, root)
    }

    #[test]
    fn save_load_roundtrip() {
        let (store, root) = temp_store("roundtrip");
        let mut doc = Document::empty("Roundtrip");
        let page = doc.root_page_id.clone();
        let mut rect = Node::rectangle("Box", page, Layout::new(10.0, 20.0, 100.0, 80.0));
        rect.style
            .set_solid_fill(Some(Color::rgb(0x11, 0x22, 0x33)));
        doc.nodes.insert(rect.id.clone(), rect);
        store.save(&doc).unwrap();

        let loaded = store.load(&doc.id).unwrap();
        assert_eq!(loaded.name, "Roundtrip");
        assert_eq!(loaded.nodes.len(), doc.nodes.len());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_legacy_luuma_json() {
        let (store, root) = temp_store("import");
        let legacy = root.join("incoming.luuma.json");
        fs::write(
            &legacy,
            r#"{
              "id":"doc_import_1",
              "name":"Legacy Card",
              "root_page_id":"page_1",
              "nodes":{
                "page_1":{
                  "id":"page_1","kind":"page","name":"Page","parent_id":null,
                  "order":1024.0,"hidden":false,"locked":false,
                  "layout":{"x":0,"y":0,"width":1440,"height":900},
                  "style":{"fill":{"r":0.1,"g":0.1,"b":0.1,"a":1.0},"stroke":null,"radius":0.0,"opacity":1.0}
                },
                "frame_1":{
                  "id":"frame_1","kind":"frame","name":"Card","parent_id":"page_1",
                  "order":2048.0,"hidden":false,"locked":false,
                  "layout":{"x":40,"y":40,"width":240,"height":160},
                  "style":{"fill":{"r":0.16,"g":0.16,"b":0.18,"a":1.0},"stroke":null,"radius":8.0,"opacity":1.0}
                }
              }
            }"#,
        )
        .unwrap();

        let doc = store.import_file(&legacy).unwrap();
        assert_eq!(doc.name, "Legacy Card");
        assert_eq!(doc.nodes.len(), 2);
        let frame = doc.nodes.values().find(|n| n.name == "Card").unwrap();
        assert_eq!(frame.style.fills.len(), 1);
        assert!((frame.style.corners.tl - 8.0).abs() < f32::EPSILON);
        assert!(store.path_for(&doc.id).exists());

        let report = store.import_paths(&[legacy], false).unwrap();
        assert!(report.imported.is_empty());
        assert_eq!(report.skipped.len(), 1);

        let _ = fs::remove_dir_all(root);
    }
}
