use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VarEntry {
    pub id: String,
    pub kind: VarKind,
    pub sim_name: String,
    pub unit: Option<String>,
    pub index: Option<u32>,
    pub rust_type: RustVarType,
    pub preview_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VarKind {
    LVar,
    AVar,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RustVarType {
    F64,
    Bool,
    I32,
}

pub struct VarRegistry {
    pub vars: Vec<VarEntry>,
}

impl Default for VarRegistry {
    fn default() -> Self {
        Self { vars: Vec::new() }
    }
}

impl VarRegistry {
    pub fn add(&mut self, entry: VarEntry) {
        self.vars.push(entry);
    }

    pub fn update(&mut self, id: &str, entry: VarEntry) -> bool {
        if let Some(existing) = self.vars.iter_mut().find(|v| v.id == id) {
            *existing = entry;
            true
        } else {
            false
        }
    }

    pub fn delete(&mut self, id: &str) -> bool {
        if let Some(pos) = self.vars.iter().position(|v| v.id == id) {
            self.vars.remove(pos);
            true
        } else {
            false
        }
    }
}

pub type VarStore = Mutex<VarRegistry>;
